import { describe, expect, it } from 'vitest';
import { connect } from './helpers.js';

describe('tool registration', () => {
  it('exposes read tools only by default', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('abs_get_taste_profile');
    expect(names).toContain('abs_check_owned');
    expect(names).not.toContain('abs_set_finished');
    for (const t of (await client.listTools()).tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it('adds write tools when ABS_ENABLE_WRITE_TOOLS=true', async () => {
    const { client } = await connect({ ABS_ENABLE_WRITE_TOOLS: 'true' });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'abs_set_finished',
        'abs_create_collection',
        'abs_add_to_playlist',
        'abs_scan_library',
      ]),
    );
  });

  it('lists prompts', async () => {
    const { client } = await connect();
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(['recommend_audiobooks', 'continue_my_series']);
    const p = await client.getPrompt({
      name: 'recommend_audiobooks',
      arguments: { count: '3', mood: 'light' },
    });
    expect(JSON.stringify(p.messages)).toContain('Recommend 3 audiobooks for me (light)');
  });
});

describe('server info & libraries', () => {
  it('reports user, version and allowed libraries only', async () => {
    const { call } = await connect();
    const info = await call('abs_get_server_info');
    expect(info.user.username).toBe('chris');
    expect(info.server_version).toBe('2.37.2');
    expect(info.libraries.map((l: { id: string }) => l.id)).toEqual(['lib-books', 'lib-pods']);
    expect(info.default_library.id).toBe('lib-books');
    expect(info.write_tools_enabled).toBe(false);
  });

  it('rejects a library outside the allowlist', async () => {
    const { call } = await connect();
    const res = await call('abs_search_library', { query: 'secret', library: 'Hidden' });
    expect(res.error).toMatch(/not found or not allowed/);
  });

  it('surfaces a bad API key clearly', async () => {
    const { call } = await connect({ ABS_API_KEY: 'wrong' });
    const res = await call('abs_get_server_info');
    expect(res.error).toMatch(/rejected the API key \(401\)/);
  });
});

describe('search and browse', () => {
  it('searches and attaches progress, stripping HTML from descriptions', async () => {
    const { call } = await connect();
    const res = await call('abs_search_library', { query: 'kings' });
    expect(res.items).toHaveLength(1);
    const item = res.items[0];
    expect(item).toMatchObject({ id: 'i1', title: 'The Way of Kings', author: 'Brandon Sanderson' });
    expect(item.progress.status).toBe('finished');
    expect(item.description).toBe('Roshar is a world of stone and storms.');
    expect(item.duration_hours).toBe(45.5);
  });

  it('filters by author name (resolved to ID and base64-encoded)', async () => {
    const { call, fake } = await connect();
    const res = await call('abs_list_library_items', { author: 'sanderson' });
    expect(res.filter).toBe('author: Brandon Sanderson');
    expect(res.total).toBe(4);
    const req = fake.state.calls.find((c) => c.path === '/api/libraries/lib-books/items');
    expect(req).toBeTruthy();
  });

  it('defaults to series order when filtering by series', async () => {
    const { call } = await connect();
    const res = await call('abs_list_library_items', { series: 'Stormlight' });
    expect(res.items.map((i: { id: string }) => i.id)).toEqual(['i1', 'i2', 'i4']);
    expect(res.items[2].series_detail[0].sequence).toBe('4');
  });

  it('refuses more than one filter', async () => {
    const { call } = await connect();
    const res = await call('abs_list_library_items', { author: 'Weir', genre: 'Fantasy' });
    expect(res.error).toMatch(/one filter at a time/);
  });

  it('reports ambiguous names', async () => {
    const { call } = await connect();
    const res = await call('abs_list_library_items', { author: 'an' });
    expect(res.error).toMatch(/matches several authors/);
  });

  it('gets item details with chapters', async () => {
    const { call } = await connect();
    const res = await call('abs_get_item', { item_id: 'i8', include_chapters: true });
    expect(res.authors).toEqual([{ id: 'au-herb', name: 'Frank Herbert' }]);
    expect(res.progress).toMatchObject({ status: 'in-progress', percent: 50 });
    expect(res.chapters[1]).toEqual({ title: 'One', start_minutes: 10 });
  });

  it('hides items from disallowed libraries', async () => {
    const { call } = await connect();
    const res = await call('abs_get_item', { item_id: 'x1' });
    expect(res.error).toMatch(/not configured to use/);
  });

  it('gets a series with next unfinished book and gaps', async () => {
    const { call } = await connect();
    const res = await call('abs_get_series', { series: 'the stormlight archive' });
    expect(res.finished).toBe(2);
    expect(res.next_unfinished).toMatchObject({ id: 'i4', sequence: '4' });
    expect(res.missing_sequences_in_owned_range).toEqual([3]);
  });

  it('gets an author grouped by series', async () => {
    const { call } = await connect();
    const res = await call('abs_get_author', { author: 'Brandon Sanderson' });
    expect(res.books_in_library).toBe(4);
    expect(res.finished).toBe(2);
    expect(res.series.map((s: { name: string }) => s.name).sort()).toEqual([
      'Mistborn',
      'The Stormlight Archive',
    ]);
  });

  it('lists authors, series, facets, collections and playlists', async () => {
    const { call } = await connect();
    expect((await call('abs_list_authors')).authors[0]).toMatchObject({
      name: 'Brandon Sanderson',
      books: 4,
    });
    expect((await call('abs_list_series')).series).toHaveLength(2);
    const facets = await call('abs_get_library_facets', { facets: ['genres', 'narrators'] });
    expect(facets.genres).toContain('Fantasy');
    expect(facets.narrators).toContain('Ray Porter');
    expect((await call('abs_list_collections'))[0].name).toBe('Favourites');
    const pls = await call('abs_list_playlists');
    expect(pls.map((p: { id: string }) => p.id)).toEqual(['pl1']);
  });
});

describe('history', () => {
  it('lists progress with stalled detection and ignores podcast episodes / hidden libraries', async () => {
    const { call } = await connect();
    const all = await call('abs_get_listening_progress');
    expect(all.items.map((i: { id: string }) => i.id)).toEqual(['i8', 'i2', 'i1', 'i7']);
    const stalled = await call('abs_get_listening_progress', { status: 'stalled' });
    expect(stalled.items.map((i: { id: string }) => i.id)).toEqual(['i7']);
    const unfinished = await call('abs_get_listening_progress', { status: 'unfinished' });
    expect(unfinished.items).toHaveLength(2);
  });

  it('summarises listening stats', async () => {
    const { call } = await connect();
    const s = await call('abs_get_listening_stats');
    expect(s.hours_all_time).toBe(100);
    expect(s.hours_last_7_days).toBe(0.5);
    expect(s.hours_last_365_days).toBe(2.5);
    expect(s.most_listened[0]).toMatchObject({ id: 'i2', hours: 48 });
    expect((await call('abs_get_listening_stats', { year: 2025 })).stats.numBooksFinished).toBe(2);
    expect((await call('abs_get_listening_sessions')).sessions[0].device).toBe('Abs Android');
  });
});

describe('recommendation support', () => {
  it('builds a taste profile', async () => {
    const { call } = await connect();
    const p = await call('abs_get_taste_profile');
    expect(p.totals).toMatchObject({ books_finished: 2, books_in_progress: 1, books_stalled: 1 });
    expect(p.top_authors[0]).toMatchObject({ name: 'Brandon Sanderson', finished: 2 });
    expect(p.top_genres[0].name).toBe('Fantasy');
    expect(p.top_narrators.map((n: { name: string }) => n.name)).toContain('Kate Reading');
    expect(p.recently_finished.map((b: { id: string }) => b.id)).toEqual(['i2', 'i1']);
    expect(p.currently_listening[0].id).toBe('i8');
    expect(p.stalled[0].id).toBe('i7');
    const storm = p.series_status.find((s: { name: string }) => s.name === 'The Stormlight Archive');
    expect(storm).toMatchObject({ owned_count: 3, finished_count: 2, missing_sequences_in_owned_range: [3] });
    expect(storm.next_owned_unfinished.id).toBe('i4');
    const sand = p.unread_by_top_authors.find((a: { name: string }) => a.name === 'Brandon Sanderson');
    expect(sand.owned_not_started.map((b: { id: string }) => b.id).sort()).toEqual(['i4', 'i6']);
    // The finished book in the hidden library must not leak in.
    expect(JSON.stringify(p)).not.toContain('Secret Book');
  });

  it('checks ownership with fuzzy matching', async () => {
    const { call } = await connect();
    const res = await call('abs_check_owned', {
      books: [
        { title: 'Mistborn: The Final Empire', author: 'Brandon Sanderson' },
        { title: 'The Way of Kings (Unabridged)', author: 'Sanderson' },
        { title: 'Oathbringer', author: 'Brandon Sanderson' },
        { title: 'Dune', author: 'Someone Else' },
      ],
    });
    expect(res.owned).toBe(3);
    const [mist, kings, oath, dune] = res.results;
    expect(mist).toMatchObject({
      owned: true,
      confidence: 'exact',
      match: { id: 'i6', status: 'not-started' },
    });
    expect(kings).toMatchObject({ owned: true, match: { id: 'i1', status: 'finished' } });
    expect(oath.owned).toBe(false);
    expect(dune).toMatchObject({ owned: true, confidence: 'possible' });
    expect(res.not_owned).toEqual([{ title: 'Oathbringer', author: 'Brandon Sanderson' }]);
  });
});

describe('write tools', () => {
  it('marks finished and invalidates cached progress', async () => {
    const { call, fake } = await connect({ ABS_ENABLE_WRITE_TOOLS: 'true', ABS_CACHE_TTL_SECONDS: '600' });
    expect((await call('abs_get_item', { item_id: 'i6' })).progress.status).toBe('not-started');
    await call('abs_get_listening_progress'); // warm cache
    expect(await call('abs_set_finished', { item_ids: ['i6'], finished: true })).toEqual({
      updated: 1,
      finished: true,
    });
    const patch = fake.state.calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ path: '/api/me/progress/i6', body: { isFinished: true } });
    const fin = await call('abs_get_listening_progress', { status: 'finished' });
    expect(fin.items.map((i: { id: string }) => i.id)).toContain('i6');
  });

  it('refuses items outside allowed libraries', async () => {
    const { call } = await connect({ ABS_ENABLE_WRITE_TOOLS: 'true' });
    const res = await call('abs_set_finished', { item_ids: ['x1'], finished: true });
    expect(res.error).toMatch(/may not use/);
  });

  it('creates a collection and starts a scan', async () => {
    const { call, fake } = await connect({ ABS_ENABLE_WRITE_TOOLS: 'true' });
    const col = await call('abs_create_collection', { name: 'Next up', item_ids: ['i4', 'i6'] });
    expect(col).toEqual({ id: 'col-new', name: 'Next up', books: 2 });
    expect(fake.state.calls.find((c) => c.path === '/api/collections')?.body).toMatchObject({
      libraryId: 'lib-books',
      books: ['i4', 'i6'],
    });
    expect(await call('abs_scan_library')).toMatchObject({ scan_started: true });
  });
});
