# Changelog

All notable changes to `cogx` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [1.0.0] — 2026-05-09

Initial public release.

### Commands
- **Memory**: `recall`, `remember`, `forget`, `update`, `talk`, `chat` (interactive REPL)
- **Cognition**: `reflect`, `introspect`, `learn`, `dream`, `dream-status`, `save-session`
- **Setup**: `auth login` / `status` / `logout` / `set`, `mcp install` / `list` / `uninstall`
- **Utilities**: `identify`, `search`

### Auth
- Browser device flow (`auth login`)
- Direct API key (`auth set <key>`, validated against API before saving)
- `ICOG_API_KEY` env var
- `--api-key <key>` per-call override

### Output
- Human-readable colored output by default
- `--json` / `-j` for machine-readable output on every command
- `NO_COLOR=1` to disable color
- Errors emit `{"ok":false,"error":"..."}` in JSON mode

### Resilience
- 4-attempt retry with exponential backoff (1s/3s/8s) on 502/503/504 and network errors
- Configurable timeout via `ICOG_TIMEOUT_MS` (default 60s), `AbortController`-based

### Other
- Persistent readline history at `~/.icog/history` for `chat`
- Stdin piping on `recall`, `remember`, `talk`, `update`, `search`, `save-session`
- Project tagging via `--project <name>` or `ICOG_PROJECT` env

### Compatibility
- Node.js 18+
- macOS, Linux, Windows
- Zero runtime dependencies
