import type { AbsLibraryItem, AbsMediaProgress } from './abs/types.js';
import type { ServerContext } from './context.js';
import { compareSequence, hours, isoDate, progressStatus, type ProgressStatus } from './format.js';

/**
 * Builds a compact summary of what the user listens to, designed to be the
 * single context an assistant needs to recommend new books: favourite
 * authors/series/genres/narrators (weighted by engagement), length and era
 * preferences, what is in flight, and where series have unread or missing
 * entries in the library.
 */

export interface ProfileOptions {
  libraryId?: string;
  topN: number;
  includeSeriesStatus: boolean;
  maxSeries: number;
  includeUnreadByTopAuthors: boolean;
  maxAuthors: number;
}

interface Tally {
  name: string;
  id?: string;
  score: number;
  finished: number;
  in_progress: number;
  stalled: number;
  hours_listened: number;
}

const WEIGHT: Record<Exclude<ProgressStatus, 'not-started'>, number> = {
  finished: 1,
  'in-progress': 0.6,
  stalled: 0.15,
};

function bump(
  map: Map<string, Tally>,
  key: string,
  name: string,
  status: Exclude<ProgressStatus, 'not-started'>,
  weight: number,
  listenedHours: number,
  id?: string,
) {
  const t = map.get(key) ?? {
    name,
    id,
    score: 0,
    finished: 0,
    in_progress: 0,
    stalled: 0,
    hours_listened: 0,
  };
  t.score += weight;
  if (status === 'finished') t.finished++;
  else if (status === 'in-progress') t.in_progress++;
  else t.stalled++;
  t.hours_listened += listenedHours;
  map.set(key, t);
}

function top(map: Map<string, Tally>, n: number) {
  return [...map.values()]
    .sort((a, b) => b.score - a.score || b.finished - a.finished || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((t) => ({
      ...(t.id ? { id: t.id } : {}),
      name: t.name,
      score: Math.round(t.score * 100) / 100,
      finished: t.finished,
      in_progress: t.in_progress,
      stalled: t.stalled,
      hours_listened: Math.round(t.hours_listened * 10) / 10,
    }));
}

function lengthBand(h: number | null): string {
  if (h === null) return 'unknown';
  if (h < 5) return 'under 5h';
  if (h < 10) return '5-10h';
  if (h < 15) return '10-15h';
  if (h < 20) return '15-20h';
  return '20h+';
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  return Math.round(m * 10) / 10;
}

export async function buildTasteProfile(ctx: ServerContext, opts: ProfileOptions) {
  const { client, config } = ctx;
  const now = Date.now();
  const allowed = await ctx.allowedLibraryIds();
  const scopeLibrary = opts.libraryId ? (await ctx.resolveLibrary(opts.libraryId)).id : undefined;

  const [progressMap, stats] = await Promise.all([ctx.progressByItem(), client.listeningStats()]);

  const engaged = [...progressMap.values()].filter(
    (p) => progressStatus(p, config.stalledAfterDays, now) !== 'not-started',
  );
  const items = engaged.length ? await client.itemsBatch(engaged.map((p) => p.libraryItemId!)) : [];
  const inScope = items.filter(
    (i) =>
      i.mediaType === 'book' && allowed.has(i.libraryId) && (!scopeLibrary || i.libraryId === scopeLibrary),
  );

  const authors = new Map<string, Tally>();
  const series = new Map<string, Tally>();
  const genres = new Map<string, Tally>();
  const narrators = new Map<string, Tally>();
  const tags = new Map<string, Tally>();
  const languages = new Map<string, Tally>();
  const decades = new Map<string, Tally>();
  const lengths = new Map<string, Tally>();
  const finishedDurations: number[] = [];

  const finishedList: { item: AbsLibraryItem; p: AbsMediaProgress }[] = [];
  const current: { item: AbsLibraryItem; p: AbsMediaProgress }[] = [];
  const stalled: { item: AbsLibraryItem; p: AbsMediaProgress }[] = [];

  for (const item of inScope) {
    const p = progressMap.get(item.id)!;
    const status = progressStatus(p, config.stalledAfterDays, now) as Exclude<ProgressStatus, 'not-started'>;
    const m = item.media.metadata;
    const listenedHours = (stats.items?.[item.id]?.timeListening ?? 0) / 3600;
    // Partial listens count in proportion to how far the user got.
    const weight = status === 'finished' ? WEIGHT.finished : WEIGHT[status] * Math.max(0.25, p.progress ?? 0);

    for (const a of m.authors ?? []) bump(authors, a.id, a.name, status, weight, listenedHours, a.id);
    const refs = Array.isArray(m.series) ? m.series : m.series ? [m.series] : [];
    for (const s of refs) bump(series, s.id, s.name, status, weight, listenedHours, s.id);
    for (const g of m.genres ?? []) bump(genres, g.toLowerCase(), g, status, weight, listenedHours);
    for (const n of m.narrators ?? []) bump(narrators, n.toLowerCase(), n, status, weight, listenedHours);
    for (const t of item.media.tags ?? []) bump(tags, t.toLowerCase(), t, status, weight, listenedHours);
    if (m.language) bump(languages, m.language.toLowerCase(), m.language, status, weight, listenedHours);
    const year = Number.parseInt(m.publishedYear ?? '', 10);
    if (Number.isFinite(year)) {
      const d = `${Math.floor(year / 10) * 10}s`;
      bump(decades, d, d, status, weight, listenedHours);
    }
    const h = hours(item.media.duration);
    const band = lengthBand(h);
    bump(lengths, band, band, status, weight, listenedHours);

    if (status === 'finished') {
      finishedList.push({ item, p });
      if (h !== null) finishedDurations.push(h);
    } else if (status === 'in-progress') current.push({ item, p });
    else stalled.push({ item, p });
  }

  const brief = ({ item, p }: { item: AbsLibraryItem; p: AbsMediaProgress }) => {
    const m = item.media.metadata;
    return {
      id: item.id,
      title: m.title ?? '(untitled)',
      author: m.authorName ?? m.authors?.map((a) => a.name).join(', ') ?? null,
      series: m.seriesName || null,
      percent: Math.round((p.isFinished ? 1 : (p.progress ?? 0)) * 100),
      last_listened: isoDate(p.lastUpdate),
      finished_at: isoDate(p.finishedAt),
    };
  };

  finishedList.sort((a, b) => (b.p.finishedAt ?? b.p.lastUpdate) - (a.p.finishedAt ?? a.p.lastUpdate));
  current.sort((a, b) => b.p.lastUpdate - a.p.lastUpdate);
  stalled.sort((a, b) => b.p.lastUpdate - a.p.lastUpdate);

  const days = Object.entries(stats.days ?? {});
  const sumSince = (cutoff: number) =>
    days.reduce((acc, [d, secs]) => (Date.parse(d) >= cutoff ? acc + secs : acc), 0);

  const topAuthors = top(authors, opts.topN);
  const topSeries = top(series, Math.max(opts.topN, opts.maxSeries));

  const profile: Record<string, unknown> = {
    generated_at: new Date(now).toISOString(),
    scope: scopeLibrary ? { library_id: scopeLibrary } : { library_ids: [...allowed] },
    totals: {
      books_finished: finishedList.length,
      books_in_progress: current.length,
      books_stalled: stalled.length,
      stalled_means: `started but not touched for more than ${config.stalledAfterDays} days`,
      hours_listened_all_time: hours(stats.totalTime),
      hours_listened_last_30_days: hours(sumSince(now - 30 * 86_400_000)),
      hours_listened_last_365_days: hours(sumSince(now - 365 * 86_400_000)),
      median_finished_book_hours: median(finishedDurations),
    },
    scoring_note:
      'score = finished books count 1.0 each; in-progress 0.6 and stalled 0.15, each scaled by how far through (min 25%). Use it to rank preferences; a high stalled count for something is a weak negative signal.',
    top_authors: topAuthors,
    top_series: top(series, opts.topN),
    top_genres: top(genres, opts.topN),
    top_narrators: top(narrators, opts.topN),
    top_tags: top(tags, opts.topN),
    languages: top(languages, 5),
    publication_decades: top(decades, 8),
    preferred_lengths: top(lengths, 6),
    recently_finished: finishedList.slice(0, 15).map(brief),
    currently_listening: current.slice(0, 10).map(brief),
    stalled: stalled.slice(0, 10).map(brief),
  };

  if (opts.includeSeriesStatus) {
    profile.series_status = await seriesStatus(
      ctx,
      topSeries.slice(0, opts.maxSeries),
      inScope,
      progressMap,
      now,
    );
  }
  if (opts.includeUnreadByTopAuthors) {
    profile.unread_by_top_authors = await unreadByAuthors(
      ctx,
      topAuthors.slice(0, opts.maxAuthors),
      progressMap,
      allowed,
      scopeLibrary,
      now,
    );
  }
  return profile;
}

/** For each series the user has engaged with: what they own, finished, and what is next. */
async function seriesStatus(
  ctx: ServerContext,
  wanted: { id?: string; name: string }[],
  engagedItems: AbsLibraryItem[],
  progressMap: Map<string, AbsMediaProgress>,
  now: number,
) {
  // A series lives in one library; find it from an item the user listened to.
  const seriesLibrary = new Map<string, string>();
  for (const item of engagedItems) {
    const m = item.media.metadata;
    const refs = Array.isArray(m.series) ? m.series : m.series ? [m.series] : [];
    for (const s of refs) if (!seriesLibrary.has(s.id)) seriesLibrary.set(s.id, item.libraryId);
  }

  const results = await mapLimit(wanted, 4, async (s) => {
    const libraryId = s.id ? seriesLibrary.get(s.id) : undefined;
    if (!s.id || !libraryId) return null;
    const books = await seriesBooks(ctx, libraryId, s.id, progressMap, now);
    const owned = books.map((b) => b.sequence).filter((x): x is string => !!x);
    const finished = books.filter((b) => b.status === 'finished');
    const next = books.find((b) => b.status !== 'finished');
    return {
      series_id: s.id,
      name: s.name,
      owned_count: books.length,
      finished_count: finished.length,
      highest_owned_sequence: owned.sort(compareSequence).at(-1) ?? null,
      next_owned_unfinished: next
        ? { id: next.id, title: next.title, sequence: next.sequence, status: next.status }
        : null,
      missing_sequences_in_owned_range: missingIntegers(owned),
      complete_in_library: books.length > 0 && finished.length === books.length,
      books,
    };
  });
  return results.filter((r) => r !== null);
}

export async function seriesBooks(
  ctx: ServerContext,
  libraryId: string,
  seriesId: string,
  progressMap: Map<string, AbsMediaProgress>,
  now = Date.now(),
) {
  const page = await ctx.client.libraryItems(libraryId, {
    limit: 200,
    page: 0,
    sort: 'sequence',
    filter: { group: 'series', value: seriesId },
  });
  return page.results
    .map((item) => {
      const m = item.media.metadata;
      const ref = Array.isArray(m.series) ? m.series.find((x) => x.id === seriesId) : m.series;
      const p = progressMap.get(item.id);
      return {
        id: item.id,
        title: m.title ?? '(untitled)',
        sequence: ref?.sequence ?? null,
        status: progressStatus(p, ctx.config.stalledAfterDays, now),
        percent: p ? Math.round((p.isFinished ? 1 : (p.progress ?? 0)) * 100) : 0,
      };
    })
    .sort((a, b) => compareSequence(a.sequence, b.sequence));
}

/** Whole-number gaps between 1 and the highest owned sequence ("1,2,4" → [3]). */
export function missingIntegers(sequences: string[]): number[] {
  const nums = new Set(
    sequences.map((s) => Number(s)).filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0),
  );
  if (!nums.size) return [];
  const max = Math.max(...nums);
  if (max > 200) return [];
  const out: number[] = [];
  for (let i = 1; i < max; i++) if (!nums.has(i)) out.push(i);
  return out;
}

async function unreadByAuthors(
  ctx: ServerContext,
  wanted: { id?: string; name: string }[],
  progressMap: Map<string, AbsMediaProgress>,
  allowed: Set<string>,
  scopeLibrary: string | undefined,
  now: number,
) {
  const results = await mapLimit(wanted, 4, async (a) => {
    if (!a.id) return null;
    const author = await ctx.client.author(a.id);
    const unread = (author.libraryItems ?? [])
      .filter((i) => allowed.has(i.libraryId) && (!scopeLibrary || i.libraryId === scopeLibrary))
      .filter(
        (i) => progressStatus(progressMap.get(i.id), ctx.config.stalledAfterDays, now) === 'not-started',
      )
      .map((i) => ({
        id: i.id,
        title: i.media.metadata.title ?? '(untitled)',
        series: i.media.metadata.seriesName || null,
        duration_hours: hours(i.media.duration),
      }));
    return { author_id: a.id, name: a.name, owned_not_started: unread };
  });
  return results.filter((r) => r !== null && r.owned_not_started.length > 0);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
