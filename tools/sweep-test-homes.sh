#!/bin/bash
# kosmos#5418: remove the throwaway test homes whose process is gone.
#
# engine/store.js gives a test process with no sandbox its own throwaway store home,
# named kosmos-test-home-<pid>-XXXXXX in the temp folder, and removes it when that
# process exits. A process that was killed leaves it behind. This removes only the
# ones whose <pid> this user cannot signal (the process is gone, or it is another
# user's, whose folder rm cannot remove anyway), so another agent's live run on this
# Mac keeps its throwaway however old it is. A name with no numeric pid is left alone.
#
#   bash tools/sweep-test-homes.sh            # sweeps ${TMPDIR:-/tmp}
# The prefix must equal engine/store.js TEST_HOME_PREFIX (tools/sweep-test-homes.test.js pins it).
PREFIX=kosmos-test-home-
for d in "${TMPDIR:-/tmp}"/"$PREFIX"*; do
  [ -d "$d" ] || continue
  pid="${d##*/$PREFIX}"; pid="${pid%%-*}"
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$pid" 2>/dev/null || rm -rf "$d" 2>/dev/null || true
done
exit 0
