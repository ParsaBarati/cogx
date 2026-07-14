# Changelog

All notable changes to `cogx` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [1.4.0] — 2026-07-14

### Added
- `cogx agent notify start|stop|status|logs|test|clear` manages a detached, per-agent notification supervisor with private state and bounded NDJSON event logs under `~/.icog/notifications/`.
- `cogx agent notify test` verifies configured desktop and webhook delivery without creating or acknowledging a PMP message.
- Native desktop notifications on macOS and Linux, private by default; `--preview` explicitly opts into message-content previews.
- Optional `--webhook <url>` delivery sends full PMP message events to a host-runtime wake integration without forwarding CognitiveX credentials.
- `cogx agent activate <slug> --notify` selects the session identity and idempotently starts its supervisor while preserving eval-safe stdout.
- Restart-safe message deduplication, configurable polling, daemon health/status, replay, webhook disable, and forced restart controls.

### Security
- Notification directories and state/event files use owner-only permissions where supported.
- Webhook URLs are never printed in full, and desktop notifications hide message content unless `--preview` is selected.

## [1.3.1] — 2026-07-14

### Added
- `cogx agent wait` blocks until addressed unread work arrives, with configurable polling and timeout behavior for agent supervisors.
- `cogx agent watch` streams each newly observed unread message once; `--json` emits NDJSON suitable for a persistent watcher process.
- `cogx agent activate` now checks unread delivery state and prints a notice to stderr while preserving eval-safe shell output on stdout.

### Changed
- Watch and wait are receipt-preserving: notification never acknowledges a message. Agents still use `cogx agent ack` explicitly.

## [1.3.0] — 2026-07-14

### Added
- Named the durable identity, memory, provenance, and coordination contract the **Persistent Memory Protocol (PMP) 1.0**. CogX is its command-line client; PMP complements MCP's session-time tool access.
- Session-safe agent identity via `--agent`, `COGX_AGENT_SLUG`, and `cogx agent activate`; multiple registered agents now fail closed instead of silently sharing one global identity.
- Agent operations: `agent list`, `status`, `inbox`, `send`, `ack`, `thread`, and `handoff`.
- Team operations: `team list`, `create`, `set-members`, and `delete`.
- `cogx orchestrate` dispatches one shared goal/thread to multiple agents or a team, with optional per-agent task JSON.
- `remember --share-with a,b` writes with agent attribution and explicitly shares the resulting memory.
- `talk --task` and `--scope` expose iCog's current-task grounding and tiered/strict/lazy recall modes.

### Fixed
- `recall`, `remember`, `talk`, and `save-session` now send the selected `agent_slug`; v1.2.0 saved the slug but never used it.
- `identify` now defaults to the canonical v14 `tool` policy type. Legacy backend role labels remain server-compatible.

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
