/**
 * In-process fake of the Audiobookshelf API, returning payloads shaped like
 * Audiobookshelf v2.37 (see server/controllers/* in advplyr/audiobookshelf).
 * Used as a drop-in `fetch` so the real client/tool code paths run unchanged.
 */
import type { AbsLibraryItem, AbsMediaProgress } from '../src/abs/types.js';

export const API_KEY = 'test-key';
const DAY = 86_400_000;
export const NOW = Date.now();

interface Book {
  id: string;
  libraryId: string;
  title: string;
  subtitle?: string;
  authors: { id: string; name: string }[];
  narrators: string[];
  series: { id: string; name: string; sequence: string | null }[];
  genres: string[];
  tags: string[];
  publishedYear: string;
  duration: number;
  addedAt: number;
  description?: string;
}

const SAND = { id: 'au-sand', name: 'Brandon Sanderson' };
const WEIR = { id: 'au-weir', name: 'Andy Weir' };
const HERB = { id: 'au-herb', name: 'Frank Herbert' };
const STORM = { id: 'se-storm', name: 'The Stormlight Archive' };
const MIST = { id: 'se-mist', name: 'Mistborn' };

export const BOOKS: Book[] = [
  {
    id: 'i1',
    libraryId: 'lib-books',
    title: 'The Way of Kings',
    authors: [SAND],
    narrators: ['Michael Kramer', 'Kate Reading'],
    series: [{ ...STORM, sequence: '1' }],
    genres: ['Fantasy'],
    tags: ['epic'],
    publishedYear: '2010',
    duration: 45.5 * 3600,
    addedAt: NOW - 400 * DAY,
    description: '<p>Roshar is a world of <b>stone</b> and storms.</p>',
  },
  {
    id: 'i2',
    libraryId: 'lib-books',
    title: 'Words of Radiance',
    authors: [SAND],
    narrators: ['Michael Kramer', 'Kate Reading'],
    series: [{ ...STORM, sequence: '2' }],
    genres: ['Fantasy'],
    tags: ['epic'],
    publishedYear: '2014',
    duration: 48 * 3600,
    addedAt: NOW - 390 * DAY,
  },
  {
    id: 'i4',
    libraryId: 'lib-books',
    title: 'Rhythm of War',
    authors: [SAND],
    narrators: ['Michael Kramer', 'Kate Reading'],
    series: [{ ...STORM, sequence: '4' }],
    genres: ['Fantasy'],
    tags: [],
    publishedYear: '2020',
    duration: 57 * 3600,
    addedAt: NOW - 10 * DAY,
  },
  {
    id: 'i6',
    libraryId: 'lib-books',
    title: 'Mistborn',
    subtitle: 'The Final Empire',
    authors: [SAND],
    narrators: ['Michael Kramer'],
    series: [{ ...MIST, sequence: '1' }],
    genres: ['Fantasy'],
    tags: [],
    publishedYear: '2006',
    duration: 24.6 * 3600,
    addedAt: NOW - 30 * DAY,
  },
  {
    id: 'i7',
    libraryId: 'lib-books',
    title: 'Project Hail Mary',
    authors: [WEIR],
    narrators: ['Ray Porter'],
    series: [],
    genres: ['Science Fiction'],
    tags: [],
    publishedYear: '2021',
    duration: 16.2 * 3600,
    addedAt: NOW - 300 * DAY,
  },
  {
    id: 'i8',
    libraryId: 'lib-books',
    title: 'Dune',
    authors: [HERB],
    narrators: ['Scott Brick'],
    series: [],
    genres: ['Science Fiction', 'Classics'],
    tags: [],
    publishedYear: '1965',
    duration: 21 * 3600,
    addedAt: NOW - 5 * DAY,
  },
  {
    id: 'x1',
    libraryId: 'lib-hidden',
    title: 'Secret Book',
    authors: [WEIR],
    narrators: [],
    series: [],
    genres: [],
    tags: [],
    publishedYear: '2000',
    duration: 3600,
    addedAt: NOW,
  },
];

const mp = (id: string, itemId: string, o: Partial<AbsMediaProgress>): AbsMediaProgress => ({
  id,
  libraryItemId: itemId,
  episodeId: null,
  duration: 3600,
  progress: 0,
  currentTime: 0,
  isFinished: false,
  lastUpdate: NOW,
  startedAt: NOW - 100 * DAY,
  finishedAt: null,
  ...o,
});

export const PROGRESS: AbsMediaProgress[] = [
  mp('p1', 'i1', {
    isFinished: true,
    progress: 1,
    currentTime: 100,
    finishedAt: NOW - 200 * DAY,
    lastUpdate: NOW - 200 * DAY,
  }),
  mp('p2', 'i2', {
    isFinished: true,
    progress: 1,
    currentTime: 100,
    finishedAt: NOW - 20 * DAY,
    lastUpdate: NOW - 20 * DAY,
  }),
  mp('p7', 'i7', { progress: 0.3, currentTime: 5000, lastUpdate: NOW - 200 * DAY }),
  mp('p8', 'i8', { progress: 0.5, currentTime: 9000, lastUpdate: NOW - 1 * DAY }),
  mp('px', 'x1', { isFinished: true, progress: 1, finishedAt: NOW - DAY }),
  // Item the user may not access (e.g. tag-restricted): ABS 403s any batch containing it.
  mp('pf', 'forbidden1', { isFinished: true, progress: 1, finishedAt: NOW - DAY }),
  // Podcast episode progress must be ignored by book logic.
  { ...mp('pe', 'pod1', { progress: 0.9, currentTime: 50 }), episodeId: 'ep1' },
];

function meta(b: Book, expanded: boolean) {
  const base = {
    title: b.title,
    titleIgnorePrefix: b.title,
    subtitle: b.subtitle ?? null,
    authorName: b.authors.map((a) => a.name).join(', '),
    authorNameLF: b.authors.map((a) => a.name).join(', '),
    narratorName: b.narrators.join(', '),
    seriesName: b.series.map((s) => (s.sequence ? `${s.name} #${s.sequence}` : s.name)).join(', '),
    genres: b.genres,
    publishedYear: b.publishedYear,
    publishedDate: null,
    publisher: null,
    description: b.description ?? null,
    isbn: null,
    asin: null,
    language: 'English',
    explicit: false,
    abridged: false,
  };
  return expanded ? { ...base, authors: b.authors, narrators: b.narrators, series: b.series } : base;
}

export function toItem(b: Book, expanded = false): AbsLibraryItem {
  return {
    id: b.id,
    libraryId: b.libraryId,
    mediaType: 'book',
    addedAt: b.addedAt,
    media: {
      id: `media-${b.id}`,
      metadata: meta(b, expanded),
      tags: b.tags,
      duration: b.duration,
      numChapters: 2,
      ...(expanded
        ? {
            chapters: [
              { id: 0, start: 0, end: 600, title: 'Prologue' },
              { id: 1, start: 600, end: 1200, title: 'One' },
            ],
          }
        : {}),
    },
  } as AbsLibraryItem;
}

const decode = (v: string) => Buffer.from(decodeURIComponent(v), 'base64').toString('utf8');

export interface FakeState {
  calls: { method: string; path: string; body?: unknown }[];
  progress: AbsMediaProgress[];
}

export function createFakeAbs(): { fetch: typeof fetch; state: FakeState } {
  const state: FakeState = { calls: [], progress: structuredClone(PROGRESS) };
  const visible = BOOKS.filter((b) => b.libraryId !== 'lib-hidden' || true);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const text = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'content-type': 'text/plain' } });

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    state.calls.push({ method, path, body });
    const headers = new Headers(init?.headers);
    if (headers.get('authorization') !== `Bearer ${API_KEY}`) return text('Unauthorized', 401);

    const q = url.searchParams;
    let m: RegExpMatchArray | null;

    if (method === 'POST' && path === '/api/authorize') {
      return json({
        user: { id: 'u1', username: 'chris', type: 'admin' },
        userDefaultLibraryId: 'lib-books',
        serverSettings: { version: '2.37.2' },
      });
    }
    if (method === 'GET' && path === '/api/libraries') {
      return json({
        libraries: [
          { id: 'lib-books', name: 'Audiobooks', mediaType: 'book' },
          { id: 'lib-pods', name: 'Podcasts', mediaType: 'podcast' },
          { id: 'lib-hidden', name: 'Hidden', mediaType: 'book' },
        ],
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/filterdata$/))) {
      const books = visible.filter((b) => b.libraryId === m![1]);
      const authors = new Map(books.flatMap((b) => b.authors).map((a) => [a.id, a]));
      const series = new Map(books.flatMap((b) => b.series).map((s) => [s.id, { id: s.id, name: s.name }]));
      return json({
        authors: [...authors.values()],
        series: [...series.values()],
        genres: [...new Set(books.flatMap((b) => b.genres))],
        tags: [...new Set(books.flatMap((b) => b.tags))],
        narrators: [...new Set(books.flatMap((b) => b.narrators))],
        languages: ['English'],
        publishers: [],
        publishedDecades: [],
        bookCount: books.length,
        authorCount: authors.size,
        seriesCount: series.size,
        podcastCount: 0,
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/search$/))) {
      const term = (q.get('q') ?? '').toLowerCase();
      const hits = visible.filter(
        (b) =>
          b.libraryId === m![1] &&
          (b.title.toLowerCase().includes(term) ||
            (b.subtitle ?? '').toLowerCase().includes(term) ||
            b.authors.some((a) => a.name.toLowerCase().includes(term))),
      );
      return json({
        book: hits.map((b) => ({ libraryItem: toItem(b, true), matchKey: 'title', matchText: b.title })),
        narrators: [],
        tags: [],
        genres: [],
        series: [],
        authors: [],
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/items$/))) {
      let books = visible.filter((b) => b.libraryId === m![1]);
      const filter = q.get('filter');
      let seriesId: string | null = null;
      if (filter) {
        const [group, raw] = [filter.split('.')[0]!, filter.split('.').slice(1).join('.')];
        const value = raw ? decode(raw) : '';
        if (group === 'authors') books = books.filter((b) => b.authors.some((a) => a.id === value));
        else if (group === 'series') {
          seriesId = value;
          books = books.filter((b) => b.series.some((s) => s.id === value));
        } else if (group === 'genres') books = books.filter((b) => b.genres.includes(value));
        else if (group === 'narrators') books = books.filter((b) => b.narrators.includes(value));
        else if (group === 'progress') {
          const pm = new Map(state.progress.map((p) => [p.libraryItemId, p]));
          books = books.filter((b) => {
            const p = pm.get(b.id);
            if (value === 'finished') return !!p?.isFinished;
            if (value === 'not-started') return !p;
            if (value === 'in-progress') return !!p && !p.isFinished;
            return !p?.isFinished;
          });
        } else if (group === 'recent') books = books.filter((b) => b.addedAt > NOW - 60 * DAY);
      }
      const limit = Number(q.get('limit') ?? 0) || books.length;
      const page = Number(q.get('page') ?? 0);
      const results = books.slice(page * limit, page * limit + limit).map((b) => {
        const it = toItem(b);
        if (seriesId) {
          const s = b.series.find((x) => x.id === seriesId)!;
          (it.media.metadata as Record<string, unknown>).series = {
            id: s.id,
            name: s.name,
            sequence: s.sequence,
          };
        }
        return it;
      });
      return json({ results, total: books.length, limit, page, minified: q.get('minified') === '1' });
    }
    if (method === 'POST' && path === '/api/items/batch/get') {
      const ids: string[] = body?.libraryItemIds ?? [];
      if (!ids.length) return text('Invalid payload', 403);
      if (ids.includes('forbidden1')) return text('Forbidden', 403);
      return json({ libraryItems: BOOKS.filter((b) => ids.includes(b.id)).map((b) => toItem(b, true)) });
    }
    if ((m = path.match(/^\/api\/items\/([^/]+)$/)) && method === 'GET') {
      const b = BOOKS.find((x) => x.id === m![1]);
      if (!b) return text('Not found', 404);
      const item = toItem(b, true);
      item.userMediaProgress = state.progress.find((p) => p.libraryItemId === b.id) ?? null;
      return json(item);
    }
    if (method === 'GET' && path === '/api/me/progress') return json({ mediaProgress: state.progress });
    if ((m = path.match(/^\/api\/me\/progress\/([^/]+)$/)) && method === 'PATCH') {
      const existing = state.progress.find((p) => p.libraryItemId === m![1]);
      if (existing) existing.isFinished = body.isFinished;
      else
        state.progress.push(
          mp(`p-${m[1]}`, m[1]!, { isFinished: body.isFinished, progress: body.isFinished ? 1 : 0 }),
        );
      return text('OK');
    }
    if (method === 'GET' && path === '/api/me/listening-stats') {
      const today = new Date(NOW).toISOString().slice(0, 10);
      const old = new Date(NOW - 100 * DAY).toISOString().slice(0, 10);
      return json({
        totalTime: 100 * 3600,
        today: 1800,
        items: {
          i1: { id: 'i1', timeListening: 45 * 3600, mediaMetadata: { title: 'The Way of Kings' } },
          i2: { id: 'i2', timeListening: 48 * 3600, mediaMetadata: { title: 'Words of Radiance' } },
          i8: { id: 'i8', timeListening: 7 * 3600, mediaMetadata: { title: 'Dune' } },
        },
        days: { [today]: 1800, [old]: 7200 },
        dayOfWeek: { Monday: 3600, Sunday: 5400 },
        recentSessions: [
          {
            id: 's1',
            libraryItemId: 'i8',
            displayTitle: 'Dune',
            displayAuthor: 'Frank Herbert',
            timeListening: 1800,
            date: today,
            startedAt: NOW,
          },
        ],
      });
    }
    if (method === 'GET' && path === '/api/me/listening-sessions') {
      return json({
        total: 1,
        numPages: 1,
        page: Number(q.get('page') ?? 0),
        itemsPerPage: Number(q.get('itemsPerPage') ?? 10),
        sessions: [
          {
            id: 's1',
            libraryItemId: 'i8',
            displayTitle: 'Dune',
            displayAuthor: 'Frank Herbert',
            timeListening: 1800,
            date: '2026-11-01',
            dayOfWeek: 'Sunday',
            deviceInfo: { clientName: 'Abs Android' },
          },
        ],
      });
    }
    if ((m = path.match(/^\/api\/me\/stats\/year\/(\d+)$/)))
      return json({ totalListeningTime: 1234, numBooksFinished: 2 });
    if ((m = path.match(/^\/api\/authors\/([^/]+)$/))) {
      const books = BOOKS.filter((b) => b.authors.some((a) => a.id === m![1]));
      if (!books.length) return text('Not found', 404);
      const a = books[0]!.authors.find((x) => x.id === m![1])!;
      const seriesMap = new Map<string, { id: string; name: string; items: AbsLibraryItem[] }>();
      for (const b of books)
        for (const s of b.series) {
          const it = toItem(b);
          (it.media.metadata as Record<string, unknown>).series = s;
          const e = seriesMap.get(s.id) ?? { id: s.id, name: s.name, items: [] };
          e.items.push(it);
          seriesMap.set(s.id, e);
        }
      return json({
        ...a,
        description: null,
        libraryItems: books.map((b) => toItem(b)),
        series: [...seriesMap.values()],
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/authors$/))) {
      const books = visible.filter((b) => b.libraryId === m![1]);
      const counts = new Map<string, { id: string; name: string; numBooks: number }>();
      for (const b of books)
        for (const a of b.authors) {
          const e = counts.get(a.id) ?? { ...a, numBooks: 0 };
          e.numBooks++;
          counts.set(a.id, e);
        }
      const results = [...counts.values()].sort((x, y) => y.numBooks - x.numBooks);
      return json({
        results,
        total: results.length,
        limit: Number(q.get('limit')),
        page: Number(q.get('page')),
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/series$/))) {
      const books = visible.filter((b) => b.libraryId === m![1]);
      const map = new Map<string, { id: string; name: string; books: AbsLibraryItem[] }>();
      for (const b of books)
        for (const s of b.series) {
          const e = map.get(s.id) ?? { id: s.id, name: s.name, books: [] };
          e.books.push(toItem(b));
          map.set(s.id, e);
        }
      return json({ results: [...map.values()], total: map.size });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/collections$/))) {
      return json({
        results: [{ id: 'col1', libraryId: m[1], name: 'Favourites', books: [toItem(BOOKS[0]!)] }],
        total: 1,
      });
    }
    if (method === 'GET' && path === '/api/playlists') {
      return json({
        playlists: [
          {
            id: 'pl1',
            libraryId: 'lib-books',
            name: 'Commute',
            items: [{ libraryItemId: 'i8', libraryItem: toItem(BOOKS[5]!) }],
          },
          { id: 'pl2', libraryId: 'lib-hidden', name: 'Hidden list', items: [] },
        ],
      });
    }
    if (method === 'POST' && path === '/api/collections') {
      return json({
        id: 'col-new',
        libraryId: body.libraryId,
        name: body.name,
        books: body.books.map((id: string) => ({ id })),
      });
    }
    if ((m = path.match(/^\/api\/libraries\/([^/]+)\/scan$/)) && method === 'POST') return text('OK');
    return text(`fake: no route for ${method} ${path}`, 404);
  };

  return { fetch: fakeFetch as typeof fetch, state };
}
