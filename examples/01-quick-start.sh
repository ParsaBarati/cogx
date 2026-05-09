#!/usr/bin/env bash
# 01-quick-start.sh — sign in, store a memory, recall it.
#
# Usage: ./01-quick-start.sh
# Requires: cogx installed (or `npm link` from a checkout)

set -euo pipefail

cogx auth login              # opens browser, saves to ~/.icog/credentials.json
cogx remember "Quick-start example: ran on $(date '+%Y-%m-%d %H:%M')"
cogx recall "quick-start example"
cogx reflect                 # consciousness level + memory count
