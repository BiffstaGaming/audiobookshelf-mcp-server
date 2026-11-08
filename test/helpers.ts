import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AbsClient } from '../src/abs/client.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { createServer } from '../src/server.js';
import { API_KEY, createFakeAbs } from './fake-abs.js';

export async function connect(env: Record<string, string> = {}) {
  const config = loadConfig({
    ABS_URL: 'http://abs.test:13378',
    ABS_API_KEY: API_KEY,
    ABS_LIBRARY_IDS: 'Audiobooks,lib-pods',
    ABS_CACHE_TTL_SECONDS: '0',
    ...env,
  });
  const fake = createFakeAbs();
  const abs = new AbsClient({
    baseUrl: config.absUrl,
    apiKey: config.apiKey,
    timeoutMs: 5000,
    cacheTtlSeconds: config.cacheTtlSeconds,
    logger: silentLogger,
    fetchImpl: fake.fetch,
    maxRetries: 0,
  });
  const { server } = createServer(config, silentLogger, abs);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? '';
    if (res.isError) return { error: text } as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return JSON.parse(text) as any;
  };
  return { client, call, fake };
}
