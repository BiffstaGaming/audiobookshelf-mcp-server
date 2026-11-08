#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { startHttpServer } from './http.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `audiobookshelf-mcp-server ${VERSION}
MCP server for Audiobookshelf. Configure with environment variables:

  ABS_URL                 Audiobookshelf base URL (required), e.g. http://192.168.1.10:13378
  ABS_API_KEY             API key (required; or ABS_API_KEY_FILE / legacy ABS_TOKEN)
  ABS_LIBRARY_IDS         Comma-separated library IDs or names to allow (default: all)
  ABS_DEFAULT_LIBRARY     Library ID or name used when a tool call names none
  ABS_ENABLE_WRITE_TOOLS  true to enable progress/collection/playlist/scan tools (default false)
  MCP_TRANSPORT           stdio (default) or http

Full reference: https://github.com/BiffstaGaming/audiobookshelf-mcp-server#configuration`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel, [config.apiKey, config.http.authToken ?? '']);
  logger.info(
    `v${VERSION} → ${config.absUrl} (write tools ${config.enableWriteTools ? 'ON' : 'off'}, transport ${config.transport})`,
  );

  if (config.transport === 'http') {
    const httpServer = await startHttpServer(config, logger);
    const shutdown = () => httpServer.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const { server } = createServer(config, logger);
  await server.connect(new StdioServerTransport());
  const shutdown = () => void server.close().finally(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  const msg = err instanceof ConfigError ? err.message : `Fatal: ${(err as Error).stack ?? err}`;
  process.stderr.write(`[audiobookshelf-mcp] ${msg}\n`);
  process.exit(1);
});
