#!/bin/bash
# resolve_kosmos(), arm by arm. The function that decides WHETHER AN AGENT CAN
# REPORT AT ALL, and until this file it had NO TEST ANYWHERE.
#
# 🛑 WHY THIS FILE EXISTS. On 2026-08-28 the repo hook was copied to
# ~/.claude/hooks/user/ to deploy a fix. IT BROKE REPORTING FOR ALL 18 AGENTS ON
# THE BOX, silently, and every report returned success while doing nothing.
# Reverted within two minutes and disclosed (kosmos #1467).
#
# ⭐ THE MECHANISM, and it is why a copy is not a deploy: rung 3 says "source
# layout: the CLI is this script's sibling". That is TRUE WHERE THE FILE LIVES,
# in install/, and false the moment it is copied elsewhere. $HERE becomes the
# new directory, no sibling `kosmos` exists, the resolver returns EMPTY, and
# `report()` is  [ -n "$KOSMOS" ] && ... || true  which makes every report a
# SILENT NO-OP THAT RETURNS SUCCESS.
#
# ⚠️ AND THE EXISTING HOOK TEST CANNOT CATCH THIS, which is why the gap
# survived: tools/test-report-hook-source.sh sets KOSMOS_REPORT_CLI, so it takes
# rung 1 and never executes the resolution logic at all. A test that stubs the
# thing under test is not coverage of it.
#
# The arms below construct real directory layouts rather than mocking, because
# the bug IS a path relationship.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

HOOK="install/kosmos-report-hook.sh"
[ -r "$HOOK" ] || { echo "FAIL  $HOOK not found"; exit 1; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# Drive the real function, extracted from the real file, so this cannot drift
# from what ships. Angel's probe shape (#1467).
awk '/^resolve_kosmos\(\)/,/^}/' "$HOOK" > "$T/rk.sh"
grep -q 'resolve_kosmos' "$T/rk.sh" \
  || { echo "FAIL  could not extract resolve_kosmos from $HOOK"; exit 1; }

resolve() { # $1 = the HERE the hook would compute; env may add KOSMOS_REPORT_CLI
  HERE="$1" bash -c "set -u; HERE=\"\$HERE\"; . '$T/rk.sh'; resolve_kosmos" 2>/dev/null
}

# ⚠️ COMPARE THE FILE, NOT THE STRING. The resolver returns an UNNORMALISED path
# ("$HERE/../../bin/kosmos"), which is correct and is what the hook then
# executes. My first version of this test asserted string equality and went red
# against working code. The test was wrong, not the resolver.
same_file() { # $1 $2 -> 0 if both name the same existing file
  [ -e "$1" ] && [ -e "$2" ] || return 1
  local a b
  a="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
  b="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
  [ "$a" = "$b" ]
}

# --- layout A: INSTALLED bundle. app/bin -> home two up, CLI in bin/ ----------
mkdir -p "$T/A/app/bin" "$T/A/bin"
: > "$T/A/app/server.js"
printf '#!/bin/bash\n' > "$T/A/bin/kosmos"; chmod +x "$T/A/bin/kosmos"
got="$(resolve "$T/A/app/bin")"
if same_file "$got" "$T/A/bin/kosmos"; then
  ok "installed layout resolves to the bundle CLI"
else
  bad "installed layout returned '$got', which is not $T/A/bin/kosmos"
fi

# --- layout B: SOURCE checkout. the CLI is the script's sibling ---------------
mkdir -p "$T/B/install"
printf '#!/bin/bash\n' > "$T/B/install/kosmos"; chmod +x "$T/B/install/kosmos"
got="$(resolve "$T/B/install")"
if same_file "$got" "$T/B/install/kosmos"; then
  ok "source layout resolves to the sibling CLI"
else
  bad "source layout returned '$got', which is not $T/B/install/kosmos"
fi

# --- layout C: THE ONE THAT BROKE THE FLEET ----------------------------------
# The hook copied somewhere with neither relationship, which is what
# ~/.claude/hooks/user/ is. This currently returns EMPTY, and empty means every
# report is a silent no-op returning success.
mkdir -p "$T/C/hooks/user"
got="$(resolve "$T/C/hooks/user")"
if [ -z "$got" ]; then
  ok "deployed-elsewhere returns EMPTY (documents #1467: a copy is not a deploy)"
else
  bad "deployed-elsewhere returned '$got'. If this is a deliberate new rung, UPDATE THIS TEST and say why: it is the arm that broke 18 agents"
fi

# --- layout D: the env override, rung 1 --------------------------------------
got="$(KOSMOS_REPORT_CLI=/tmp/some-cli resolve "$T/C/hooks/user")"
[ "$got" = "/tmp/some-cli" ] \
  && ok "KOSMOS_REPORT_CLI overrides every layout" \
  || bad "env override returned '$got', expected /tmp/some-cli"

# --- CONTROL: the installed rung's GUARD is load-bearing ---------------------
# Same bundle shape, but server.js absent. Rung 2 is gated on it, so this must
# NOT resolve. Without this arm, layout A passing proves only that a path
# exists, not that the guard does anything.
mkdir -p "$T/E/app/bin" "$T/E/bin"
printf '#!/bin/bash\n' > "$T/E/bin/kosmos"; chmod +x "$T/E/bin/kosmos"
got="$(resolve "$T/E/app/bin")"
[ -z "$got" ] \
  && ok "CONTROL: without server.js the installed rung refuses, so its guard is real" \
  || bad "CONTROL FAILED: resolved '$got' with no server.js; rung 2's guard is not doing anything"

# --- CONTROL: the extractor returned a real function BODY, not nothing -------
# ⚠️ KEYED ON STRUCTURE, NOT ON A RUNG'S CONTENT. My first version grepped for
# KOSMOS_REPORT_CLI, which made this control fail whenever somebody legitimately
# changed that rung: perturbing the env rung turned it red for the WRONG reason,
# reporting an extraction failure that had not happened. A control that breaks
# when the subject is edited normally is a false alarm generator.
if grep -q '^resolve_kosmos()' "$T/rk.sh" && grep -q 'printf' "$T/rk.sh"; then
  ok "CONTROL: the extraction produced a real function body"
else
  bad "CONTROL FAILED: extraction produced no resolve_kosmos body; every arm above is meaningless"
fi

echo "report-hook-resolver: $FAILS failures"
[ "$FAILS" -eq 0 ]
