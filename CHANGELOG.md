# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-11-08

### Added

- Read tools: server info, libraries, search, filtered browsing, item details, authors, series, library facets, listening progress, listening stats (incl. year in review), listening sessions, collections, playlists.
- `abs_get_taste_profile`: engagement-weighted preferences, series status with gaps, unread books by favourite authors.
- `abs_check_owned`: batch fuzzy ownership check for recommendation candidates.
- Opt-in write tools (`ABS_ENABLE_WRITE_TOOLS`): mark finished, create/extend collections and playlists, scan library.
- Prompts: `recommend_audiobooks`, `continue_my_series`.
- stdio and Streamable HTTP transports (bearer auth, DNS-rebinding protection, health check).
- Library allowlist, default library, result caps, caching, timeouts and retries — all configurable via environment variables.
- Docker image and CI.
