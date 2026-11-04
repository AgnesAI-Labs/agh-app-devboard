#!/bin/sh
# DevBoard dev loop: mirror this repo into the AGH home plugins folder.
# The daemon watches ~/.agh/plugins/<name>/, snapshots changed bytes and reloads them for
# new sessions. Symlinks are refused there, so this copies. A changed package unbinds the
# adopted application (`agh app show` -> unresolved/package-changed), so each sync re-adopts.
#
#   sh devboard-dev-sync.sh          # sync once
#   sh devboard-dev-sync.sh --watch  # sync on every save (needs watchexec)
#
# Before testing a packed .tgz the customer way: stop this, rm -rf ~/.agh/plugins/devboard,
# then `agh plugins pack` / `agh plugins add` (same package name cannot have two sources).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${AGH_HOME:-$HOME/.agh}/plugins/devboard"
APP='@agnes-showcase/devboard#devboard'

if [ "${1:-}" = "--watch" ]; then
  exec watchexec -w "$SRC" -i 'test/**' -i 'scripts/**' -i '.git/**' --debounce 500ms -- sh "$0"
fi

changes=$(rsync -a --delete --delay-updates --exclude test/ --exclude scripts/ --exclude .git/ --exclude node_modules/ --itemize-changes "$SRC/" "$DEST/")
[ -z "$changes" ] && { echo "devboard: no change"; exit 0; }
echo "devboard: synced $(printf '%s\n' "$changes" | wc -l | tr -d ' ') item(s), waiting for reload"

# ponytail: polls CLI for 30s; a slower reload needs a manual `agh app adopt '$APP' --yes`.
i=0
while [ $i -lt 30 ]; do
  sleep 1; i=$((i + 1))
  # Capture whole outputs: agh crashes with EPIPE when a pipe reader (head, grep -q) exits early.
  status=$(agh plugins status 2>/dev/null || true)
  printf '%s\n' "$status" | grep 'devboard@' | grep -q 'actual=running' || continue
  app=$(agh app show 2>/dev/null || true)
  case "${app%%
*}" in
    active*) [ $i -ge 5 ] && { echo "devboard: reloaded, adoption intact"; exit 0; } ;;
    *) agh app adopt "$APP" --yes >/dev/null && { echo "devboard: reloaded and re-adopted"; exit 0; } ;;
  esac
done
echo "devboard: reload not confirmed in 30s; check 'agh plugins status' / 'agh app show'" >&2
exit 1
