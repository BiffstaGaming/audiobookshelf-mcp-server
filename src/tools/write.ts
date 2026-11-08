import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { UserFacingError, type ServerContext } from '../context.js';
import { safe } from './util.js';

/**
 * Write tools are only registered when ABS_ENABLE_WRITE_TOOLS=true. None of
 * them delete anything; they change progress, create/extend lists, or start a scan.
 */
export function registerWriteTools(server: McpServer, ctx: ServerContext) {
  const { client } = ctx;
  const itemIds = z.array(z.string().min(1)).min(1).max(200).describe('Library item IDs');

  async function assertItemsAllowed(ids: string[]) {
    const allowed = await ctx.allowedLibraryIds();
    const items = await client.itemsBatch(ids);
    const found = new Map(items.map((i) => [i.id, i]));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new UserFacingError(`Unknown item IDs: ${missing.join(', ')}`);
    const blocked = items.filter((i) => !allowed.has(i.libraryId)).map((i) => i.id);
    if (blocked.length) {
      throw new UserFacingError(
        `These items are in libraries this server may not use: ${blocked.join(', ')}`,
      );
    }
    const libs = new Set(items.map((i) => i.libraryId));
    return { items, libraryIds: libs };
  }

  server.registerTool(
    'abs_set_finished',
    {
      title: 'Mark finished / not finished',
      description: 'Mark books as finished or unfinished for the API key user (e.g. books read elsewhere).',
      inputSchema: { item_ids: itemIds, finished: z.boolean() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_set_finished', async ({ item_ids, finished }) => {
      await assertItemsAllowed(item_ids);
      for (const id of item_ids) await client.setFinished(id, finished);
      return { updated: item_ids.length, finished };
    }),
  );

  server.registerTool(
    'abs_create_collection',
    {
      title: 'Create collection',
      description:
        'Create a collection (visible to every user of that library) containing the given books. Requires the user to have update permission in Audiobookshelf.',
      inputSchema: {
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        item_ids: itemIds,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_create_collection', async ({ name, description, item_ids }) => {
      const { libraryIds } = await assertItemsAllowed(item_ids);
      if (libraryIds.size !== 1)
        throw new UserFacingError('All books in a collection must come from the same library.');
      const col = await client.createCollection([...libraryIds][0]!, name, item_ids, description);
      return { id: col.id, name: col.name, books: item_ids.length };
    }),
  );

  server.registerTool(
    'abs_add_to_collection',
    {
      title: 'Add to collection',
      description: 'Add books to an existing collection (books already in it are ignored).',
      inputSchema: { collection_id: z.string().min(1), item_ids: itemIds },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_add_to_collection', async ({ collection_id, item_ids }) => {
      await assertItemsAllowed(item_ids);
      const col = await client.addToCollection(collection_id, item_ids);
      return { id: col.id, name: col.name, books: col.books?.length ?? null };
    }),
  );

  server.registerTool(
    'abs_create_playlist',
    {
      title: 'Create playlist',
      description:
        'Create a personal playlist (only the API key user sees it) with books in the given order.',
      inputSchema: {
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        item_ids: itemIds,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_create_playlist', async ({ name, description, item_ids }) => {
      const { libraryIds } = await assertItemsAllowed(item_ids);
      if (libraryIds.size !== 1)
        throw new UserFacingError('All books in a playlist must come from the same library.');
      const pl = await client.createPlaylist([...libraryIds][0]!, name, item_ids, description);
      return { id: pl.id, name: pl.name, items: item_ids.length };
    }),
  );

  server.registerTool(
    'abs_add_to_playlist',
    {
      title: 'Add to playlist',
      description: 'Append books to one of your playlists.',
      inputSchema: { playlist_id: z.string().min(1), item_ids: itemIds },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_add_to_playlist', async ({ playlist_id, item_ids }) => {
      await assertItemsAllowed(item_ids);
      const pl = await client.addToPlaylist(playlist_id, item_ids);
      return { id: pl.id, name: pl.name, items: pl.items?.length ?? null };
    }),
  );

  server.registerTool(
    'abs_scan_library',
    {
      title: 'Scan library',
      description:
        'Ask Audiobookshelf to scan a library folder for new or changed files (e.g. right after a download finishes). Admin users only. Returns immediately; the scan runs in the background.',
      inputSchema: {
        library: z.string().optional().describe('Library ID or name. Default: the default library.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe(ctx, 'abs_scan_library', async ({ library }) => {
      const lib = await ctx.resolveLibrary(library);
      await client.scanLibrary(lib.id);
      return { scan_started: true, library: { id: lib.id, name: lib.name } };
    }),
  );
}
