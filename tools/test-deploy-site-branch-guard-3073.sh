#!/usr/bin/env bash
# test-deploy-site-branch-guard-3073.sh -- #3073: deploy-site.sh must refuse a publishing run
# (--publish/--promote) when the SITE checkout is NOT on its default branch, because a feature-branch
# deploy ships that branch's full index.html and silently clobbers the live site's state (the
# 2026-09-14 investor-facing regression: created-count-3038 re-published an index.html without the
# Windows-button fix while Josh had investors on the page). --force is the deliberate escape hatch;
# a DRY RUN (no --publish) deploys nothing and must be unaffected.
#
# TWO parts, both matter:
#   PART A (source pins) -- properties the runtime arm cannot prove:
#     A1: --force is parsed into a FORCE flag.
#     A2: the guard is gated on PUBLISH=1 AND FORCE!=1 (a dry run and a --force run both skip it).
#     A3: the default branch is READ from the site's own origin/HEAD (not hardcoded 'main'), so a
#         repo whose default is not main still works.
#   PART B (runtime, end-to-end) -- the card's literal claim, against a fake $SITE git checkout:
#     B1: on a feature branch, --publish REFUSES (rc!=0) with the #3073 message, BEFORE any deploy.
#     B2 CONTROL: on the default branch, --publish does NOT hit the guard (proving B1 is not vacuous
#        -- the refusal is branch-specific, not unconditional). It may fail later (no .vercel etc.);
#        the assertion is only that the #3073 guard message is absent.
#     B3: on a feature branch WITH --force, the guard does NOT fire (the escape hatch works).
#     B4: on a feature branch with NO --publish (dry run), the guard does NOT fire.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
DEPLOY="$HERE/deploy-site.sh"
[ -f "$DEPLOY" ] || { echo "FAIL: deploy-site.sh not found at $DEPLOY"; exit 1; }

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# =============================================================================================
# PART A -- source-level pins
# =============================================================================================

# A1) --force is parsed into FORCE.
if grep -qE -- '--force\)[[:space:]]*FORCE=1' "$DEPLOY"; then
  pass "A1: --force is parsed into a FORCE flag"
else
  bad "A1: no '--force) FORCE=1' parse in deploy-site.sh -- the escape hatch is missing"
fi

# A2) the guard is gated on PUBLISH=1 AND FORCE!=1.
if grep -qE '\[ "\$PUBLISH" = 1 \] && \[ "\$FORCE" != 1 \]' "$DEPLOY"; then
  pass "A2: the guard is gated on PUBLISH=1 AND FORCE!=1 (a dry run and a --force run skip it)"
else
  bad "A2: the #3073 guard is not gated on PUBLISH=1 && FORCE!=1 -- it could fire on a dry run or ignore --force"
fi

# A3) the default branch is read from the site's own origin/HEAD, not hardcoded.
if grep -qE "symbolic-ref --quiet --short refs/remotes/origin/HEAD" "$DEPLOY"; then
  pass "A3: the default branch is derived from the site's origin/HEAD, not a hardcoded 'main'"
else
  bad "A3: the guard hardcodes the default branch instead of reading the site's origin/HEAD"
fi

# =============================================================================================
# PART B -- runtime, against a fake $SITE checkout
# =============================================================================================
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=main -c advice.detachedHead=false"

make_site() {  # <branch-to-end-on>  -> echoes the site dir
  s=$(mktemp -d "${TMPDIR:-/tmp}/ds-guard-site.XXXXXX")
  $GIT -C "$s" init -q
  # commit so HEAD exists (the precondition above the guard), and a .vercel so a main run gets PAST
  # the guard to a LATER precondition rather than tripping on a missing project.
  mkdir -p "$s/.vercel"; printf '{}' > "$s/.vercel/project.json"
  printf 'x' > "$s/index.html"
  $GIT -C "$s" add -A >/dev/null 2>&1
  $GIT -C "$s" commit -qm init >/dev/null 2>&1
  # ensure we are ON main (git may have defaulted elsewhere on old gits)
  $GIT -C "$s" branch -M main >/dev/null 2>&1
  if [ "$1" != "main" ]; then $GIT -C "$s" checkout -q -b "$1" >/dev/null 2>&1; fi
  printf '%s' "$s"
}

run_deploy() {  # <site-dir> <args...> -> sets OUT and RC
  OUT=$(KOSMOS_SITE="$1" KOSMOS_REPO="$REPO" bash "$DEPLOY" "${@:2}" 2>&1); RC=$?
}

# B1) feature branch + --publish -> REFUSE with the #3073 message.
S=$(make_site feature-x)
run_deploy "$S" --publish
if [ "$RC" -ne 0 ] && has "$OUT" "refusing to publish from 'feature-x'" && has "$OUT" "#3073"; then
  pass "B1: --publish from a feature branch refuses (rc=$RC) with the #3073 clobber message"
else
  bad "B1: --publish from a feature branch should refuse with the #3073 message; rc=$RC out=<<<$OUT>>>"
fi
rm -rf "$S"

# B2 CONTROL) default branch + --publish -> the guard does NOT fire (proves B1 is branch-specific).
S=$(make_site main)
run_deploy "$S" --publish
if has "$OUT" "refusing to publish from"; then
  bad "B2 CONTROL: --publish from main tripped the #3073 branch guard -- the refusal is unconditional, so B1 is vacuous. out=<<<$OUT>>>"
else
  pass "B2 CONTROL: --publish from main does NOT hit the #3073 guard (it fails later, if at all: rc=$RC) -- B1 is branch-specific"
fi
rm -rf "$S"

# B3) feature branch + --publish --force -> guard does NOT fire.
S=$(make_site feature-x)
run_deploy "$S" --publish --force
if has "$OUT" "refusing to publish from"; then
  bad "B3: --force did not override the #3073 guard on a feature branch. out=<<<$OUT>>>"
else
  pass "B3: --force overrides the #3073 guard on a feature branch (it proceeds past it: rc=$RC)"
fi
rm -rf "$S"

# B4) feature branch + NO --publish (dry run) -> guard does NOT fire.
S=$(make_site feature-x)
run_deploy "$S"
if has "$OUT" "refusing to publish from"; then
  bad "B4: a DRY RUN (no --publish) from a feature branch tripped the #3073 guard -- a dry run deploys nothing and must be allowed. out=<<<$OUT>>>"
else
  pass "B4: a dry run from a feature branch does NOT hit the #3073 guard (it deploys nothing)"
fi
rm -rf "$S"

# =============================================================================================
if [ "$fails" -eq 0 ]; then
  echo "test-deploy-site-branch-guard-3073: all checks passed"
  exit 0
fi
echo "test-deploy-site-branch-guard-3073: $fails failure(s)"
exit 1
