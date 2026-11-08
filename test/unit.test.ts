import { describe, expect, it, vi } from 'vitest';
import { AbsClient, encodeFilterValue } from '../src/abs/client.js';
import { ConfigError, loadConfig, normaliseBaseUrl } from '../src/config.js';
import { compareSequence, progressStatus, truncate } from '../src/format.js';
import { silentLogger } from '../src/logger.js';
import { mainTitle, normaliseTitle, scoreMatch } from '../src/match.js';
import { missingIntegers } from '../src/profile.js';

describe('config', () => {
  const base = { ABS_URL: 'http://abs:13378/', ABS_API_KEY: 'k' };

  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      absUrl: 'http://abs:13378',
      enableWriteTools: false,
      maxResults: 50,
      transport: 'stdio',
      http: { host: '127.0.0.1', port: 3000, path: '/mcp' },
    });
  });

  it('requires URL and key', () => {
    expect(() => loadConfig({ ABS_API_KEY: 'k' })).toThrow(/ABS_URL is required/);
    expect(() => loadConfig({ ABS_URL: 'http://x' })).toThrow(/API key is required/);
  });

  it('accepts the legacy ABS_TOKEN name', () => {
    expect(loadConfig({ ABS_URL: 'http://x', ABS_TOKEN: 't' }).apiKey).toBe('t');
  });

  it('validates values', () => {
    expect(() => loadConfig({ ...base, ABS_ENABLE_WRITE_TOOLS: 'maybe' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ABS_MAX_RESULTS: '0' })).toThrow(/between 1 and 500/);
    expect(() => loadConfig({ ...base, MCP_TRANSPORT: 'sse' })).toThrow(/stdio" or "http/);
  });

  it('requires an auth token for non-loopback HTTP', () => {
    expect(() => loadConfig({ ...base, MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '0.0.0.0' })).toThrow(
      /MCP_HTTP_AUTH_TOKEN is required/,
    );
    expect(
      loadConfig({ ...base, MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '0.0.0.0', MCP_HTTP_AUTH_TOKEN: 's' }).http
        .authToken,
    ).toBe('s');
  });

  it('keeps reverse-proxy sub-paths', () => {
    expect(normaliseBaseUrl('https://example.com/audiobookshelf/')).toBe(
      'https://example.com/audiobookshelf',
    );
    expect(() => normaliseBaseUrl('ftp://x')).toThrow(/http/);
  });
});

describe('client', () => {
  it('encodes filter values the way Audiobookshelf decodes them', () => {
    const encoded = encodeFilterValue('Science Fiction & Fantasy');
    expect(Buffer.from(decodeURIComponent(encoded), 'base64').toString()).toBe('Science Fiction & Fantasy');
  });

  it('retries GETs on 503 but not POSTs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ libraries: [] }));
    const c = new AbsClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      timeoutMs: 1000,
      cacheTtlSeconds: 0,
      logger: silentLogger,
      fetchImpl,
      maxRetries: 1,
    });
    expect(await c.libraries()).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const postFetch = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    const c2 = new AbsClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      timeoutMs: 1000,
      cacheTtlSeconds: 0,
      logger: silentLogger,
      fetchImpl: postFetch,
      maxRetries: 3,
    });
    await expect(c2.scanLibrary('l')).rejects.toThrow(/HTTP 503/);
    expect(postFetch).toHaveBeenCalledTimes(1);
  });

  it('caches GETs within the TTL', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({ libraries: [] }));
    const c = new AbsClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      timeoutMs: 1000,
      cacheTtlSeconds: 60,
      logger: silentLogger,
      fetchImpl,
    });
    await c.libraries();
    await c.libraries();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports unreachable servers helpfully', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const c = new AbsClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      timeoutMs: 1000,
      cacheTtlSeconds: 0,
      logger: silentLogger,
      fetchImpl,
      maxRetries: 0,
    });
    await expect(c.libraries()).rejects.toThrow(/Could not reach Audiobookshelf at http:\/\/x/);
  });
});

describe('matching', () => {
  it('normalises titles', () => {
    expect(normaliseTitle('The Hobbit (Unabridged)')).toBe('hobbit');
    expect(normaliseTitle('Café & Crêpes!')).toBe('cafe and crepes');
    expect(mainTitle('Dune: Deluxe Edition')).toBe('Dune');
    expect(mainTitle('Leviathan Wakes - The Expanse 1')).toBe('Leviathan Wakes');
  });

  it('scores candidates', () => {
    expect(
      scoreMatch(
        { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
        { title: 'Hobbit', author: 'J. R. R. Tolkien' },
      ),
    ).toBe('exact');
    expect(
      scoreMatch(
        { title: 'Mistborn: The Final Empire' },
        { title: 'Mistborn', subtitle: 'The Final Empire', author: 'B. Sanderson' },
      ),
    ).toBe('exact');
    expect(
      scoreMatch({ title: 'Dune', author: 'Brian Herbert' }, { title: 'Dune', author: 'Frank Herbert' }),
    ).toBe('exact');
    expect(
      scoreMatch({ title: 'Dune', author: 'Kevin Anderson' }, { title: 'Dune', author: 'Frank Herbert' }),
    ).toBe('possible');
    expect(scoreMatch({ title: 'Dune Messiah' }, { title: 'Dune', author: 'Frank Herbert' })).toBe(
      'possible',
    );
    expect(scoreMatch({ title: 'Emma' }, { title: 'Dune', author: null })).toBeNull();
  });
});

describe('format & profile helpers', () => {
  const p = (o: object) => ({
    id: 'p',
    libraryItemId: 'i',
    episodeId: null,
    duration: 1,
    progress: 0,
    currentTime: 0,
    isFinished: false,
    lastUpdate: Date.now(),
    startedAt: 0,
    finishedAt: null,
    ...o,
  });

  it('derives progress status', () => {
    expect(progressStatus(null, 60)).toBe('not-started');
    expect(progressStatus(p({ isFinished: true }), 60)).toBe('finished');
    expect(progressStatus(p({ currentTime: 10 }), 60)).toBe('in-progress');
    expect(progressStatus(p({ currentTime: 10, lastUpdate: Date.now() - 61 * 86_400_000 }), 60)).toBe(
      'stalled',
    );
  });

  it('sorts sequences naturally', () => {
    expect(['10', '2', null, '1.5', '1'].sort(compareSequence)).toEqual(['1', '1.5', '2', '10', null]);
  });

  it('finds whole-number gaps', () => {
    expect(missingIntegers(['1', '2', '4', '4.5', '7'])).toEqual([3, 5, 6]);
    expect(missingIntegers(['0.5'])).toEqual([]);
  });

  it('truncates and strips HTML', () => {
    expect(truncate('<p>Hello&nbsp;<b>world</b></p>', 100)).toBe('Hello world');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('anything', 0)).toBeUndefined();
  });
});
