import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables so the server
 * can be configured identically from Claude Desktop, Docker, systemd, etc.
 * See README.md ("Configuration") for the user-facing reference.
 */

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  absUrl: string;
  apiKey: string;
  /** Library IDs or names the server may use. Empty = every library the key can access. */
  libraryAllowlist: string[];
  /** Library ID or name used when a tool call does not specify one. */
  defaultLibrary: string | undefined;
  enableWriteTools: boolean;
  requestTimeoutMs: number;
  maxResults: number;
  descriptionMaxChars: number;
  stalledAfterDays: number;
  cacheTtlSeconds: number;
  logLevel: LogLevel;
  transport: 'stdio' | 'http';
  http: {
    host: string;
    port: number;
    path: string;
    authToken: string | undefined;
    allowedHosts: string[];
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const bool = (name: string, fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      ctx.addIssue({ code: 'custom', message: `${name} must be true or false (got "${v}")` });
      return z.NEVER;
    });

const int = (name: string, fallback: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} must be a whole number between ${min} and ${max} (got "${v}")`,
        });
        return z.NEVER;
      }
      return n;
    });

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  ABS_URL: optionalString,
  ABS_API_KEY: optionalString,
  ABS_TOKEN: optionalString,
  ABS_API_KEY_FILE: optionalString,
  ABS_LIBRARY_IDS: list,
  ABS_DEFAULT_LIBRARY: optionalString,
  ABS_ENABLE_WRITE_TOOLS: bool('ABS_ENABLE_WRITE_TOOLS', false),
  ABS_REQUEST_TIMEOUT_MS: int('ABS_REQUEST_TIMEOUT_MS', 30_000, 1_000, 300_000),
  ABS_MAX_RESULTS: int('ABS_MAX_RESULTS', 50, 1, 500),
  ABS_DESCRIPTION_MAX_CHARS: int('ABS_DESCRIPTION_MAX_CHARS', 300, 0, 10_000),
  ABS_STALLED_AFTER_DAYS: int('ABS_STALLED_AFTER_DAYS', 60, 1, 3650),
  ABS_CACHE_TTL_SECONDS: int('ABS_CACHE_TTL_SECONDS', 60, 0, 86_400),
  LOG_LEVEL: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? 'info').trim().toLowerCase() || 'info';
      if (!(LOG_LEVELS as readonly string[]).includes(s)) {
        ctx.addIssue({
          code: 'custom',
          message: `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`,
        });
        return z.NEVER;
      }
      return s as LogLevel;
    }),
  MCP_TRANSPORT: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const s = (v ?? 'stdio').trim().toLowerCase() || 'stdio';
      if (s !== 'stdio' && s !== 'http') {
        ctx.addIssue({ code: 'custom', message: 'MCP_TRANSPORT must be "stdio" or "http"' });
        return z.NEVER;
      }
      return s as 'stdio' | 'http';
    }),
  MCP_HTTP_HOST: optionalString,
  MCP_HTTP_PORT: int('MCP_HTTP_PORT', 3000, 1, 65_535),
  MCP_HTTP_PATH: optionalString,
  MCP_HTTP_AUTH_TOKEN: optionalString,
  MCP_HTTP_ALLOWED_HOSTS: list,
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`ABS_URL is not a valid URL: "${raw}". Example: http://192.168.1.10:13378`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('ABS_URL must start with http:// or https://');
  }
  url.search = '';
  url.hash = '';
  // Keep any sub-path (reverse proxies) but drop trailing slashes.
  return url.toString().replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  const e = parsed.data;

  if (!e.ABS_URL) {
    throw new ConfigError(
      'ABS_URL is required: the base URL of your Audiobookshelf server, e.g. http://192.168.1.10:13378',
    );
  }

  let apiKey = e.ABS_API_KEY ?? e.ABS_TOKEN;
  if (!apiKey && e.ABS_API_KEY_FILE) {
    try {
      apiKey = readFileSync(e.ABS_API_KEY_FILE, 'utf8').trim();
    } catch (err) {
      throw new ConfigError(
        `Could not read ABS_API_KEY_FILE "${e.ABS_API_KEY_FILE}": ${(err as Error).message}`,
      );
    }
  }
  if (!apiKey) {
    throw new ConfigError(
      'An Audiobookshelf API key is required. Set ABS_API_KEY (or ABS_API_KEY_FILE). ' +
        'Create one in Audiobookshelf under Settings → API Keys.',
    );
  }

  const host = e.MCP_HTTP_HOST ?? '127.0.0.1';
  let path = e.MCP_HTTP_PATH ?? '/mcp';
  if (!path.startsWith('/')) path = `/${path}`;

  if (e.MCP_TRANSPORT === 'http' && !isLoopbackHost(host) && !e.MCP_HTTP_AUTH_TOKEN) {
    throw new ConfigError(
      `MCP_HTTP_AUTH_TOKEN is required when MCP_HTTP_HOST is not a loopback address (got "${host}"). ` +
        'Anyone who can reach the port could otherwise read your library and listening history.',
    );
  }

  return {
    absUrl: normaliseBaseUrl(e.ABS_URL),
    apiKey,
    libraryAllowlist: e.ABS_LIBRARY_IDS,
    defaultLibrary: e.ABS_DEFAULT_LIBRARY,
    enableWriteTools: e.ABS_ENABLE_WRITE_TOOLS,
    requestTimeoutMs: e.ABS_REQUEST_TIMEOUT_MS,
    maxResults: e.ABS_MAX_RESULTS,
    descriptionMaxChars: e.ABS_DESCRIPTION_MAX_CHARS,
    stalledAfterDays: e.ABS_STALLED_AFTER_DAYS,
    cacheTtlSeconds: e.ABS_CACHE_TTL_SECONDS,
    logLevel: e.LOG_LEVEL,
    transport: e.MCP_TRANSPORT,
    http: {
      host,
      port: e.MCP_HTTP_PORT,
      path,
      authToken: e.MCP_HTTP_AUTH_TOKEN,
      allowedHosts: e.MCP_HTTP_ALLOWED_HOSTS,
    },
  };
}
