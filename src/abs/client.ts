import type { Logger } from '../logger.js';
import type {
  AbsAuthor,
  AbsAuthorizeResponse,
  AbsCollection,
  AbsFilterData,
  AbsItemsPage,
  AbsLibrary,
  AbsLibraryItem,
  AbsListeningSession,
  AbsListeningStats,
  AbsMediaProgress,
  AbsPlaylist,
  AbsSearchResponse,
  AbsSeriesListEntry,
} from './types.js';

export class AbsApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message);
    this.name = 'AbsApiError';
  }
}

export interface AbsClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  cacheTtlSeconds: number;
  logger: Logger;
  fetchImpl?: typeof fetch;
  /** Retries for idempotent GETs on network errors / 502-504. */
  maxRetries?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

/** Base64 + URI encoding Audiobookshelf expects in `filter=group.value`. */
export function encodeFilterValue(value: string): string {
  return encodeURIComponent(Buffer.from(value, 'utf8').toString('base64'));
}

export class AbsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();

  constructor(private readonly opts: AbsClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ---------------------------------------------------------------- transport

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(`${this.opts.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      url.searchParams.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    }
    // ABS expects the filter value already base64+URI encoded; URLSearchParams
    // would double-encode the "%" so we splice it in raw.
    return url.toString();
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    { query, body, rawFilter }: { query?: Query; body?: unknown; rawFilter?: string } = {},
  ): Promise<T> {
    let url = this.buildUrl(path, query);
    if (rawFilter) url += `${url.includes('?') ? '&' : '?'}filter=${rawFilter}`;

    const retries = method === 'GET' ? (this.opts.maxRetries ?? 2) : 0;
    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        this.opts.logger.debug(`${method} ${path}`);
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            Accept: 'application/json',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (!res.ok) {
          if (retries > attempt && [502, 503, 504].includes(res.status)) {
            attempt++;
            await sleep(250 * 2 ** attempt);
            continue;
          }
          const text = await res.text().catch(() => '');
          throw new AbsApiError(describeStatus(res.status, path, text), res.status, path);
        }

        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          // Several ABS write endpoints reply with a bare 200 "OK".
          return (await res.text()) as unknown as T;
        }
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof AbsApiError) throw err;
        const aborted = (err as Error).name === 'AbortError';
        if (retries > attempt) {
          attempt++;
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new AbsApiError(
          aborted
            ? `Audiobookshelf did not respond within ${this.opts.timeoutMs} ms (${path}). Check ABS_URL or raise ABS_REQUEST_TIMEOUT_MS.`
            : `Could not reach Audiobookshelf at ${this.opts.baseUrl}: ${(err as Error).message}`,
          null,
          path,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private cached<T>(key: string, load: () => Promise<T>, ttlSeconds = this.opts.cacheTtlSeconds) {
    if (ttlSeconds <= 0) return load();
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.value as Promise<T>;
    const value = load().catch((err) => {
      this.cache.delete(key);
      throw err;
    });
    this.cache.set(key, { expires: now + ttlSeconds * 1000, value });
    return value;
  }

  /** Drop cached data that a write may have changed. */
  invalidate(prefix?: string) {
    if (!prefix) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  // --------------------------------------------------------------- endpoints

  authorize() {
    return this.cached('authorize', () => this.request<AbsAuthorizeResponse>('POST', '/api/authorize'));
  }

  async libraries(): Promise<AbsLibrary[]> {
    const res = await this.cached('libraries', () =>
      this.request<{ libraries: AbsLibrary[] }>('GET', '/api/libraries'),
    );
    return res.libraries ?? [];
  }

  filterData(libraryId: string) {
    // Library facets change rarely; ABS itself caches them for 30 minutes.
    return this.cached(
      `filterdata:${libraryId}`,
      () => this.request<AbsFilterData>('GET', `/api/libraries/${libraryId}/filterdata`),
      Math.max(this.opts.cacheTtlSeconds, 300),
    );
  }

  search(libraryId: string, q: string, limit: number) {
    return this.request<AbsSearchResponse>('GET', `/api/libraries/${libraryId}/search`, {
      query: { q, limit },
    });
  }

  libraryItems(
    libraryId: string,
    opts: {
      limit: number;
      page: number;
      sort?: string;
      desc?: boolean;
      filter?: { group: string; value: string };
      collapseSeries?: boolean;
    },
  ) {
    return this.request<AbsItemsPage>('GET', `/api/libraries/${libraryId}/items`, {
      query: {
        limit: opts.limit,
        page: opts.page,
        sort: opts.sort,
        desc: opts.desc,
        minified: true,
        collapseseries: opts.collapseSeries,
      },
      rawFilter: opts.filter ? `${opts.filter.group}.${encodeFilterValue(opts.filter.value)}` : undefined,
    });
  }

  item(itemId: string) {
    return this.request<AbsLibraryItem>('GET', `/api/items/${encodeURIComponent(itemId)}`, {
      query: { expanded: 1, include: 'progress' },
    });
  }

  /**
   * Expanded items in bulk. Unknown IDs are silently omitted by ABS. Since
   * v2.34 ABS answers 403 for the WHOLE batch if any one item is not
   * accessible to the user (tag/explicit restrictions, lost library access),
   * so on 403 we bisect the chunk and drop only the forbidden items.
   */
  async itemsBatch(itemIds: string[], chunkSize = 50): Promise<AbsLibraryItem[]> {
    const ids = [...new Set(itemIds)];
    const out: AbsLibraryItem[] = [];
    const fetchChunk = async (chunk: string[]): Promise<void> => {
      if (!chunk.length) return;
      try {
        const res = await this.request<{ libraryItems: AbsLibraryItem[] }>('POST', '/api/items/batch/get', {
          body: { libraryItemIds: chunk },
        });
        out.push(...(res.libraryItems ?? []));
      } catch (err) {
        if (!(err instanceof AbsApiError) || err.status !== 403) throw err;
        if (chunk.length === 1) {
          this.opts.logger.debug(`Skipping item not accessible to this user: ${chunk[0]}`);
          return;
        }
        const mid = Math.ceil(chunk.length / 2);
        await fetchChunk(chunk.slice(0, mid));
        await fetchChunk(chunk.slice(mid));
      }
    };
    for (let i = 0; i < ids.length; i += chunkSize) await fetchChunk(ids.slice(i, i + chunkSize));
    return out;
  }

  async authors(libraryId: string, opts: { limit: number; page: number; sort: string; desc: boolean }) {
    return this.request<{ results?: AbsAuthor[]; authors?: AbsAuthor[]; total?: number }>(
      'GET',
      `/api/libraries/${libraryId}/authors`,
      { query: { limit: opts.limit, page: opts.page, sort: opts.sort, desc: opts.desc } },
    );
  }

  author(authorId: string, libraryId?: string) {
    return this.request<AbsAuthor>('GET', `/api/authors/${encodeURIComponent(authorId)}`, {
      query: { include: 'items,series', library: libraryId },
    });
  }

  seriesList(libraryId: string, opts: { limit: number; page: number; sort: string; desc: boolean }) {
    return this.request<{ results: AbsSeriesListEntry[]; total: number }>(
      'GET',
      `/api/libraries/${libraryId}/series`,
      { query: { ...opts, minified: true } },
    );
  }

  async mediaProgress(): Promise<AbsMediaProgress[]> {
    const res = await this.cached('me:progress', () =>
      this.request<{ mediaProgress: AbsMediaProgress[] }>('GET', '/api/me/progress'),
    );
    return res.mediaProgress ?? [];
  }

  listeningStats() {
    return this.cached('me:stats', () => this.request<AbsListeningStats>('GET', '/api/me/listening-stats'));
  }

  yearStats(year: number) {
    return this.request<Record<string, unknown>>('GET', `/api/me/stats/year/${year}`);
  }

  listeningSessions(page: number, itemsPerPage: number) {
    return this.request<{
      total: number;
      numPages: number;
      page: number;
      itemsPerPage: number;
      sessions: AbsListeningSession[];
    }>('GET', '/api/me/listening-sessions', { query: { page, itemsPerPage } });
  }

  async collections(libraryId: string): Promise<AbsCollection[]> {
    const res = await this.request<{ results: AbsCollection[] }>(
      'GET',
      `/api/libraries/${libraryId}/collections`,
    );
    return res.results ?? [];
  }

  async playlists(): Promise<AbsPlaylist[]> {
    const res = await this.request<{ playlists: AbsPlaylist[] }>('GET', '/api/playlists');
    return res.playlists ?? [];
  }

  // ------------------------------------------------------------------ writes

  async setFinished(itemId: string, isFinished: boolean) {
    await this.request('PATCH', `/api/me/progress/${encodeURIComponent(itemId)}`, {
      body: { isFinished },
    });
    this.invalidate('me:');
  }

  createCollection(libraryId: string, name: string, books: string[], description?: string) {
    return this.request<AbsCollection>('POST', '/api/collections', {
      body: { libraryId, name, description, books },
    });
  }

  addToCollection(collectionId: string, books: string[]) {
    return this.request<AbsCollection>(
      'POST',
      `/api/collections/${encodeURIComponent(collectionId)}/batch/add`,
      { body: { books } },
    );
  }

  createPlaylist(libraryId: string, name: string, itemIds: string[], description?: string) {
    return this.request<AbsPlaylist>('POST', '/api/playlists', {
      body: { libraryId, name, description, items: itemIds.map((libraryItemId) => ({ libraryItemId })) },
    });
  }

  addToPlaylist(playlistId: string, itemIds: string[]) {
    return this.request<AbsPlaylist>('POST', `/api/playlists/${encodeURIComponent(playlistId)}/batch/add`, {
      body: { items: itemIds.map((libraryItemId) => ({ libraryItemId })) },
    });
  }

  async scanLibrary(libraryId: string) {
    await this.request('POST', `/api/libraries/${libraryId}/scan`);
    this.invalidate(`filterdata:${libraryId}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function describeStatus(status: number, path: string, body: string): string {
  const detail = body && body.length < 300 ? ` — ${body.trim()}` : '';
  switch (status) {
    case 400:
      return `Audiobookshelf rejected the request (400) for ${path}${detail}`;
    case 401:
      return 'Audiobookshelf rejected the API key (401). Check ABS_API_KEY is correct, active and not expired.';
    case 403:
      return `The Audiobookshelf user this API key belongs to is not allowed to do this (403) for ${path}${detail}`;
    case 404:
      return `Not found in Audiobookshelf (404): ${path}${detail}`;
    default:
      return `Audiobookshelf returned HTTP ${status} for ${path}${detail}`;
  }
}
