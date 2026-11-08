import type { AbsClient } from './abs/client.js';
import type { AbsLibrary, AbsMediaProgress } from './abs/types.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** Shared state handed to every tool. */
export class ServerContext {
  constructor(
    readonly config: Config,
    readonly client: AbsClient,
    readonly logger: Logger,
  ) {}

  /** Libraries the API key can see, narrowed by ABS_LIBRARY_IDS. */
  async allowedLibraries(): Promise<AbsLibrary[]> {
    const all = await this.client.libraries();
    const allow = this.config.libraryAllowlist.map((s) => s.toLowerCase());
    if (!allow.length) return all;
    return all.filter((l) => allow.includes(l.id.toLowerCase()) || allow.includes(l.name.toLowerCase()));
  }

  /**
   * Resolve a library argument (ID or name, case-insensitive). Falls back to
   * ABS_DEFAULT_LIBRARY, then to the first audiobook library.
   */
  async resolveLibrary(arg?: string, opts: { mediaType?: 'book' | 'podcast' } = {}): Promise<AbsLibrary> {
    const libs = await this.allowedLibraries();
    if (!libs.length) {
      throw new UserFacingError(
        'No libraries are available. Check that the API key’s user has library access and that ABS_LIBRARY_IDS matches real library IDs or names.',
      );
    }
    const wanted = arg ?? this.config.defaultLibrary;
    if (wanted) {
      const w = wanted.toLowerCase();
      const found =
        libs.find((l) => l.id.toLowerCase() === w) ?? libs.find((l) => l.name.toLowerCase() === w);
      if (!found) {
        throw new UserFacingError(
          `Library "${wanted}" not found or not allowed. Available: ${libs.map((l) => `${l.name} (${l.id})`).join(', ')}`,
        );
      }
      return found;
    }
    const preferred = opts.mediaType ?? 'book';
    return libs.find((l) => l.mediaType === preferred) ?? libs[0]!;
  }

  async allowedLibraryIds(): Promise<Set<string>> {
    return new Set((await this.allowedLibraries()).map((l) => l.id));
  }

  /** Book (non-episode) progress keyed by library item id. */
  async progressByItem(): Promise<Map<string, AbsMediaProgress>> {
    const all = await this.client.mediaProgress();
    const map = new Map<string, AbsMediaProgress>();
    for (const p of all) {
      if (p.episodeId || !p.libraryItemId) continue;
      map.set(p.libraryItemId, p);
    }
    return map;
  }

  clampLimit(limit: number | undefined, fallback = 25): number {
    return Math.max(1, Math.min(limit ?? fallback, this.config.maxResults));
  }
}
