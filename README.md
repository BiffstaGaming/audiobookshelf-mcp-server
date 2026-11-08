# Audiobookshelf MCP Server

[![CI](https://github.com/BiffstaGaming/audiobookshelf-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/BiffstaGaming/audiobookshelf-mcp-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/audiobookshelf-mcp-server)](https://www.npmjs.com/package/audiobookshelf-mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an AI assistant (Claude, or any MCP client) work with your self-hosted [Audiobookshelf](https://www.audiobookshelf.org) library. It can:

- **search and browse** your library by title, author, series, genre, narrator, tag and more
- **read your listening history**: what you've finished, what's in progress, what you've abandoned, and how long you listen
- **build a taste profile** in a single call, so the assistant can recommend books that suit you
- **check whether you already own a book**, fuzzy-matching titles from a list of candidates
- optionally **make changes**: mark books finished, build collections and playlists, trigger library scans

It is **read-only by default**. The write tools only appear when you opt in.

```text
You:     Based on what I've listened to, what should I get next?
Claude:  (calls abs_get_taste_profile, then abs_check_owned)
         You've finished both Stormlight books you own and Rhythm of War is waiting
         unread, but you're missing book 3, Oathbringer. You also own Mistborn and
         haven't started it. Here are five books you don't own yet that match what
         you tend to finish…
```

> Not affiliated with the Audiobookshelf project.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
  - [1. Create an Audiobookshelf API key](#1-create-an-audiobookshelf-api-key)
  - [2. Add the server to your MCP client](#2-add-the-server-to-your-mcp-client)
- [Other ways to run it](#other-ways-to-run-it)
- [Configuration](#configuration)
- [Tools](#tools)
- [Prompts](#prompts)
- [How the taste profile works](#how-the-taste-profile-works)
- [Recommend-then-download workflows](#recommend-then-download-workflows)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Requirements

- **Audiobookshelf v2.26.0 or newer.** That release added API keys. Developed and tested against the v2.37 API.
- **Node.js 20+**, or Docker.
- An MCP client: Claude Desktop, Claude Code, or any other client that supports stdio or Streamable HTTP servers.

## Quick start

### 1. Create an Audiobookshelf API key

1. Sign in to Audiobookshelf as an **admin**.
2. Go to **Settings → API Keys → Add API Key**.
3. Give it a name (e.g. `Claude`), choose the **user it acts as**, and optionally an expiry.
4. Copy the key. It is shown only once.

The key acts **as the user you choose**. Progress, history, stats and playlists are all that user's, and it only sees the libraries that user can access. To get recommendations from _your_ history, pick _your_ user. For least privilege, create a dedicated non-admin user with access to just the libraries you want to share, and leave write tools off.

> On an older server, or if you'd rather not use API keys, the legacy per-user token (**Settings → Users → your user → API token**) also works. Audiobookshelf has deprecated those tokens, though.

### 2. Add the server to your MCP client

#### Claude Desktop

Open **Settings → Developer → Edit Config** (or edit `claude_desktop_config.json` directly) and add:

```json
{
  "mcpServers": {
    "audiobookshelf": {
      "command": "npx",
      "args": ["-y", "audiobookshelf-mcp-server"],
      "env": {
        "ABS_URL": "http://192.168.1.10:13378",
        "ABS_API_KEY": "paste-your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. Then ask: _"Check my Audiobookshelf connection"_. The assistant should call `abs_get_server_info` and report your username and libraries.

Config file locations: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`.

#### Claude Code

```bash
claude mcp add audiobookshelf \
  -e ABS_URL=http://192.168.1.10:13378 \
  -e ABS_API_KEY=paste-your-key-here \
  -- npx -y audiobookshelf-mcp-server
```

#### Other clients

Any client that can launch a stdio server can use the same command (`npx -y audiobookshelf-mcp-server`) with the same environment variables. For clients that connect over HTTP, see [Docker / HTTP](#docker--http).

## Other ways to run it

### From source

```bash
git clone https://github.com/BiffstaGaming/audiobookshelf-mcp-server.git
cd audiobookshelf-mcp-server
npm ci && npm run build
```

Then point your client at `node /absolute/path/to/audiobookshelf-mcp-server/dist/index.js` instead of `npx`.

### Global install

```bash
npm install -g audiobookshelf-mcp-server
audiobookshelf-mcp-server --help
```

### Docker / HTTP

The container runs the **Streamable HTTP** transport on port 3000. This suits a home server, a NAS, or a machine that isn't running your MCP client.

```bash
docker run -d --name audiobookshelf-mcp -p 3000:3000 \
  -e ABS_URL=http://audiobookshelf:13378 \
  -e ABS_API_KEY=paste-your-key-here \
  -e MCP_HTTP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  ghcr.io/biffstagaming/audiobookshelf-mcp-server:latest
```

- MCP endpoint: `http://<host>:3000/mcp`. Clients must send `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>`.
- Health check: `GET /healthz` (no auth).
- Unless the server binds to localhost only, `MCP_HTTP_AUTH_TOKEN` is required and the server will refuse to start without it.
- For anything reachable from outside your network, put it behind a TLS-terminating reverse proxy and set `MCP_HTTP_ALLOWED_HOSTS` to your hostname(s) to enable DNS-rebinding protection.

There is a [`docker-compose.example.yml`](docker-compose.example.yml) and an [`.env.example`](.env.example) to start from. Without Docker, set `MCP_TRANSPORT=http` to get the same HTTP mode.

## Configuration

Everything is configured through environment variables. Invalid values stop the server at startup with a message naming the variable.

| Variable                    | Default                     | Description                                                                                                                                   |
| --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ABS_URL`                   | **required**                | Base URL of Audiobookshelf, e.g. `http://192.168.1.10:13378` or `https://example.com/audiobookshelf` (reverse-proxy sub-paths are supported). |
| `ABS_API_KEY`               | **required**¹               | API key (or legacy user token).                                                                                                               |
| `ABS_API_KEY_FILE`          |                             | Path to a file containing the key, e.g. a Docker secret. Used if `ABS_API_KEY` is unset.                                                      |
| `ABS_TOKEN`                 |                             | Alias for `ABS_API_KEY`.                                                                                                                      |
| `ABS_LIBRARY_IDS`           | _(all)_                     | Comma-separated library **IDs or names** this server may use. Everything else is invisible to the assistant.                                  |
| `ABS_DEFAULT_LIBRARY`       | _(first audiobook library)_ | Library ID or name used when a tool call doesn't specify one.                                                                                 |
| `ABS_ENABLE_WRITE_TOOLS`    | `false`                     | `true` registers the [write tools](#write-tools-opt-in).                                                                                      |
| `ABS_REQUEST_TIMEOUT_MS`    | `30000`                     | Per-request timeout to Audiobookshelf.                                                                                                        |
| `ABS_MAX_RESULTS`           | `50`                        | Upper limit on the number of results any single call can request. Keeps responses within the model's context.                                 |
| `ABS_DESCRIPTION_MAX_CHARS` | `300`                       | Book descriptions are truncated to this length; `0` omits them. (`abs_get_item` can return the full text.)                                    |
| `ABS_STALLED_AFTER_DAYS`    | `60`                        | A book you've started but not touched for this many days counts as _stalled_.                                                                 |
| `ABS_CACHE_TTL_SECONDS`     | `60`                        | How long libraries, progress and stats are cached in memory. `0` disables caching. Write tools clear the cache entries they affect.           |
| `LOG_LEVEL`                 | `info`                      | `error`, `warn`, `info` or `debug`. Logs go to **stderr** with secrets redacted.                                                              |
| `MCP_TRANSPORT`             | `stdio`                     | `stdio` or `http`.                                                                                                                            |
| `MCP_HTTP_HOST`             | `127.0.0.1`                 | Bind address for HTTP mode (the Docker image uses `0.0.0.0`).                                                                                 |
| `MCP_HTTP_PORT`             | `3000`                      | Port for HTTP mode.                                                                                                                           |
| `MCP_HTTP_PATH`             | `/mcp`                      | Endpoint path for HTTP mode.                                                                                                                  |
| `MCP_HTTP_AUTH_TOKEN`       |                             | Bearer token clients must send. Required when the host isn't loopback.                                                                        |
| `MCP_HTTP_ALLOWED_HOSTS`    |                             | Comma-separated `Host` header values to accept (turns on DNS-rebinding protection).                                                           |

¹ Either `ABS_API_KEY`, `ABS_TOKEN` or `ABS_API_KEY_FILE`.

Running from source, you can keep the settings in a `.env` file and use `node --env-file=.env dist/index.js`.

## Tools

All tools return compact JSON designed for a language model. Raw Audiobookshelf objects (file lists, paths, tracks) are trimmed down. Where a tool takes a `library`, `author` or `series` argument, you can pass a **name or an ID**, matched case-insensitively. Ambiguous names return the candidates so the assistant can pick one.

### Read tools (always on)

| Tool                                          | What it does                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abs_get_server_info`                         | Connection check: server version, the user the key acts as, allowed libraries, default library, whether write tools are on.                                    |
| `abs_list_libraries`                          | Allowed libraries with book/author/series counts.                                                                                                              |
| `abs_search_library`                          | Full-text search across titles, authors, series, narrators, genres and tags, with your progress on each hit.                                                   |
| `abs_list_library_items`                      | Browse with **one** filter (author, series, genre, tag, narrator, language, publisher, progress, recently added) plus sort and paging.                         |
| `abs_get_item`                                | Full details for one book: authors, narrators, series and position, genres, description, length, progress, and optionally chapters.                            |
| `abs_list_authors` / `abs_get_author`         | Authors by book count; one author's books grouped by series, with your status on each.                                                                         |
| `abs_list_series` / `abs_get_series`          | Series list; one series in reading order with the next unfinished book and any gaps in what you own.                                                           |
| `abs_get_library_facets`                      | The exact genres, tags, narrators, languages and publishers used in a library.                                                                                 |
| `abs_get_listening_progress`                  | Your finished / in-progress / stalled books, most recent activity first.                                                                                       |
| `abs_get_listening_stats`                     | Listening hours (today, 7/30/365 days, all time), by weekday, most-listened books, and recent sessions. Pass `year` for Audiobookshelf's year-in-review stats. |
| `abs_get_listening_sessions`                  | Individual sessions: book, date, minutes, device.                                                                                                              |
| `abs_get_taste_profile`                       | **The recommendation tool.** See [below](#how-the-taste-profile-works).                                                                                        |
| `abs_check_owned`                             | Pass up to 50 `{title, author}` candidates. For each, it reports whether you own it (`exact` / `likely` / `possible` match) and whether you've listened to it. |
| `abs_list_collections` / `abs_list_playlists` | Collections in a library; your playlists.                                                                                                                      |

### Write tools (opt-in)

These are registered only when `ABS_ENABLE_WRITE_TOOLS=true`. None of them delete anything. Each one is still subject to the Audiobookshelf permissions of the key's user.

| Tool                                              | What it does                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `abs_set_finished`                                | Mark books finished / not finished, e.g. books you listened to elsewhere.                       |
| `abs_create_collection` / `abs_add_to_collection` | Collections are shared with everyone who can see the library, and need the _update_ permission. |
| `abs_create_playlist` / `abs_add_to_playlist`     | Playlists are personal to the key's user.                                                       |
| `abs_scan_library`                                | Start a library scan, e.g. after a download lands. Admin only.                                  |

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`), so clients can auto-approve the read tools and still ask before writes.

## Prompts

The server ships two prompt templates. Clients that support MCP prompts show them as slash commands.

- **`recommend_audiobooks`** (`count`, `mood`): profile your taste, draft candidates, drop the ones you already own, and explain each pick. It won't download anything without asking.
- **`continue_my_series`**: for each series you've started, the next book you own and the next one you don't.

## How the taste profile works

`abs_get_taste_profile` gathers everything a recommendation needs in one call, so the assistant doesn't spend twenty tool calls (and its context) assembling it:

- **Rankings** of authors, series, genres, narrators, tags, languages, publication decades and book lengths. Each is scored by engagement: a finished book counts 1.0; an in-progress book 0.6 and a stalled one 0.15, each scaled by how far through you got (minimum 25%). Each entry also shows finished / in-progress / stalled counts and hours listened.
- **Totals**: books finished, in progress and stalled; listening hours (30 days, 365 days, all time); the median length of the books you finish.
- **Recently finished**, **currently listening** and **stalled** lists.
- **Series status** for your most-engaged series: books owned and finished, the next owned book you haven't finished, and whole-number gaps in what you own (own 1, 2, 4 → missing 3).
- **Unread books by your top authors** that are already in the library.

Audiobookshelf only knows about books that are in your library. It can't tell you that book 5 of a series exists. The assistant supplies that from its own knowledge, and `abs_check_owned` confirms what you already have.

## Recommend-then-download workflows

This server deliberately doesn't download anything; acquiring books depends on your own setup. MCP clients can connect several servers at once, though, so the assistant can combine this one with whatever you use to request books: a Home Assistant integration, an *arr-style app, or your own tool. A typical flow:

1. `abs_get_taste_profile` to understand your taste
2. the assistant drafts candidates
3. `abs_check_owned` drops the ones you already have
4. you pick, and the assistant sends the requests through your downloader's tools
5. optionally `abs_scan_library` (write tools on) once the files land, if your library doesn't watch for new files

## Security and privacy

- **Your data stays on your network.** The server talks only to your Audiobookshelf server, plus whatever MCP client you connect it to. There's no telemetry. Bear in mind that whatever the tools return is sent to the model behind your client.
- **Least privilege.** Read-only by default. `ABS_LIBRARY_IDS` hides libraries entirely: their items aren't returned or counted, even when Audiobookshelf would allow it. For tighter limits, give the key a non-admin user.
- **Secrets.** The key is sent only in the `Authorization` header to `ABS_URL` and is redacted from logs. Prefer `ABS_API_KEY_FILE` (Docker secrets) over plain environment variables on shared hosts. Give API keys an expiry and rotate them.
- **HTTP mode** requires a bearer token whenever it isn't bound to localhost (checked in constant time). Always put TLS in front of anything you expose.

Found a vulnerability? Please report it privately; see [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom                                   | Fix                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rejected the API key (401)`              | The key is wrong, expired or deactivated, or the user is disabled. Create a new key.                                                                               |
| `not allowed to do this (403)`            | The key's user lacks the permission (e.g. scans need admin, collections need _update_).                                                                            |
| `Could not reach Audiobookshelf`          | Check that `ABS_URL` is reachable from where the server runs. In Docker, `localhost` means the container itself, so use the host's IP or the compose service name. |
| HTTPS with a self-signed certificate      | Start Node with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`. Don't disable TLS verification.                                                                             |
| `Library "X" not found or not allowed`    | The error lists the libraries available. Check `ABS_LIBRARY_IDS` / `ABS_DEFAULT_LIBRARY`.                                                                          |
| Progress looks stale                      | Results are cached for `ABS_CACHE_TTL_SECONDS` (default 60 s).                                                                                                     |
| Claude Desktop shows the server as failed | Check its MCP log (`mcp-server-audiobookshelf.log`). Configuration errors are printed there on startup. Set `LOG_LEVEL=debug` for request-level detail.            |

Podcast libraries can be searched and browsed, but the history and recommendation tools only cover books.

## Development

```bash
npm ci
npm run dev          # run from source (tsx)
npm test             # vitest: unit tests + full MCP round-trips against a fake Audiobookshelf
npm run check        # typecheck + lint + format check + tests
npm run build        # compile to dist/
```

The tests run every tool through a real MCP client, over both the in-memory and Streamable HTTP transports, against a fake Audiobookshelf ([`test/fake-abs.ts`](test/fake-abs.ts)). The fake's responses are modelled on the Audiobookshelf server source. API shapes and endpoint notes live in [`src/abs/`](src/abs).

Releasing: bump `version` in `package.json`, update `CHANGELOG.md`, then push a `vX.Y.Z` tag. The release workflow publishes to npm (needs the `NPM_TOKEN` repository secret) and pushes a multi-arch image to GHCR.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
