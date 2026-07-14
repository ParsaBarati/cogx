# cogx

The CogX CLI — a command-line client for the Persistent Memory Protocol (PMP).

```bash
npm install -g @cognitivx/cli
cogx auth login
cogx talk "what did we decide about auth last week"
```

Pure Node.js, zero dependencies. Works the same on macOS, Linux, and Windows.

---

## Why

iCog is a persistent cross-session memory layer. The `cogx` CLI gives you (and your coding agents) direct access to it from the terminal — without leaving the shell, scriptable end-to-end.

This contract is the **Persistent Memory Protocol (PMP)**: durable agent identity,
memory, provenance, sharing, messaging, and orchestration across independent
sessions. PMP complements MCP: MCP connects a model to tools during a run; PMP
preserves identity and knowledge across runs.

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

## PMP multi-agent orchestration

Register each participant once. Agent type is a memory-policy class; put the
agent's job in its description and task.

```bash
cogx identify Aporta --type tool --description "Aira architecture agent"
cogx identify Abarcode --type tool --description "Barcode ERP agent"
cogx identify Automa --type tool --description "Automation agent"
```

Once more than one identity exists, CogX refuses ambiguous agent operations.
Select the identity per command (safe in any runner):

```bash
cogx recall "current architecture decisions" --agent Aporta
cogx remember "Barcode owns invoice authority" --agent Abarcode \
  --share-with Aporta,Automa
cogx talk "check this boundary" --agent Automa --task "mapping integrations" --scope strict
```

Or activate it only in the current shell—never globally across sessions:

```bash
eval "$(cogx agent activate Aporta)"
cogx agent status
```

Coordinate through addressed messages and durable handoffs:

```bash
cogx agent send Abarcode "Confirm invoice ownership" \
  --agent Aporta --context "Aira architecture boundary review"
cogx agent inbox --agent Abarcode
cogx agent handoff Automa "Implement the verified connector boundary" \
  --agent Abarcode --context "ERP contract is now confirmed"
```

Create a team or dispatch one shared thread with individual assignments:

```bash
cogx team create aira-ecosystem --members Aporta,Abarcode,Automa
cogx orchestrate "Map the end-to-end quote-to-cash flow" --agent Aporta \
  --agents Abarcode,Automa \
  --tasks '{"abarcode":"map ERP authority","automa":"map automations"}'
```

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

## Billing

Manage your subscription and credits from the terminal. Paid actions print a
Stripe-hosted URL — the CLI never handles card data.

```bash
cogx billing status                      # plan, subscription state, credit balance
cogx billing usage                       # this cycle's usage vs your tier's caps
cogx billing tiers                       # list plans with prices and allowances

cogx billing subscribe awakened          # → Stripe Checkout URL (monthly)
cogx billing subscribe conscious --interval annual
cogx billing portal                      # → Stripe portal: card, invoices, cancel

cogx billing switch-to-payg              # move to pay-as-you-go (metered)
cogx billing set-cap 50                  # cap PAYG spend at $50/month
cogx billing set-cap none                # remove the cap
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
| `cogx agent list` / `status` / `activate` | Manage session-safe identities |
| `cogx agent inbox` / `send` / `ack` / `thread` | Agent messaging |
| `cogx agent handoff` | Transfer a task with evidence |
| `cogx team list` / `create` / `set-members` / `delete` | Manage agent teams |
| `cogx orchestrate <goal>` | Dispatch a shared thread to agents or a team |
| `cogx search <query>` | Web search via iCog (Tavily) |

### Global flags

| Flag | Purpose |
|---|---|
| `--json`, `-j` | Emit JSON output |
| `--project <name>`, `-p` | Tag content with `[Project: <name>] ` |
| `--agent <slug>` | Attribute this operation to one agent |
| `--as-user` | Explicitly run without agent attribution |
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
| `COGX_AGENT_SLUG` | Current shell/session agent identity | — |
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

The CLI talks to `https://api.cognitivx.io` over HTTPS. Same API as the iCog web app and MCP — your memory, your data, the same on every device.

---

## License

MIT
