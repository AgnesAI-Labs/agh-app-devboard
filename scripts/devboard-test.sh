#!/bin/sh
# Run the DevBoard vitest suite with the open-source checkout's vitest.
#   sh devboard-test.sh            # unit tests
#   sh devboard-test.sh --all      # also *.e2e.test.ts
#   AGNES_HARNESS=/path sh devboard-test.sh test/domain.test.ts
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="${AGNES_HARNESS:-$HOME/agnes-harness}"
VITEST="$HARNESS/node_modules/.bin/vitest"
[ -x "$VITEST" ] || { echo "vitest not found at $VITEST; run pnpm install in $HARNESS or set AGNES_HARNESS" >&2; exit 1; }
if [ "${1:-}" = "--all" ]; then
  shift
  DEVBOARD_E2E=1 exec "$VITEST" run --root "$ROOT" "$@"
fi
exec "$VITEST" run --root "$ROOT" "$@"
