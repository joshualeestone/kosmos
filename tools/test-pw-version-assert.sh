#!/usr/bin/env bash
# kosmos#1708: the browser gate must ASSERT the resolved Playwright is the
# PINNED version (tools/provision-pw.sh PW_VERSION), not merely that a playwright
# exists. A drifted pw-runtime otherwise changes the browser build silently --
# the #1594 skew one layer up. This is a FUNCTIONAL test: it drives the gate with
# a fake KOSMOS_PW_NODE_PATH carrying a chosen version and reads the warning the
# version-assert prints (which fires BEFORE the launch check, so the fake needs
# no real browser and no network).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
GATE="$REPO/tools/browser-checks.sh"
# Hermetic: the version-assert fires AFTER the concurrent-browser-run refusal
# (browser-checks.sh:86). If a real cut/board is live when this test runs (e.g.
# during a release), that refusal would exit the gate BEFORE the assert and all
# four cases would spuriously fail. Ignore the cut-guard here -- we drive a fake
# runtime and never launch a browser, so there is nothing to contend with.
export KOSMOS_HARNESS_IGNORE_CUT=1
# Read the pin from committed HEAD, mirroring how the gate reads it: on a branch
# the gate freezes to HEAD (browser-checks.sh #758) BEFORE reading
# tools/provision-pw.sh, so it compares against the COMMITTED pin. Reading the
# working tree here would diverge during a pin bump (provision-pw.sh edited but
# not yet committed) and spuriously fail case 2's control on a correct build.
# Same sed as browser-checks.sh (`\([^"]*\)`) so a pre-release pin (e.g.
# 1.63.0-alpha) is captured whole.
PIN="$(git -C "$REPO" show HEAD:tools/provision-pw.sh 2>/dev/null | sed -n 's/^PW_VERSION="\([^"]*\)".*/\1/p' | head -1)"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok   %s\n' "$*"; }
[ -n "$PIN" ] || fail "could not read the PW_VERSION pin"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fake_pw() { # <version> -> prints a node_modules dir whose playwright is that version
  d="$(mktemp -d "$TMP/nm.XXXXXX")"; mkdir -p "$d/playwright"
  printf '{"name":"playwright","version":"%s"}\n' "$1" > "$d/playwright/package.json"
  echo "$d"
}
# Run the gate against a fake runtime; the launch check fails on the fake (no
# real browser) so the exit is non-zero, but the version-assert prints FIRST.
run_gate() { KOSMOS_PW_NODE_PATH="$1" bash "$GATE" 2>&1 || true; }

# 1. DRIFT (non-strict): a version different from the pin must WARN loudly (and
#    name both) AND NOT BLOCK. Warn-by-default is the whole design, so it is not
#    enough to see the DRIFT line: assert the gate CONTINUED past the version
#    block into the launch phase ("engines the checks ask for:", the first line
#    after the version block) and did NOT print the STRICT refusal. Without
#    these two, a regression that made non-strict drift `exit 2` would still
#    pass -- the DRIFT line prints either way, and `|| true` swallows the exit.
D="$(fake_pw "1.63.0-not-the-pin")"
out="$(run_gate "$D")"
printf '%s' "$out" | grep -q 'version DRIFT' || { printf '%s\n' "$out" | head; fail "a drifted runtime did NOT warn"; }
printf '%s' "$out" | grep -qF "$PIN" || fail "the DRIFT warning does not name the pin ($PIN)"
printf '%s' "$out" | grep -q 'engines the checks ask for' || { printf '%s\n' "$out" | head -20; fail "non-strict drift BLOCKED before the launch phase (warn-by-default is broken)"; }
printf '%s' "$out" | grep -q 'refusing to run the page gate' && { printf '%s\n' "$out" | head -20; fail "non-strict drift printed the STRICT refusal (must only fire under KOSMOS_PW_STRICT_VERSION=1)"; }
pass "a drifted Playwright warns loudly, names the pin, and does NOT block (warn-by-default continues to the launch phase)"

# 2. CONTROL: the SAME setup on the MATCHING version must NOT warn -- proving the
#    warning above means drift, not just 'the check ran'.
M="$(fake_pw "$PIN")"
out="$(run_gate "$M")"
printf '%s' "$out" | grep -q 'version DRIFT' && { printf '%s\n' "$out" | head; fail "the pinned version wrongly warned DRIFT"; }
printf '%s' "$out" | grep -q 'matches the pin' || fail "the pinned version did not confirm 'matches the pin'"
pass "the pinned version does not warn (control: the check can tell them apart)"

# 3. STRICT: with KOSMOS_PW_STRICT_VERSION=1, a drift must HARD-STOP (exit 2),
#    not merely warn.
D2="$(fake_pw "9.9.9-strict-drift")"
rc=0; KOSMOS_PW_STRICT_VERSION=1 KOSMOS_PW_NODE_PATH="$D2" bash "$GATE" >"$TMP/out" 2>&1 || rc=$?
grep -q 'refusing to run the page gate on an unpinned build' "$TMP/out" || { cat "$TMP/out"; fail "STRICT drift did not print the refusal"; }
[ "$rc" -eq 2 ] || fail "STRICT drift exited $rc, expected 2"
pass "KOSMOS_PW_STRICT_VERSION=1 hard-stops on drift (exit 2)"

# 4. STRICT + an UNREADABLE version must ALSO hard-stop: resolve_pw accepts a
#    `playwright/` dir that lacks package.json, so the version cannot be read.
#    "cannot verify" is not "verified pinned" -- a fail-closed flag must not fail
#    open. (Control for this arm: case 3 above, where STRICT stops on a real
#    mismatch; here it must stop on an unreadable one too.)
N="$(mktemp -d "$TMP/nm.XXXXXX")"; mkdir -p "$N/playwright"   # dir present, no package.json
rc=0; KOSMOS_PW_STRICT_VERSION=1 KOSMOS_PW_NODE_PATH="$N" bash "$GATE" >"$TMP/out" 2>&1 || rc=$?
grep -q 'cannot verify the pin' "$TMP/out" || { cat "$TMP/out"; fail "STRICT with an unreadable version did NOT refuse (fail-open under a fail-closed flag)"; }
[ "$rc" -eq 2 ] || fail "STRICT unreadable-version exited $rc, expected 2"
pass "KOSMOS_PW_STRICT_VERSION=1 hard-stops when the version cannot be verified (exit 2)"

# 5. WIRING: the release cut (tools/release.sh) must invoke the gate with STRICT
#    ENABLED. The default is warn-only, so without this line the enforcement
#    arms above (cases 3 and 4) are dead code in the pipeline: a drifted runtime
#    would merely print one line in a 25-minute cut log and the release would
#    ship. Guard against a refactor silently dropping the flag.
grep -Eq 'KOSMOS_PW_STRICT_VERSION=1[[:space:]]+bash[[:space:]]+tools/browser-checks\.sh' "$REPO/tools/release.sh" \
  || fail "tools/release.sh does not invoke the page gate with KOSMOS_PW_STRICT_VERSION=1 (#1708 enforcement is dead in the cut)"
pass "the release cut invokes the page gate with the version pin ENFORCED (STRICT)"

printf '\nall pass\n'
