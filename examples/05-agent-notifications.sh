#!/usr/bin/env bash
# Activate a PMP agent and start its detached notification supervisor.
#
# Usage:
#   ./05-agent-notifications.sh Aporta
#   PMP_WAKE_WEBHOOK=https://runner.example/hooks/pmp ./05-agent-notifications.sh Aporta
set -euo pipefail

agent="${1:?usage: $0 <agent-slug>}"

if [[ -n "${PMP_WAKE_WEBHOOK:-}" ]]; then
  cogx agent notify start --agent "$agent" --no-desktop --webhook "$PMP_WAKE_WEBHOOK"
  eval "$(cogx agent activate "$agent")"
else
  eval "$(cogx agent activate "$agent" --notify)"
fi

cogx agent notify status --agent "$agent"
