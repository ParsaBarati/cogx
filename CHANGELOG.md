# Changelog

All notable changes to `cogx` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [1.2.0] — 2026-05-30

### Added
- **`cogx billing`** — manage your subscription and credits from the terminal, over the `/api/billing/*` API. Subcommands:
  - `billing status` — plan, subscription state, renewal date, and credit balance (with low-balance / depleted warnings).
  - `billing usage` — this cycle's messages, memories saved, and recall credits vs your tier's monthly cap (per-mode breakdown).
  - `billing tiers` — list plans with prices and allowances (public, no auth).
  - `billing subscribe <tier> [--interval monthly|annual]` — start/upgrade a subscription; prints a Stripe Checkout URL (the CLI never handles card data).
  - `billing portal` — Stripe customer portal URL to update card, view invoices, or cancel.
  - `billing switch-to-payg [--refund credit|card]` — move to pay-as-you-go metered billing.
  - `billing set-cap <usd|none>` — set or clear the monthly PAYG spend cap ($1–$10,000).
- All subcommands support `--json` for machine-readable output.

### Fixed
- **`cogx mcp install claude` wrote to the wrong file.** It targeted `~/.claude/mcp.json`, which Claude Code does not read — so iCog never appeared after restart. Claude Code reads user-scope MCP servers from `~/.claude.json` (key `mcpServers`); the `claude` target now writes there. `mcp list` / `update` / `uninstall` follow the corrected path.
- **`mcp install` no longer risks clobbering a config it can't parse.** It now aborts rather than overwriting an existing-but-invalid file — important for `~/.claude.json`, which holds all of Claude Code's state. Other top-level keys are always preserved.

## [1.1.1] — 2026-05-20

### Fixed
- **Default API root** moved from `https://i.cognitivx.io` to `https://api.cognitivx.io`. The old host now 308-redirects to `icog.app`, which served the SSR shell and broke CLI auth + recall + every other endpoint. The canonical API root has been `api.cognitivx.io` since v13.4. Existing users can override via `ICOG_API_URL` env var if needed.

## [1.1.0] — 2026-05-18

### Added
- **Markdown rendering** for streamed responses (`talk`, `chat`, `reflect`, `introspect` narrative). Bold, italic, inline code, headings, blockquotes, lists, fenced code blocks, links, and `[Agent:slug→iCog]`/`[iCog→Agent]` exchange chips are all styled with ANSI escape codes in TTY contexts. Falls back to raw text for pipes, redirects, and `--json` mode. Zero new dependencies.
- **`cogx doctor`** — self-diagnostic: Node version, fetch availability, credentials, API reachability, auth validity, MCP install status, and latest-published-version check. Reports each with fix hints.
- **`cogx self-update`** — checks npm registry for a newer `@cognitivx/cli` and runs `npm install -g @cognitivx/cli@latest` in place. `--force` to reinstall current. Prints sudo/pnpm/yarn fallbacks on failure.
- **`cogx mcp install --all`** and **`cogx mcp uninstall --all`** — install/remove iCog across every detected agent in one call. Only writes to agents whose config dir already exists (no surprise dirs for tools that aren't installed).
- **`cogx mcp update [agent|all]`** — refresh the iCog entry in existing configs (key rotation, URL change). Skips configs that don't already have iCog.
- **Expanded MCP target list** — added `claude-desktop`, `cline` (VS Code extension), and `vscode` (native MCP) alongside the original `claude` / `cursor` / `windsurf`. Platform-aware paths for macOS, Windows, and Linux.

### Changed
- Rebranded "iCog CLI" to "CogX CLI" everywhere user-visible (banner, version output, README, npm description, install page). Command, package name, and iCog product references unchanged.
- `cogx mcp list` now also reports detected-but-unconfigured agents with a hint to run `--all`.

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
