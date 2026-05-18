# cogx

The CogX CLI — recall, remember, and talk to your personal AI from any terminal.

```bash
npm install -g cogx
cogx auth login
cogx talk "what did we decide about auth last week"
```

Pure Node.js, zero dependencies. Works the same on macOS, Linux, and Windows.

---

## Why

iCog is a persistent cross-session memory layer. The `cogx` CLI gives you (and your coding agents) direct access to it from the terminal — without needing the MCP, without leaving the shell, scriptable end-to-end.

- **For humans:** quickly recall past decisions, jot down a thought, or ask iCog for perspective.
- **For agents:** call `cogx --json` from any tool that can run a shell command. Pipe content in, get JSON out, no SDK required.

---

## Install

Requires Node.js 18 or newer.

**From GitHub** (works today, no npm publish needed):

```bash
npm install -g github:Lexaplus/cogx
```

**From npm:**

```bash
npm install -g @cognitivx/cli
```

**One-off** without installing globally:

```bash
npx github:Lexaplus/cogx talk "what did we ship today"
```

Verify the install:

```bash
cogx --version
```

---

## Authenticate

Either sign in via the browser device flow:

```bash
cogx auth login          # opens browser, saves to ~/.icog/credentials.json
cogx auth status
cogx auth logout
```

Or set `ICOG_API_KEY` in your environment (useful for CI, scripts, remote machines):

```bash
export ICOG_API_KEY=icog_xxx...
```

The env var always wins over stored credentials.

---

## Memory

```bash
# Search across all your memories
cogx recall "what was the auth bug from last week"
cogx recall "ssh setup" --type procedural --limit 5

# Store something
cogx remember "Auth bug: double-encoded JWT in refresh path. Fixed in tryRefresh()."
cogx remember --type episodic "Spent 2h debugging the websocket reconnect"
cat NOTES.md | cogx remember --type episodic

# Replace or remove
cogx update <id> "Corrected version of the memory"
cogx forget <id>
```

Memory types: `semantic` (default — facts, decisions), `episodic` (events, sessions), `procedural` (how-tos), `foundational` (identity, values).

### Tag memories with a project

```bash
# Per-call:
cogx remember --project myapp "Switched to PostgreSQL 16"

# Or set a default for the shell session:
export ICOG_PROJECT=myapp
cogx recall "schema migrations"   # → searches "[Project: myapp] schema migrations"
```

---

## Talk

```bash
# One-shot
cogx talk "should I refactor the auth interceptor?"

# Pipe a question
echo "review this approach" | cogx talk

# Interactive REPL with persistent history
cogx chat
```

In `cogx chat`, slash commands work inline:

```
you ❯ /recall ssh keys
you ❯ /remember decided to use ed25519 everywhere
you ❯ /reflect
you ❯ /quit
```

History is saved to `~/.icog/history` and loaded across sessions (up-arrow recalls).

---

## Cognition

```bash
cogx reflect              # consciousness level + memory count + narrative
cogx introspect           # full cognitive mirror: mood (VAD), personality traits
cogx learn bug_fixed      # record a learning signal
cogx dream                # trigger memory consolidation
cogx dream-status         # check progress
cogx save-session "shipped the install page" --project cogx-cli
```

---

## Wire iCog into your coding agent

```bash
cogx mcp install claude       # ~/.claude/mcp.json
cogx mcp install cursor       # ~/.cursor/mcp.json
cogx mcp install windsurf     # ~/.codeium/windsurf/mcp_config.json

cogx mcp list                 # show what's installed
cogx mcp uninstall claude
```

Restart the agent after install. iCog is then available as MCP tools (`mcp__icog__recall`, `mcp__icog__remember`, etc.).

The CLI installs the **remote** MCP — points the agent at `https://i.cognitivx.io/mcp/`. No local process, no Python, no native modules.

---

## JSON mode (for agents)

Every command supports `--json` (or `-j`) for machine-readable output:

```bash
$ cogx recall "ssh keys" --json --limit 2
{"ok":true,"query":"ssh keys","count":2,"memories":[{"id":"...","text":"...","memory_type":"procedural","age_days":3}, ...]}

$ cogx remember "test" --json
{"ok":true,"memory_id":"019e0b...","memory_type":"semantic"}

$ cogx reflect --json
{"ok":true,"consciousness_level":"3","memory_count":847,"narrative":"..."}
```

Errors also come back as JSON:

```bash
$ cogx remember --json
{"ok":false,"error":"usage: cogx remember <text> ..."}
```

So an agent can call `cogx remember --json "$content"` and parse the result. No SDK glue, no MCP setup.

---

## Pipes & composition

Stdin is read on `recall`, `remember`, `talk`, `update`, `search`, `save-session`. Combine freely:

```bash
git log --oneline -20 | cogx remember --type episodic --project myapp \
  --type episodic "Last 20 commits"

curl -s https://example.com/spec.md | cogx remember --type semantic

cogx recall "deploy steps" --json | jq '.memories[0].text'
```

---

## Reference

### Commands

| Command | Purpose |
|---|---|
| `cogx auth login` / `status` / `logout` | Manage authentication |
| `cogx mcp install [agent]` | Install iCog MCP (`claude` / `cursor` / `windsurf`) |
| `cogx mcp list` / `uninstall <agent>` | Manage MCP installs |
| `cogx recall <query>` | Semantic search |
| `cogx remember <text>` | Store a memory |
| `cogx forget <id>` | Soft-delete a memory |
| `cogx update <id> <text>` | Replace a memory |
| `cogx talk <message>` | Talk to iCog with full memory context |
| `cogx chat` | Interactive REPL with persistent history |
| `cogx reflect` | Consciousness level + memory count |
| `cogx introspect` | Full cognitive mirror (mood, traits) |
| `cogx learn <outcome>` | Record a learning signal |
| `cogx dream` / `dream-status` | Trigger / monitor consolidation |
| `cogx save-session <summary>` | Episodic session summary |
| `cogx identify <name>` | Register agent identity |
| `cogx search <query>` | Web search via iCog (Tavily) |

### Global flags

| Flag | Purpose |
|---|---|
| `--json`, `-j` | Emit JSON output |
| `--project <name>`, `-p` | Tag content with `[Project: <name>] ` |
| `--type <t>`, `-t` | Memory type filter |
| `--limit <n>`, `-l` | Result count |
| `--help`, `-h` | Show help (or per-command: `cogx remember --help`) |
| `--version`, `-v` | Print version |

### Environment

| Variable | Purpose | Default |
|---|---|---|
| `ICOG_API_KEY` | Override stored credentials | — |
| `ICOG_API_URL` | Override API endpoint | `https://i.cognitivx.io` |
| `ICOG_PROJECT` | Default project tag | — |
| `ICOG_TIMEOUT_MS` | Request timeout | `60000` |
| `NO_COLOR` | Disable color output | — |

### Files

- `~/.icog/credentials.json` — API key (mode 0600)
- `~/.icog/history` — chat history

---

## Resilience

The CLI retries transient failures (502/503/504, network errors) with exponential backoff (1s → 3s → 8s, 4 attempts total). Auth flow does not retry. Custom timeout via `ICOG_TIMEOUT_MS`.

---

## Privacy

The CLI talks to `https://i.cognitivx.io` over HTTPS. Same API as the iCog web app and MCP — your memory, your data, the same on every device.

---

## License

MIT
