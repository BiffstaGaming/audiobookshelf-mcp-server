import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AbsClient } from './abs/client.js';
import type { Config } from './config.js';
import { ServerContext } from './context.js';
import type { Logger } from './logger.js';
import { registerPrompts } from './prompts.js';
import { registerReadTools } from './tools/read.js';
import { registerWriteTools } from './tools/write.js';
import { VERSION } from './version.js';

export const SERVER_INSTRUCTIONS = `Tools for an Audiobookshelf (self-hosted audiobook server) library.
Everything is scoped to the user who owns the configured API key: progress, history and playlists are theirs.
For recommendations: call abs_get_taste_profile first, then propose candidates and filter them with abs_check_owned.
IDs (items, authors, series) come from search/list results; name arguments are also accepted where noted.
"stalled" means started but not touched for a while; it is a weak dislike signal, not a firm one.
Audiobookshelf only knows about books in the library: it cannot tell you about unowned books in a series.`;

export function createServer(config: Config, logger: Logger, client?: AbsClient) {
  const absClient =
    client ??
    new AbsClient({
      baseUrl: config.absUrl,
      apiKey: config.apiKey,
      timeoutMs: config.requestTimeoutMs,
      cacheTtlSeconds: config.cacheTtlSeconds,
      logger,
    });
  const ctx = new ServerContext(config, absClient, logger);

  const server = new McpServer(
    { name: 'audiobookshelf-mcp-server', version: VERSION },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, prompts: {} } },
  );

  registerReadTools(server, ctx);
  if (config.enableWriteTools) registerWriteTools(server, ctx);
  registerPrompts(server);

  return { server, ctx };
}
