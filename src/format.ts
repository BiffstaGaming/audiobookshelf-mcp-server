import type { AbsLibraryItem, AbsMediaProgress, AbsSeriesRef } from './abs/types.js';

/**
 * Compact, LLM-friendly views of Audiobookshelf objects. Raw ABS items carry
 * audio file lists, tracks and paths that waste context; these keep what a
 * model needs to reason about books.
 */

export type ProgressStatus = 'finished' | 'in-progress' | 'stalled' | 'not-started';

export interface ProgressView {
  status: ProgressStatus;
  percent: number;
  last_listened: string | null;
  finished_at: string | null;
  started_at: string | null;
}

export interface ItemView {
  id: string;
  title: string;
  subtitle?: string;
  author: string | null;
  narrator?: string;
  series: string | null;
  series_detail?: { id: string; name: string; sequence: string | null }[];
  genres?: string[];
  tags?: string[];
  published_year?: string;
  language?: string;
  duration_hours: number | null;
  added: string | null;
  abridged?: boolean;
  description?: string;
  progress?: ProgressView;
  library_id: string;
}

export function isoDate(ms: number | null | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function hours(seconds: number | null | undefined): number | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

export function truncate(text: string | null | undefined, max: number): string | undefined {
  if (!text || max <= 0) return undefined;
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return undefined;
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export function progressStatus(
  p: AbsMediaProgress | null | undefined,
  stalledAfterDays: number,
  now = Date.now(),
): ProgressStatus {
  if (!p) return 'not-started';
  if (p.isFinished) return 'finished';
  const started = (p.currentTime ?? 0) > 0 || (p.progress ?? 0) > 0 || (p.ebookProgress ?? 0) > 0;
  if (!started) return 'not-started';
  const idleDays = (now - (p.lastUpdate ?? now)) / 86_400_000;
  return idleDays > stalledAfterDays ? 'stalled' : 'in-progress';
}

export function progressView(
  p: AbsMediaProgress | null | undefined,
  stalledAfterDays: number,
  now = Date.now(),
): ProgressView {
  return {
    status: progressStatus(p, stalledAfterDays, now),
    percent: p ? Math.round((p.isFinished ? 1 : (p.progress ?? 0)) * 100) : 0,
    last_listened: isoDate(p?.lastUpdate),
    finished_at: isoDate(p?.finishedAt),
    started_at: isoDate(p?.startedAt),
  };
}

function seriesRefs(meta: AbsLibraryItem['media']['metadata']): AbsSeriesRef[] {
  const s = meta.series;
  if (!s) return [];
  return Array.isArray(s) ? s : [s];
}

export interface FormatOptions {
  descriptionMaxChars: number;
  stalledAfterDays: number;
  progress?: AbsMediaProgress | null;
  /** Include progress block even when the user never started the item. */
  includeProgress?: boolean;
  now?: number;
}

export function formatItem(item: AbsLibraryItem, opts: FormatOptions): ItemView {
  const meta = item.media?.metadata ?? {};
  const refs = seriesRefs(meta);
  const author =
    meta.authorName ??
    (meta.authors?.length ? meta.authors.map((a) => a.name).join(', ') : null) ??
    meta.author ??
    null;
  const narrator = meta.narratorName ?? (meta.narrators?.length ? meta.narrators.join(', ') : undefined);
  const seriesName =
    meta.seriesName ??
    (refs.length ? refs.map((s) => (s.sequence ? `${s.name} #${s.sequence}` : s.name)).join(', ') : null);

  const view: ItemView = {
    id: item.id,
    title: meta.title ?? '(untitled)',
    author,
    series: seriesName || null,
    duration_hours: hours(item.media?.duration),
    added: isoDate(item.addedAt),
    library_id: item.libraryId,
  };
  if (meta.subtitle) view.subtitle = meta.subtitle;
  if (narrator) view.narrator = narrator;
  if (refs.length) {
    view.series_detail = refs.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence ?? null }));
  }
  if (meta.genres?.length) view.genres = meta.genres;
  if (item.media?.tags?.length) view.tags = item.media.tags;
  if (meta.publishedYear) view.published_year = meta.publishedYear;
  if (meta.language) view.language = meta.language;
  if (meta.abridged) view.abridged = true;
  const description = truncate(meta.descriptionPlain ?? meta.description, opts.descriptionMaxChars);
  if (description) view.description = description;

  const p = opts.progress !== undefined ? opts.progress : item.userMediaProgress;
  if (p || opts.includeProgress) view.progress = progressView(p, opts.stalledAfterDays, opts.now);
  return view;
}

/** Natural ordering for series sequences ("1", "1.5", "2", "10", null last). */
export function compareSequence(a: string | null | undefined, b: string | null | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
