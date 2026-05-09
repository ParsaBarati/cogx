# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports.

Email **support@cognitivx.io** with:

- A description of the issue
- Steps to reproduce (proof of concept welcome)
- The affected version (`cogx --version`)
- Your contact info if you'd like a credit / response

We aim to acknowledge within 72 hours and ship a fix or mitigation in the next patch release.

## What's in scope

- Issues in the published `cogx` npm package (this repo)
- Credential handling in the CLI (e.g. unsafe storage, leakage in logs)
- Path traversal, command injection, unsafe `exec` calls
- TLS / HTTPS handling

## What's out of scope

- Issues in the iCog backend at `https://i.cognitivx.io` — those go through the main CognitiveX security process. Email the same address.
- Theoretical issues with no proof of exploitability
- Self-XSS or local attacks requiring physical machine access
- Issues in third-party agents (`claude`, `cursor`, `windsurf`) themselves — report those upstream

## Credential safety

- The CLI stores API keys in `~/.icog/credentials.json` with mode `0600` (owner read/write only).
- `ICOG_API_KEY` env vars are read but never logged.
- `--api-key` flag values are not persisted.
- The CLI prints the device-flow verification URL to stderr; the key returned by the API is written only to `credentials.json`.
- HTTPS is the default. `ICOG_API_URL` can be overridden but should always be `https://`.
