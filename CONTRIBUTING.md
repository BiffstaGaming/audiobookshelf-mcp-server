# Contributing

Thanks for helping! Bug reports, docs fixes and new tools are all welcome.

## Setup

```bash
npm ci
npm run check   # typecheck, lint, format check, tests
```

## Guidelines

- **Keep tools model-friendly.** Return compact JSON with only what an assistant needs; trim large Audiobookshelf objects (see `src/format.ts`). Cap result sizes with `ctx.clampLimit`.
- **Read-only by default.** Anything that changes server state goes in `src/tools/write.ts` (registered only with `ABS_ENABLE_WRITE_TOOLS=true`) and must never delete data without a very good reason and an explicit design discussion.
- **Respect the library allowlist.** Any tool that returns items must filter by `ctx.allowedLibraryIds()` / resolve libraries via `ctx.resolveLibrary()`.
- **Verify API behaviour against the Audiobookshelf source** (`server/controllers`, `server/utils/queries`); the public API docs lag behind. Mention the ABS version you checked in your PR.
- **Test through MCP.** Add cases to `test/tools.test.ts` and extend `test/fake-abs.ts` with realistic payloads.
- Run `npm run format` before committing.
