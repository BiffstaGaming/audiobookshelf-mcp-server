import { timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AbsClient } from './abs/client.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { createServer } from './server.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function tokenMatches(header: string | undefined, expected: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

/**
 * Streamable HTTP transport in stateless mode: every POST gets a fresh MCP
 * server bound to a shared Audiobookshelf client (so its cache is shared).
 * Suited to Docker / remote deployments; stdio is simpler for desktop use.
 */
export function startHttpServer(config: Config, logger: Logger, absClient?: AbsClient): Promise<Server> {
  const client =
    absClient ??
    new AbsClient({
      baseUrl: config.absUrl,
      apiKey: config.apiKey,
      timeoutMs: config.requestTimeoutMs,
      cacheTtlSeconds: config.cacheTtlSeconds,
      logger,
    });
  const { host, port, path, authToken, allowedHosts } = config.http;

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };

    if (url.pathname === '/healthz' && req.method === 'GET') return send(200, { ok: true });
    if (url.pathname !== path) return send(404, { error: 'Not found' });
    if (authToken && !tokenMatches(req.headers.authorization, authToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return send(401, { error: 'Unauthorized' });
    }
    if (req.method !== 'POST') {
      // Stateless mode: no server-initiated streams or sessions to resume/delete.
      res.setHeader('Allow', 'POST');
      return send(405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (err) {
      return send(400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: (err as Error).message },
        id: null,
      });
    }

    const { server } = createServer(config, logger, client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...(allowedHosts.length ? { allowedHosts, enableDnsRebindingProtection: true } : {}),
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      logger.error('HTTP request failed', err);
      send(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      logger.info(
        `MCP Streamable HTTP listening on http://${host}:${port}${path}${authToken ? ' (bearer auth on)' : ''}`,
      );
      resolve(httpServer);
    });
  });
}
