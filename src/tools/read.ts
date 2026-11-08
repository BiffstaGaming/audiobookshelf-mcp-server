import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AbsLibraryItem } from '../abs/types.js';
import { UserFacingError, type ServerContext } from '../context.js';
import { formatItem, hours, isoDate, progressStatus, truncate, type FormatOptions } from '../format.js';
import { CONFIDENCE_RANK, mainTitle, scoreMatch, type MatchConfidence } from '../match.js';
import { buildTasteProfile, mapLimit, missingIntegers, seriesBooks } from '../profile.js';
import { resolveNamed, resolveValue, safe, type FacetKey } from './util.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const libraryArg = z
  .string()
  .optional()
  .describe(
    'Library ID or name. Omit to use the default library (ABS_DEFAULT_LIBRARY, else the first audiobook library).',
  );

export function registerReadTools(server: McpServer, ctx: ServerContext) {
  const { client, config } = ctx;
  const fmt = (item: AbsLibraryItem, extra: Partial<FormatOptions> = {}) =>
    formatItem(item, {
      descriptionMaxChars: config.descriptionMaxChars,
      stalledAfterDays: config.stalledAfterDays,
      ...extra,
    });

  // ------------------------------------------------------------ server info
  server.registerTool(
    'abs_get_server_info',
    {
      title: 'Audiobookshelf connection info',
      description:
        'Check the connection and see who the API key belongs to, the server version, the libraries this server may use, and whether write tools are enabled. Call this first if other tools fail.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_server_info', async () => {
      const [auth, libs] = await Promise.all([client.authorize(), ctx.allowedLibraries()]);
      const def = await ctx.resolveLibrary().catch(() => null);
      return {
        server_url: config.absUrl,
        server_version: auth.serverSettings?.version ?? null,
        user: { id: auth.user.id, username: auth.user.username, type: auth.user.type },
        libraries: libs.map((l) => ({ id: l.id, name: l.name, media_type: l.mediaType })),
        default_library: def ? { id: def.id, name: def.name } : null,
        write_tools_enabled: config.enableWriteTools,
      };
    }),
  );

  server.registerTool(
    'abs_list_libraries',
    {
      title: 'List libraries',
      description: 'List the Audiobookshelf libraries this server can use, with item counts.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_libraries', async () => {
      const libs = await ctx.allowedLibraries();
      return mapLimit(libs, 4, async (l) => {
        const fd = await client.filterData(l.id).catch(() => null);
        return {
          id: l.id,
          name: l.name,
          media_type: l.mediaType,
          books: fd?.bookCount ?? null,
          podcasts: fd?.podcastCount ?? null,
          authors: fd?.authorCount ?? null,
          series: fd?.seriesCount ?? null,
        };
      });
    }),
  );

  // ----------------------------------------------------------------- search
  server.registerTool(
    'abs_search_library',
    {
      title: 'Search library',
      description:
        'Full-text search of one library: matches book titles/subtitles, authors, series, narrators, genres and tags. Best for "do I have X?" or finding an ID. For checking many candidate titles at once use abs_check_owned.',
      inputSchema: {
        query: z.string().min(1).describe('Search text, e.g. a title, author or series name'),
        library: libraryArg,
        limit: z.number().int().min(1).max(100).optional().describe('Max matches per category (default 10)'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_search_library', async ({ query, library, limit }) => {
      const lib = await ctx.resolveLibrary(library);
      const n = ctx.clampLimit(limit, 10);
      const [res, progress] = await Promise.all([client.search(lib.id, query, n), ctx.progressByItem()]);
      const items = [...(res.book ?? []), ...(res.podcast ?? [])].map((m) =>
        fmt(m.libraryItem, { progress: progress.get(m.libraryItem.id) ?? null, includeProgress: true }),
      );
      return {
        library: { id: lib.id, name: lib.name },
        items,
        authors: (res.authors ?? []).map((a) => ({ id: a.id, name: a.name, books: a.numBooks ?? null })),
        series: (res.series ?? []).map((s) => ({
          id: s.series.id,
          name: s.series.name,
          books_in_library: s.books?.length ?? null,
        })),
        narrators: res.narrators ?? [],
        genres: res.genres ?? [],
        tags: res.tags ?? [],
      };
    }),
  );

  // ------------------------------------------------------------- list items
  const SORTS = {
    title: 'media.metadata.title',
    author: 'media.metadata.authorNameLF',
    added: 'addedAt',
    published: 'media.metadata.publishedYear',
    duration: 'media.duration',
    progress_updated: 'progress',
    finished_at: 'progress.finishedAt',
    random: 'random',
    series_order: 'sequence',
  } as const;

  server.registerTool(
    'abs_list_library_items',
    {
      title: 'Browse library items',
      description:
        'Browse a library with ONE optional filter (author, series, genre, tag, narrator, language, publisher or your progress) plus sorting and paging. Names are matched case-insensitively. Use for "show me all X" questions.',
      inputSchema: {
        library: libraryArg,
        author: z.string().optional().describe('Author name or ID'),
        series: z.string().optional().describe('Series name or ID (results come in series order by default)'),
        genre: z.string().optional(),
        tag: z.string().optional(),
        narrator: z.string().optional(),
        language: z.string().optional(),
        publisher: z.string().optional(),
        progress: z
          .enum(['finished', 'in-progress', 'not-started', 'not-finished'])
          .optional()
          .describe("Filter by the API key user's progress"),
        recently_added: z.boolean().optional().describe('Only items added in the last 60 days'),
        sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).optional(),
        descending: z.boolean().optional(),
        page: z.number().int().min(0).optional().describe('Zero-based page'),
        limit: z.number().int().min(1).max(500).optional().describe('Items per page (default 25)'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_library_items', async (a) => {
      const lib = await ctx.resolveLibrary(a.library);
      const chosen = (
        [
          'author',
          'series',
          'genre',
          'tag',
          'narrator',
          'language',
          'publisher',
          'progress',
          'recently_added',
        ] as const
      ).filter((k) => a[k] !== undefined && a[k] !== false);
      if (chosen.length > 1) {
        throw new UserFacingError(
          `Audiobookshelf supports one filter at a time; got ${chosen.join(', ')}. Pick one and narrow further by reading results.`,
        );
      }

      let filter: { group: string; value: string } | undefined;
      let filterLabel: string | undefined;
      const key = chosen[0];
      if (key) {
        const fd = key === 'progress' || key === 'recently_added' ? null : await client.filterData(lib.id);
        if (key === 'author') {
          const r = resolveNamed(fd!.authors, a.author!, 'authors');
          filter = { group: 'authors', value: r.id };
          filterLabel = `author: ${r.name}`;
        } else if (key === 'series') {
          const r = resolveNamed(fd!.series, a.series!, 'series');
          filter = { group: 'series', value: r.id };
          filterLabel = `series: ${r.name}`;
        } else if (key === 'progress') {
          filter = { group: 'progress', value: a.progress! };
          filterLabel = `progress: ${a.progress}`;
        } else if (key === 'recently_added') {
          filter = { group: 'recent', value: '' };
          filterLabel = 'added in last 60 days';
        } else {
          const facet = `${key}s` as FacetKey;
          const v = resolveValue(fd![facet], a[key]!, facet);
          filter = { group: facet, value: v };
          filterLabel = `${key}: ${v}`;
        }
      }

      const sortKey = a.sort ?? (key === 'series' ? 'series_order' : undefined);
      if (sortKey === 'series_order' && key !== 'series') {
        throw new UserFacingError('sort "series_order" only works together with the series filter.');
      }
      const limit = ctx.clampLimit(a.limit, 25);
      const page = a.page ?? 0;
      // "recent" is a filter group without a value; ABS reads it as filter=recent.
      const res =
        filter?.group === 'recent'
          ? await client.request<{ results: AbsLibraryItem[]; total?: number }>(
              'GET',
              `/api/libraries/${lib.id}/items`,
              {
                query: {
                  limit,
                  page,
                  sort: SORTS[sortKey ?? 'added'],
                  desc: a.descending ?? true,
                  minified: true,
                },
                rawFilter: 'recent',
              },
            )
          : await client.libraryItems(lib.id, {
              limit,
              page,
              sort: sortKey ? SORTS[sortKey] : undefined,
              desc: a.descending,
              filter,
            });
      const progress = await ctx.progressByItem();
      const total = res.total ?? null;
      return {
        library: { id: lib.id, name: lib.name },
        filter: filterLabel ?? null,
        page,
        limit,
        total,
        has_more: total !== null ? (page + 1) * limit < total : res.results.length === limit,
        items: res.results.map((i) =>
          fmt(i, { progress: progress.get(i.id) ?? null, includeProgress: true }),
        ),
      };
    }),
  );

  // ---------------------------------------------------------------- one item
  server.registerTool(
    'abs_get_item',
    {
      title: 'Get item details',
      description:
        'Full details for one library item: authors, narrators, series with sequence, genres, tags, description, length, and your progress. Optionally the chapter list.',
      inputSchema: {
        item_id: z.string().min(1).describe('Library item ID'),
        include_chapters: z.boolean().optional(),
        full_description: z
          .boolean()
          .optional()
          .describe('Return the whole description instead of a truncated one'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_item', async ({ item_id, include_chapters, full_description }) => {
      const item = await client.item(item_id);
      const allowed = await ctx.allowedLibraryIds();
      if (!allowed.has(item.libraryId)) {
        throw new UserFacingError('That item is in a library this server is not configured to use.');
      }
      const view: Record<string, unknown> = {
        ...fmt(item, {
          includeProgress: true,
          descriptionMaxChars: full_description ? 100_000 : config.descriptionMaxChars,
        }),
      };
      const m = item.media.metadata;
      view.authors = (m.authors ?? []).map((a) => ({ id: a.id, name: a.name }));
      if (m.isbn) view.isbn = m.isbn;
      if (m.asin) view.asin = m.asin;
      if (m.publisher) view.publisher = m.publisher;
      if (m.publishedDate) view.published_date = m.publishedDate;
      if (item.media.numChapters ?? item.media.chapters?.length) {
        view.chapter_count = item.media.numChapters ?? item.media.chapters?.length;
      }
      if (include_chapters && item.media.chapters) {
        view.chapters = item.media.chapters.map((c) => ({
          title: c.title,
          start_minutes: Math.round(c.start / 6) / 10,
        }));
      }
      return view;
    }),
  );

  // ----------------------------------------------------------------- authors
  server.registerTool(
    'abs_list_authors',
    {
      title: 'List authors',
      description: 'List authors in a library with how many books of theirs it holds.',
      inputSchema: {
        library: libraryArg,
        sort: z
          .enum(['name', 'num_books', 'added'])
          .optional()
          .describe('Default num_books (most books first)'),
        page: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_authors', async ({ library, sort, page, limit }) => {
      const lib = await ctx.resolveLibrary(library);
      const s = sort ?? 'num_books';
      const n = ctx.clampLimit(limit, 50);
      const res = await client.authors(lib.id, {
        limit: n,
        page: page ?? 0,
        sort: s === 'num_books' ? 'numBooks' : s === 'added' ? 'addedAt' : 'name',
        desc: s !== 'name',
      });
      const list = res.results ?? res.authors ?? [];
      return {
        library: { id: lib.id, name: lib.name },
        total: res.total ?? list.length,
        page: page ?? 0,
        authors: list.map((a) => ({ id: a.id, name: a.name, books: a.numBooks ?? null })),
      };
    }),
  );

  server.registerTool(
    'abs_get_author',
    {
      title: 'Get author',
      description:
        "An author's books in the library, grouped by series, each with your progress. Accepts a name or ID.",
      inputSchema: { author: z.string().min(1).describe('Author name or ID'), library: libraryArg },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_author', async ({ author, library }) => {
      const lib = await ctx.resolveLibrary(library);
      const fd = await client.filterData(lib.id);
      const ref = resolveNamed(fd.authors, author, 'authors');
      const [a, progress] = await Promise.all([client.author(ref.id), ctx.progressByItem()]);
      const status = (id: string) => progressStatus(progress.get(id), config.stalledAfterDays);
      const books = (a.libraryItems ?? []).map((i) => ({
        id: i.id,
        title: i.media.metadata.title ?? '(untitled)',
        series: i.media.metadata.seriesName || null,
        published_year: i.media.metadata.publishedYear ?? null,
        duration_hours: hours(i.media.duration),
        status: status(i.id),
      }));
      return {
        id: a.id,
        name: a.name,
        description: truncate(a.description, config.descriptionMaxChars) ?? null,
        books_in_library: books.length,
        finished: books.filter((b) => b.status === 'finished').length,
        series: (a.series ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          books: s.items.map((i) => {
            const ref2 = i.media.metadata.series;
            const seq = ref2 && !Array.isArray(ref2) ? (ref2.sequence ?? null) : null;
            return {
              id: i.id,
              title: i.media.metadata.title ?? '(untitled)',
              sequence: seq,
              status: status(i.id),
            };
          }),
        })),
        books,
      };
    }),
  );

  // ------------------------------------------------------------------ series
  server.registerTool(
    'abs_list_series',
    {
      title: 'List series',
      description: 'List series in a library with the number of books held for each.',
      inputSchema: {
        library: libraryArg,
        sort: z.enum(['name', 'num_books', 'added', 'last_book_added']).optional(),
        page: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_series', async ({ library, sort, page, limit }) => {
      const lib = await ctx.resolveLibrary(library);
      const s = sort ?? 'name';
      const n = ctx.clampLimit(limit, 25);
      const res = await client.seriesList(lib.id, {
        limit: n,
        page: page ?? 0,
        sort: { name: 'name', num_books: 'numBooks', added: 'addedAt', last_book_added: 'lastBookAdded' }[s],
        desc: s !== 'name',
      });
      return {
        library: { id: lib.id, name: lib.name },
        total: res.total,
        page: page ?? 0,
        series: res.results.map((x) => ({
          id: x.id,
          name: x.name,
          books_in_library: x.books?.length ?? 0,
          authors: [...new Set((x.books ?? []).map((b) => b.media.metadata.authorName).filter(Boolean))],
        })),
      };
    }),
  );

  server.registerTool(
    'abs_get_series',
    {
      title: 'Get series',
      description:
        'Books of one series that are in the library, in reading order, with your status for each, the next unfinished one, and whole-number gaps in the owned sequence (e.g. own 1, 2, 4 → missing 3). Books never added to the library are not known to Audiobookshelf.',
      inputSchema: { series: z.string().min(1).describe('Series name or ID'), library: libraryArg },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_series', async ({ series, library }) => {
      const lib = await ctx.resolveLibrary(library);
      const fd = await client.filterData(lib.id);
      const ref = resolveNamed(fd.series, series, 'series');
      const progress = await ctx.progressByItem();
      const books = await seriesBooks(ctx, lib.id, ref.id, progress);
      const next = books.find((b) => b.status !== 'finished');
      return {
        id: ref.id,
        name: ref.name,
        books_in_library: books.length,
        finished: books.filter((b) => b.status === 'finished').length,
        next_unfinished: next ?? null,
        missing_sequences_in_owned_range: missingIntegers(
          books.map((b) => b.sequence).filter((x): x is string => !!x),
        ),
        books,
      };
    }),
  );

  // ------------------------------------------------------------------ facets
  server.registerTool(
    'abs_get_library_facets',
    {
      title: 'Genres, tags, narrators…',
      description:
        'The distinct genres, tags, narrators, languages and publishers present in a library — useful for exact filter values and for describing the collection.',
      inputSchema: {
        library: libraryArg,
        facets: z
          .array(z.enum(['genres', 'tags', 'narrators', 'languages', 'publishers', 'publishedDecades']))
          .optional()
          .describe('Which lists to return (default: genres, tags, languages)'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_library_facets', async ({ library, facets }) => {
      const lib = await ctx.resolveLibrary(library);
      const fd = await client.filterData(lib.id);
      const want = facets ?? ['genres', 'tags', 'languages'];
      const out: Record<string, unknown> = {
        library: { id: lib.id, name: lib.name },
        counts: {
          books: fd.bookCount ?? null,
          authors: fd.authorCount ?? null,
          series: fd.seriesCount ?? null,
        },
      };
      for (const f of want) out[f] = fd[f] ?? [];
      return out;
    }),
  );

  // ------------------------------------------------------- progress & history
  server.registerTool(
    'abs_get_listening_progress',
    {
      title: 'My progress',
      description:
        'Books the API key user has started or finished, newest activity first. "stalled" = started but untouched for longer than ABS_STALLED_AFTER_DAYS.',
      inputSchema: {
        status: z
          .enum(['all', 'finished', 'in-progress', 'stalled', 'unfinished'])
          .optional()
          .describe('Default all. unfinished = in-progress + stalled'),
        library: z
          .string()
          .optional()
          .describe('Restrict to one library (ID or name). Default: all allowed libraries.'),
        page: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_listening_progress', async ({ status, library, page, limit }) => {
      const want = status ?? 'all';
      const allowed = library
        ? new Set([(await ctx.resolveLibrary(library)).id])
        : await ctx.allowedLibraryIds();
      const progress = [...(await ctx.progressByItem()).values()]
        .map((p) => ({ p, s: progressStatus(p, config.stalledAfterDays) }))
        .filter(({ s }) => s !== 'not-started')
        .filter(({ s }) =>
          want === 'all' ? true : want === 'unfinished' ? s === 'in-progress' || s === 'stalled' : s === want,
        )
        .sort((a, b) => (b.p.finishedAt ?? b.p.lastUpdate) - (a.p.finishedAt ?? a.p.lastUpdate));

      // Fetch details only for what we will show; library filtering needs the item.
      const n = ctx.clampLimit(limit, 25);
      const pg = page ?? 0;
      const out: ReturnType<typeof fmt>[] = [];
      let skipped = 0;
      let cursor = 0;
      const chunk = 50;
      while (out.length < n && cursor < progress.length) {
        const slice = progress.slice(cursor, cursor + chunk);
        cursor += chunk;
        const items = await client.itemsBatch(slice.map((x) => x.p.libraryItemId!));
        const byId = new Map(items.map((i) => [i.id, i]));
        for (const { p } of slice) {
          const item = byId.get(p.libraryItemId!);
          if (!item || !allowed.has(item.libraryId)) continue;
          if (skipped < pg * n) {
            skipped++;
            continue;
          }
          if (out.length < n) out.push(fmt(item, { progress: p, descriptionMaxChars: 0 }));
        }
      }
      return {
        status: want,
        page: pg,
        limit: n,
        matching_progress_records: progress.length,
        items: out,
      };
    }),
  );

  server.registerTool(
    'abs_get_listening_stats',
    {
      title: 'Listening stats',
      description:
        'Listening time totals (all time, last 7/30/365 days), by weekday, most-listened items, and recent sessions. Pass year for that year’s Audiobookshelf "year in review" stats.',
      inputSchema: {
        year: z.number().int().min(2000).max(9999).optional(),
        top_items: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('How many most-listened items (default 10)'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_listening_stats', async ({ year, top_items }) => {
      if (year) return { year, stats: await client.yearStats(year) };
      const s = await client.listeningStats();
      const now = Date.now();
      const sinceDays = (d: number) =>
        Object.entries(s.days ?? {}).reduce(
          (acc, [day, secs]) => (Date.parse(day) >= now - d * 86_400_000 ? acc + secs : acc),
          0,
        );
      const topN = Math.min(top_items ?? 10, config.maxResults);
      return {
        hours_all_time: hours(s.totalTime),
        hours_today: hours(s.today),
        hours_last_7_days: hours(sinceDays(7)),
        hours_last_30_days: hours(sinceDays(30)),
        hours_last_365_days: hours(sinceDays(365)),
        days_listened: Object.keys(s.days ?? {}).length,
        hours_by_weekday: Object.fromEntries(
          Object.entries(s.dayOfWeek ?? {}).map(([d, v]) => [d, hours(v)]),
        ),
        most_listened: Object.values(s.items ?? {})
          .sort((a, b) => b.timeListening - a.timeListening)
          .slice(0, topN)
          .map((i) => ({ id: i.id, title: i.mediaMetadata?.title ?? null, hours: hours(i.timeListening) })),
        recent_sessions: (s.recentSessions ?? []).slice(0, 10).map((x) => ({
          item_id: x.libraryItemId,
          title: x.displayTitle ?? null,
          author: x.displayAuthor ?? null,
          date: x.date ?? isoDate(x.startedAt),
          minutes: Math.round(Number(x.timeListening ?? 0) / 60),
        })),
      };
    }),
  );

  server.registerTool(
    'abs_get_listening_sessions',
    {
      title: 'Listening sessions',
      description:
        'Individual listening sessions (newest first): what was played, when, for how long, on which device.',
      inputSchema: {
        page: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_listening_sessions', async ({ page, limit }) => {
      const res = await client.listeningSessions(page ?? 0, ctx.clampLimit(limit, 20));
      return {
        total: res.total,
        page: res.page,
        pages: res.numPages,
        sessions: res.sessions.map((x) => ({
          item_id: x.libraryItemId,
          title: x.displayTitle ?? null,
          author: x.displayAuthor ?? null,
          date: x.date ?? isoDate(x.startedAt),
          weekday: x.dayOfWeek ?? null,
          minutes: Math.round(Number(x.timeListening ?? 0) / 60),
          device: x.deviceInfo?.clientName ?? x.deviceInfo?.deviceName ?? null,
        })),
      };
    }),
  );

  // ----------------------------------------------------------- recommendation
  server.registerTool(
    'abs_get_taste_profile',
    {
      title: 'Taste profile (for recommendations)',
      description:
        'One-call summary of the user’s listening taste for making recommendations: top authors, series, genres, narrators and tags weighted by engagement; length and era preferences; recently finished, current and stalled books; per-series status (next owned unfinished book, gaps); and unread books already owned by favourite authors. Use before recommending, then verify candidates with abs_check_owned.',
      inputSchema: {
        library: z.string().optional().describe('Restrict to one library. Default: all allowed libraries.'),
        top_n: z.number().int().min(3).max(50).optional().describe('Entries per ranking (default 10)'),
        include_series_status: z.boolean().optional().describe('Default true'),
        max_series: z.number().int().min(1).max(50).optional().describe('Series to analyse (default 10)'),
        include_unread_by_top_authors: z.boolean().optional().describe('Default true'),
        max_authors: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe('Top authors to check for unread owned books (default 5)'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_get_taste_profile', async (a) =>
      buildTasteProfile(ctx, {
        libraryId: a.library,
        topN: a.top_n ?? 10,
        includeSeriesStatus: a.include_series_status ?? true,
        maxSeries: a.max_series ?? 10,
        includeUnreadByTopAuthors: a.include_unread_by_top_authors ?? true,
        maxAuthors: a.max_authors ?? 5,
      }),
    ),
  );

  server.registerTool(
    'abs_check_owned',
    {
      title: 'Check which books are already owned',
      description:
        'Given candidate books (title + optional author), report which are already in the library and whether the user has listened to them. Tolerates subtitles, leading articles, punctuation and "(Unabridged)". confidence: exact | likely | possible. Use to filter recommendations before requesting downloads.',
      inputSchema: {
        books: z
          .array(z.object({ title: z.string().min(1), author: z.string().optional() }))
          .min(1)
          .max(50),
        library: z
          .string()
          .optional()
          .describe('Library ID or name. Default: search every allowed book library.'),
      },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_check_owned', async ({ books, library }) => {
      const libs = library
        ? [await ctx.resolveLibrary(library)]
        : (await ctx.allowedLibraries()).filter((l) => l.mediaType === 'book');
      if (!libs.length) throw new UserFacingError('No audiobook libraries are available to check.');
      const progress = await ctx.progressByItem();

      type OwnedResult = {
        query: { title: string; author?: string };
        owned: boolean;
        confidence?: MatchConfidence;
        match?: Record<string, unknown>;
      };
      const results = await mapLimit(books, 4, async (wanted): Promise<OwnedResult> => {
        // ABS search is substring-based, so also try the title without
        // bracketed notes ("(Unabridged)") and without a subtitle.
        const stripped = wanted.title
          .replace(/[([{].*?[)\]}]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const queries = [
          ...new Set([wanted.title.trim(), stripped, mainTitle(stripped).trim()].filter((q) => q.length > 0)),
        ];
        let best: { item: AbsLibraryItem; confidence: MatchConfidence } | null = null;
        for (const lib of libs) {
          for (const q of queries) {
            const res = await client.search(lib.id, q, 10);
            for (const m of res.book ?? []) {
              const md = m.libraryItem.media.metadata;
              const conf = scoreMatch(wanted, {
                title: md.title ?? '',
                subtitle: md.subtitle,
                author: md.authorName ?? md.authors?.map((x) => x.name).join(', ') ?? null,
              });
              if (conf && (!best || CONFIDENCE_RANK[conf] > CONFIDENCE_RANK[best.confidence])) {
                best = { item: m.libraryItem, confidence: conf };
              }
            }
            if (best?.confidence === 'exact') break;
          }
          if (best?.confidence === 'exact') break;
        }
        if (!best) return { query: wanted, owned: false };
        const p = progress.get(best.item.id);
        return {
          query: wanted,
          owned: true,
          confidence: best.confidence,
          match: {
            id: best.item.id,
            title: best.item.media.metadata.title,
            author: best.item.media.metadata.authorName ?? null,
            series: best.item.media.metadata.seriesName || null,
            library_id: best.item.libraryId,
            status: progressStatus(p, config.stalledAfterDays),
          },
        };
      });
      return {
        checked: results.length,
        owned: results.filter((r) => r.owned).length,
        not_owned: results.filter((r) => !r.owned).map((r) => r.query),
        results,
      };
    }),
  );

  // -------------------------------------------------- collections & playlists
  server.registerTool(
    'abs_list_collections',
    {
      title: 'List collections',
      description: 'Collections in a library (shared, curated lists) with their books.',
      inputSchema: { library: libraryArg },
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_collections', async ({ library }) => {
      const lib = await ctx.resolveLibrary(library);
      const cols = await client.collections(lib.id);
      return cols.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
        books: (c.books ?? []).map((b) => ({
          id: b.id,
          title: b.media.metadata.title,
          author: b.media.metadata.authorName ?? null,
        })),
      }));
    }),
  );

  server.registerTool(
    'abs_list_playlists',
    {
      title: 'List playlists',
      description: "The API key user's playlists (personal, ordered lists) across allowed libraries.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(ctx, 'abs_list_playlists', async () => {
      const allowed = await ctx.allowedLibraryIds();
      const lists = (await client.playlists()).filter((p) => allowed.has(p.libraryId));
      return lists.map((p) => ({
        id: p.id,
        name: p.name,
        library_id: p.libraryId,
        description: p.description ?? null,
        items: (p.items ?? []).map((i) => ({
          id: i.libraryItemId,
          title: i.libraryItem?.media.metadata.title ?? null,
        })),
      }));
    }),
  );
}
