# Examples

Runnable scripts that demonstrate common cogx patterns.

| File | What it shows |
|---|---|
| `01-quick-start.sh` | First run: sign in, store a memory, recall it |
| `02-pipe-stdin.sh` | Feed file/command output into `remember`, `recall`, `talk` |
| `03-agent-json.js` | Call `cogx --json` from a Node script (pattern for agents) |
| `04-mcp-install-everywhere.sh` | Install iCog MCP into Claude Code, Cursor, and Windsurf |

Each script is self-contained. Run them after `npm install -g cogx` and `cogx auth login` (or set `ICOG_API_KEY` in your env).
