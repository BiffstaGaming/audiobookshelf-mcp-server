import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { AbsClient } from '../src/abs/client.js';
import { loadConfig } from '../src/config.js';
import { startHttpServer } from '../src/http.js';
import { silentLogger } from '../src/logger.js';
import { API_KEY, createFakeAbs } from './fake-abs.js';

describe('Streamable HTTP transport', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const config = loadConfig({
      ABS_URL: 'http://abs.test',
      ABS_API_KEY: API_KEY,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_PORT: '1',
      MCP_HTTP_AUTH_TOKEN: 'sekret',
    });
    config.http.port = 0; // pick a free port
    const abs = new AbsClient({
      baseUrl: config.absUrl,
      apiKey: API_KEY,
      timeoutMs: 5000,
      cacheTtlSeconds: 0,
      logger: silentLogger,
      fetchImpl: createFakeAbs().fetch,
    });
    server = await startHttpServer(config, silentLogger, abs);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('serves a health check without auth', async () => {
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
  });

  it('rejects missing or wrong bearer tokens', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    const res2 = await fetch(`${base}/mcp`, {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer nope' },
    });
    expect(res2.status).toBe(401);
  });

  it('answers MCP requests end to end', async () => {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer sekret' } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);
    const res = await client.callTool({ name: 'abs_search_library', arguments: { query: 'dune' } });
    expect((res.content as { text: string }[])[0]!.text).toContain('Frank Herbert');
    await client.close();
  });
});
