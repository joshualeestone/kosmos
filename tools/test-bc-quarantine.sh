#!/usr/bin/env bash
# A quarantined browser check is QUARANTINED, not PASS, and fails the run unless
# overridden (#4160). Browser-free: drives tools/lib/bc-quarantine.sh directly.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$REPO/tools/lib/bc-quarantine.sh"
fails=0
passes=0
ok()  { printf 'PASS: %s\n' "$1"; passes=$((passes+1)); }
bad() { printf 'FAIL: %s\n' "$1"; fails=$((fails+1)); }
LOGGED=""
log() { LOGGED+="$*"$'\n'; }
reset() { QUARANTINED=(); FAILED=(); REASONS=(); LOGGED=""; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf 'PASS  regress-a-night QUARANTINED for this cut (stale click)\n' > "$TMP/q.out"
printf 'PASS  all 55 assertions\n' > "$TMP/pass.out"
printf 'playwright is not on NODE_PATH - SKIPPED, not passed\n' > "$TMP/skip.out"
printf 'PASS  quarantined in lower case is not the token\n' > "$TMP/lower.out"
printf 'PASS  the quarantinedness of nothing\n' > "$TMP/partial.out"
printf 'PASS  a quarantined post is hidden from the feed\n' > "$TMP/modpass.out"
printf 'QUARANTINED: PASS regress-a-night\n' > "$TMP/order.out"
printf 'Passed QUARANTINED\n' > "$TMP/mixed.out"
printf 'hid 1 QUARANTINED post\nPASS  moderation\n' > "$TMP/modsplit.out"
printf 'PASS  x QUARANTINED\n\377\376 bad \303\n' > "$TMP/badbyte.out"

# --- the #1079 output is QUARANTINED, not PASS ------------------------------------
reset
if bc_quarantine_note regress-a-night "$TMP/q.out"; then ok "the #1079 output is recognised"; else bad "the #1079 output read as a pass"; fi
[ "${QUARANTINED[*]:-}" = regress-a-night ] && ok "it is recorded by label" || bad "QUARANTINED=${QUARANTINED[*]:-}"
case "$LOGGED" in *"QUARANTINED  regress-a-night"*) ok "it is logged as QUARANTINED" ;; *) bad "log: $LOGGED" ;; esac

# --- an ordinary pass and the honest skip are untouched --------------------------
reset
bc_quarantine_note ok-check "$TMP/pass.out" && bad "a real pass was taken as quarantined" || ok "a real pass stays a pass"
bc_quarantine_note skip-check "$TMP/skip.out" && bad "the honest SKIPPED was taken as quarantined" || ok "the honest SKIPPED is not a quarantine"
bc_quarantine_note partial "$TMP/partial.out" && bad "a longer word containing it matched" || ok "whole word only"
bc_quarantine_note modsplit "$TMP/modsplit.out" && bad "quarantined on a non-PASS line was taken as a quarantine" || ok "quarantined outside a PASS line is not a quarantine"
bc_quarantine_note order "$TMP/order.out" && ok "either order counts (quarantined before PASS)" || bad "QUARANTINED before PASS was missed"
bc_quarantine_note mixed "$TMP/mixed.out" && bad "a lower-case Passed was taken as PASS" || ok "PASS is matched as written, as in the source test"
QUARANTINED=()
bc_quarantine_note gone "$TMP/missing.out" && ok "an unreadable capture fails closed, not PASS" || bad "a missing capture read as a pass"
case "$LOGGED" in *"QUARANTINED  gone (its output could not be read"*) ok "and says it could not read it" ;; *) bad "log: $LOGGED" ;; esac
QUARANTINED=()
[ "${#QUARANTINED[@]}" -eq 0 ] && ok "none of those were recorded" || bad "QUARANTINED=${QUARANTINED[*]:-}"
QUARANTINED=()
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 bc_quarantine_note badbyte "$TMP/badbyte.out" && ok "an invalid byte in the output under a UTF-8 locale still reads the token (review round 9)" || bad "an invalid byte turned a quarantine into PASS"
case "$LOGGED" in *"QUARANTINED  badbyte (exited 0"*) ok "and it is the token match, not the unreadable fallback" ;; *) bad "log: $LOGGED" ;; esac
QUARANTINED=()
bc_quarantine_note lower "$TMP/lower.out" && bad "lower-case quarantined was taken as the token" || ok "lower-case quarantined is not the token (a real moderation status)"
bc_quarantine_note modpass "$TMP/modpass.out" && bad "a full pass reporting on quarantined posts was refused" || ok "a full pass that reports on quarantined posts stays a pass (review round 6)"

# --- the verdict: refused without the override ------------------------------------
reset
unset KOSMOS_BC_ALLOW_QUARANTINE
bc_quarantine_note regress-a-night "$TMP/q.out"
bc_quarantine_verdict
[ "${#FAILED[@]}" -eq 1 ] && ok "a quarantine fails the run" || bad "FAILED=${FAILED[*]:-}"
case "${FAILED[*]:-}" in *"regress-a-night (QUARANTINED"*) ok "FAILED names it and why" ;; *) bad "FAILED=${FAILED[*]:-}" ;; esac
case "${REASONS[*]:-}" in *KOSMOS_BC_ALLOW_QUARANTINE=1*) ok "the reason says how to override" ;; *) bad "REASONS=${REASONS[*]:-}" ;; esac

# --- the override: green, and printed ---------------------------------------------
reset
bc_quarantine_note regress-a-night "$TMP/q.out"
KOSMOS_BC_ALLOW_QUARANTINE=1 bc_quarantine_verdict
[ "${#FAILED[@]}" -eq 0 ] && ok "the override lets the run through" || bad "FAILED=${FAILED[*]}"
case "$LOGGED" in *"QUARANTINE OVERRIDE"*"WITHOUT: regress-a-night"*) ok "the override is printed with the name" ;; *) bad "log: $LOGGED" ;; esac

reset
bc_quarantine_note regress-a-night "$TMP/q.out"
KOSMOS_BC_ALLOW_QUARANTINE=yes bc_quarantine_verdict
[ "${#FAILED[@]}" -eq 1 ] && ok "only =1 overrides (yes does not)" || bad "FAILED=${FAILED[*]:-}"

# --- nothing quarantined: the verdict is silent ------------------------------------
reset
bc_quarantine_verdict
[ "${#FAILED[@]}" -eq 0 ] && [ -z "$LOGGED" ] && ok "no quarantine, no effect" || bad "FAILED=${FAILED[*]:-} log=$LOGGED"

# --- the harness actually calls these (not just defines them) ----------------------
BC="$REPO/tools/browser-checks.sh"
n_note="$(grep -cE '^[[:space:]]*bc_quarantine_note "\$label" "\$cap" \|\| log "PASS  \$label' "$BC")"
[ "$n_note" -eq 2 ] && ok "both PASS paths in run_one go through bc_quarantine_note" || bad "bc_quarantine_note guards $n_note PASS paths, want 2"
n_plain="$(grep -cE '^[[:space:]]*log "PASS  \$label' "$BC")"
[ "$n_plain" -eq 0 ] && ok "no PASS path in run_one bypasses it" || bad "$n_plain PASS log(s) bypass the quarantine note"
v_line="$(grep -nE '^bc_quarantine_verdict$' "$BC" | cut -d: -f1)"
f_line="$(grep -nE '^if \[ "\$\{#FAILED\[@\]\}" -gt 0 \]; then$' "$BC" | tail -1 | cut -d: -f1)"
[ -n "$v_line" ] && [ -n "$f_line" ] && [ "$v_line" -lt "$f_line" ] && ok "the verdict runs before the FAILED gate" || bad "verdict line=$v_line, FAILED gate line=$f_line"

# --- the harness fails CLOSED when the lib does not load (review WARNING 1) ----------
# Run the harness's own source-and-guard lines, with a REPO that has no lib.
# Bounded to 6 lines, so a harness with the guard removed never feeds its own body to eval.
snip="$(awk '/^\. "\$REPO\/tools\/lib\/bc-quarantine\.sh"$/{on=1} on{print; n++} on&&(/refusing to run/||n>=6){exit}' "$BC")"
case "$snip" in *'declare -F bc_quarantine_note'*'exit 1'*) ok "the source line is followed by a fail-closed guard" ;; *) bad "no fail-closed guard after the source line: $snip" ;; esac
mkdir -p "$TMP/norepo/tools/lib"
( unset -f bc_quarantine_note bc_quarantine_verdict; REPO="$TMP/norepo"; eval "$snip" ) >/dev/null 2>&1
rc=$?
[ "$rc" -eq 1 ] && ok "without the lib the harness refuses (exit 1), not PASS" || bad "without the lib the guard exited $rc"
( unset -f bc_quarantine_note bc_quarantine_verdict; eval "$snip"; declare -F bc_quarantine_note >/dev/null ) >/dev/null 2>&1 \
  && ok "with the lib the guard lets it through" || bad "the guard refused with the lib present"

# --- release 3b shows a quarantine in its summary (review NIT 2) -------------------
pat="$(grep -oE "grep -E '[^']*QUARANTINED[^']*' \"\\\$_page_log\"" "$REPO/tools/release.sh" | sed -E "s/^grep -E '([^']*)'.*/\1/")"
if [ -n "$pat" ] && printf 'QUARANTINED  regress-a-night (exited 0 ...)\n' | grep -qE "$pat"; then ok "release 3b's summary grep shows the QUARANTINED line"; else bad "release 3b's summary grep (${pat:-not found}) misses QUARANTINED"; fi

# --- release step 1e refuses an expiring quarantine BEFORE the bump, and says why ---
# Run release.sh's own step-1e block, under release.sh's shell options, against a fixture
# tree holding the real guard test and one planted check.
blk="$(awk '/^step "== 1e\./{on=1; next} on&&/^step "== 2\./{exit} on{print}' "$REPO/tools/release.sh")"
case "$blk" in *'KOSMOS_QUARANTINE_AT_VERSION="$V"'*'exit 1'*) ok "step 1e runs the guard test against the version being cut" ;; *) bad "step 1e block not found or changed: $blk" ;; esac
fx="$TMP/fx"; mkdir -p "$fx/docs/browser-checks"
cp "$REPO/browser-checks-quarantine-guard.test.js" "$fx/"
printf '{ "version": "0.7.01" }\n' > "$fx/package.json"
for n in $(seq 1 101); do printf "const b = await chromium.launch();\nconsole.log('PASS  c$n');\nprocess.exit(0);\n" > "$fx/docs/browser-checks/c$n.js"; done
printf "(async () => {\n  // QUARANTINE until=0.7.03 card=#9999: planted\n  console.log('PASS  planted QUARANTINED');\n  process.exit(0);\n  const b = await chromium.launch();\n})();\n" > "$fx/docs/browser-checks/planted.js"
run1e() { ( set -euo pipefail; REPO="$fx"; V="$1"; eval "$blk" ) 2>&1; }
out="$(run1e 0.7.03)"; rc=$?
[ "$rc" -eq 1 ] && ok "step 1e refuses a quarantine that expires at the version being cut" || bad "step 1e exited $rc at 0.7.03: $out"
case "$out" in *"planted.js:4 is quarantined until 0.7.3"*"fix the check"*) ok "and names the check and says what to do (set -e does not cut it short)" ;; *) bad "step 1e output: $out" ;; esac
out="$(run1e 0.7.02)"; rc=$?
[ "$rc" -eq 0 ] && ok "step 1e lets a version below until through (the control)" || bad "step 1e exited $rc at 0.7.02: $out"
# A failure for another reason (here a broken control) is named, not shown as a pass line (round 10).
printf "\ntest('planted control', () => { throw new Error('planted boom'); });\n" >> "$fx/browser-checks-quarantine-guard.test.js"
out="$(run1e 0.7.02)"; rc=$?
case "$rc:$out" in 1:*"✖ planted control"*) ok "step 1e names a failing test that is not a quarantine finding" ;; *) bad "step 1e on a broken control (rc=$rc): $out" ;; esac

echo "bc-quarantine: $passes passed, $fails failed"
[ "$fails" -eq 0 ] && [ "$passes" -eq 35 ] || { echo "expected 35 passes and 0 failures"; exit 1; }
