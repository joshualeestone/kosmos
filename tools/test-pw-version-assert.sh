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
PIN="$(sed -n 's/^PW_VERSION="\([0-9][0-9.]*\)".*/\1/p' "$REPO/tools/provision-pw.sh" | head -1)"
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

# 1. DRIFT: a version different from the pin must WARN loudly (and name both).
D="$(fake_pw "1.63.0-not-the-pin")"
out="$(run_gate "$D")"
printf '%s' "$out" | grep -q 'version DRIFT' || { printf '%s\n' "$out" | head; fail "a drifted runtime did NOT warn"; }
printf '%s' "$out" | grep -qF "$PIN" || fail "the DRIFT warning does not name the pin ($PIN)"
pass "a drifted Playwright warns loudly and names the pin"

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

printf '\nall pass\n'
