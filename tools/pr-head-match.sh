#!/bin/bash
# Refuse to let a PR be merged on a head that is not what you tested.
#
# 🛑 WHY THIS EXISTS, AND IT IS A MEASURED FAILURE RATHER THAN A PRECAUTION.
# Twice on 2026-08-28 a branch was rebased locally and not pushed, so the PR
# pointed at the pre-rebase commit. Once it would have SILENTLY REVERTED a fix
# that had merged an hour earlier (#1411 vs #1405), under a GitHub state of
# MERGEABLE / CLEAN, because the two changes touched the same file in different
# regions and there was no conflict to warn anybody.
#
# ⭐ AND THE SECOND TIME THE CHECK WAS ALREADY BEING RUN. It printed MISMATCH
# and the merge went ahead anyway, because the check and the merge were in one
# command: `echo head match...; gh pr merge`. A guard that cannot GATE the
# action is decoration. So this exits non-zero, and is meant to be used as:
#
#     tools/pr-head-match.sh 1433 && gh pr merge 1433 --squash --delete-branch
#
# The `&&` is the whole point: without it this is another printed reassurance.
#
# ⚠️ AND IT RE-QUERIES, because a false MISMATCH is its own hazard: immediately
# after a push `gh` can still return the OLD head, and a spurious refusal makes
# you distrust a commit you correctly tested. One mismatch is not evidence; a
# mismatch that survives a re-query is.
set -u

PR="${1:-}"
REPO="${PR_HEAD_MATCH_REPO:-joshualeestone/kosmos}"
if [ -z "$PR" ]; then
  echo "usage: pr-head-match.sh <pr-number> [local-ref]" >&2
  echo "  exits 0 only when the PR's head sha equals the local ref's sha" >&2
  exit 2
fi
REF="${2:-HEAD}"

LOCAL="$(git rev-parse "$REF" 2>/dev/null || true)"
if [ -z "$LOCAL" ]; then
  echo "pr-head-match: cannot resolve local ref '$REF' from $(pwd)" >&2
  echo "  (the agent Bash tool resets cwd, so run this inside the worktree or pass a ref)" >&2
  exit 2
fi

for attempt in 1 2 3; do
  REMOTE="$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid 2>/dev/null || true)"
  if [ -z "$REMOTE" ]; then
    echo "pr-head-match: could not read PR #$PR from $REPO" >&2
    exit 2
  fi
  if [ "$REMOTE" = "$LOCAL" ]; then
    echo "pr-head-match: MATCH  #$PR $(printf '%.8s' "$REMOTE")"
    exit 0
  fi
  [ "$attempt" -lt 3 ] && sleep 4
done

# 🛑 The failure text names the recovery, because the natural reaction to a
# refusal is to reach past it.
cat >&2 <<MSG
pr-head-match: MISMATCH on #$PR  -- NOT SAFE TO MERGE
  PR head : $REMOTE
  local   : $LOCAL   ($REF)
  Survived 3 queries, so this is not the post-push race.

  The usual cause is a local rebase that was never pushed. The PR would merge
  the PRE-rebase diff, which can silently revert work that landed on main since
  that branch's base -- with no conflict, under a MERGEABLE / CLEAN state.

  Fix: push the branch (--force-with-lease after a rebase), then re-run this.
MSG
exit 1
