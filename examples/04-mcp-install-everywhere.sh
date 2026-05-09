#!/usr/bin/env bash
# 04-mcp-install-everywhere.sh — install iCog MCP into every supported agent.
#
# Idempotent: running it twice is a no-op (the configs already point at the
# remote MCP). Restart each agent after running.

set -euo pipefail

cogx mcp install claude     # ~/.claude/mcp.json
cogx mcp install cursor     # ~/.cursor/mcp.json
cogx mcp install windsurf   # ~/.codeium/windsurf/mcp_config.json

echo
echo "Installed:"
cogx mcp list
echo
echo "Restart each agent to pick up the new MCP."
