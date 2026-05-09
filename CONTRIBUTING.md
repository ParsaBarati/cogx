# Contributing to cogx

Thanks for your interest. cogx is intentionally small and dependency-free — every contribution should respect that.

## Ground rules

- **Zero runtime dependencies.** The whole point of the CLI is `npm install -g cogx` and it just works on Node 18+. Don't add packages.
- **Pure Node.js.** No native modules, no platform-specific binaries, no build step. The published artifact is `index.js` exactly as you see it.
- **One source file.** Until the file passes ~1500 lines, keep everything in `index.js`. Splitting too early creates ceremony without payoff.
- **Tests stay self-contained.** `test.js` uses only Node's built-in `child_process` — no test framework. New tests follow the same pattern.

## Local setup

```bash
git clone https://github.com/Lexaplus/cogx.git
cd cogx
node test.js                    # 46 tests, all pure subprocess assertions
node index.js --help            # try it without installing
npm link                        # install `cogx` globally from this checkout
cogx --version                  # 1.0.0
```

`npm unlink` to undo.

## Running against a dev backend

```bash
ICOG_API_URL=http://localhost:8000 ICOG_API_KEY=icog_dev_xxx cogx reflect
```

## Submitting a change

1. Fork, branch, edit.
2. Run `node test.js` — must pass.
3. If you added a command or flag, add a test for it.
4. If you added a user-visible feature, update `README.md` and `CHANGELOG.md`.
5. Open a PR with a one-line `feat:`, `fix:`, `docs:`, or `chore:` prefix in the title.

## What's in scope

- New iCog API surfaces exposed as commands or flags.
- Better stdin handling, better JSON shapes, better error messages.
- Cross-platform fixes (Windows path quirks, terminal capability detection).
- New MCP target agents (`cogx mcp install <new-agent>`).

## What's not in scope

- Wrapper SDKs, programmatic Node modules, child packages — `cogx` is a CLI.
- Telemetry, analytics, auto-update.
- Bundlers, transpilers, TypeScript. The source is the published artifact.

## Reporting bugs

Open an issue with: command you ran (with `--json` so output is parseable), Node version (`node -v`), OS, and what you expected vs. what happened. Don't include API keys.

## Security

See [SECURITY.md](./SECURITY.md).

## Code of conduct

Be kind. Critique code, not people. If something feels off, say so directly.
