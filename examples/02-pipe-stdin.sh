#!/usr/bin/env bash
# 02-pipe-stdin.sh — feed content into cogx via Unix pipes.
#
# Every command that takes text (recall, remember, talk, search, save-session,
# update) reads stdin when no positional arg is given, or appends stdin to args.

set -euo pipefail

# Pipe a file into a memory
cat README.md | cogx remember --type semantic --project cogx-cli

# Pipe `git log` summary
git log --oneline -10 | cogx remember --type episodic \
  --project myapp \
  "Recent commits"

# Ask iCog about piped content
cat ARCHITECTURE.md 2>/dev/null | cogx talk "Critique this architecture"

# Recall combined with stdin keyword
echo "auth" | cogx recall --json --limit 3
