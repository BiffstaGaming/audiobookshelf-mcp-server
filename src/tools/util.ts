import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AbsApiError } from '../abs/client.js';
import type { AbsFilterData } from '../abs/types.js';
import { UserFacingError, type ServerContext } from '../context.js';

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Wrap a tool handler so expected failures (bad input, ABS errors) come back
 * as tool errors the model can read and recover from, instead of protocol errors.
 */
export function safe<A>(ctx: ServerContext, name: string, fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return jsonResult(await fn(args));
    } catch (err) {
      if (err instanceof UserFacingError || err instanceof AbsApiError) {
        ctx.logger.warn(`${name} failed`, err);
        return errorResult(err.message);
      }
      ctx.logger.error(`${name} crashed`, err);
      return errorResult(`Unexpected error in ${name}: ${(err as Error).message}`);
    }
  };
}

/** Resolve a name or ID against a library's facet list (authors/series). */
export function resolveNamed(
  list: { id: string; name: string }[],
  wanted: string,
  kind: string,
): { id: string; name: string } {
  const w = wanted.trim().toLowerCase();
  const byId = list.find((x) => x.id.toLowerCase() === w);
  if (byId) return byId;
  const exact = list.filter((x) => x.name.toLowerCase() === w);
  if (exact.length === 1) return exact[0]!;
  const partial = list.filter((x) => x.name.toLowerCase().includes(w));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1 || exact.length > 1) {
    const options = (exact.length ? exact : partial).slice(0, 10).map((x) => `${x.name} (${x.id})`);
    throw new UserFacingError(`"${wanted}" matches several ${kind}: ${options.join('; ')}. Pass one ID.`);
  }
  throw new UserFacingError(`No ${kind} named "${wanted}" in this library.`);
}

/** Resolve a free-text facet value (genre, tag, …) to the exact stored spelling. */
export function resolveValue(values: string[], wanted: string, kind: string): string {
  const w = wanted.trim().toLowerCase();
  const exact = values.find((v) => v.toLowerCase() === w);
  if (exact) return exact;
  const partial = values.filter((v) => v.toLowerCase().includes(w));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new UserFacingError(
      `"${wanted}" matches several ${kind}: ${partial.slice(0, 15).join('; ')}. Use the exact value.`,
    );
  }
  throw new UserFacingError(`No ${kind} "${wanted}" in this library.`);
}

export type FacetKey = keyof Pick<
  AbsFilterData,
  'genres' | 'tags' | 'narrators' | 'languages' | 'publishers'
>;
