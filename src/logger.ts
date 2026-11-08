import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  debug(msg: string, extra?: unknown): void;
}

/**
 * Logs go to stderr ONLY. With the stdio transport, stdout carries the MCP
 * protocol, so writing anything else there would corrupt the stream.
 */
export function createLogger(level: LogLevel, secrets: string[] = []): Logger {
  const redact = (s: string) =>
    secrets.reduce((acc, secret) => (secret ? acc.split(secret).join('***') : acc), s);

  const write = (lvl: LogLevel, msg: string, extra?: unknown) => {
    if (ORDER[lvl] > ORDER[level]) return;
    let line = `[audiobookshelf-mcp] ${new Date().toISOString()} ${lvl.toUpperCase()} ${msg}`;
    if (extra !== undefined) {
      const detail = extra instanceof Error ? extra.message : JSON.stringify(extra);
      line += ` ${detail}`;
    }
    process.stderr.write(`${redact(line)}\n`);
  };

  return {
    error: (m, e) => write('error', m, e),
    warn: (m, e) => write('warn', m, e),
    info: (m, e) => write('info', m, e),
    debug: (m, e) => write('debug', m, e),
  };
}

export const silentLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};
