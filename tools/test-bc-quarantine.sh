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
printf 'PASS  quarantined in lower case still counts\n' > "$TMP/lower.out"
printf 'PASS  the quarantinedness of nothing\n' > "$TMP/partial.out"

# --- the #1079 output is QUARANTINED, not PASS ------------------------------------
reset
if bc_quarantine_note regress-a-night "$TMP/q.out"; then ok "the #1079 output is recognised"; else bad "the #1079 output read as a pass"; fi
[ "${QUARANTINED[*]}" = regress-a-night ] && ok "it is recorded by label" || bad "QUARANTINED=${QUARANTINED[*]}"
case "$LOGGED" in *"QUARANTINED  regress-a-night"*) ok "it is logged as QUARANTINED" ;; *) bad "log: $LOGGED" ;; esac

# --- an ordinary pass and the honest skip are untouched --------------------------
reset
bc_quarantine_note ok-check "$TMP/pass.out" && bad "a real pass was taken as quarantined" || ok "a real pass stays a pass"
bc_quarantine_note skip-check "$TMP/skip.out" && bad "the honest SKIPPED was taken as quarantined" || ok "the honest SKIPPED is not a quarantine"
bc_quarantine_note partial "$TMP/partial.out" && bad "a longer word containing it matched" || ok "whole word only"
bc_quarantine_note gone "$TMP/missing.out" && bad "a missing capture was taken as quarantined" || ok "a missing capture is not a quarantine"
[ "${#QUARANTINED[@]}" -eq 0 ] && ok "none of those were recorded" || bad "QUARANTINED=${QUARANTINED[*]}"
bc_quarantine_note lower "$TMP/lower.out" && ok "any case counts" || bad "lower case missed"

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

echo "bc-quarantine: $passes passed, $fails failed"
[ "$fails" -eq 0 ] && [ "$passes" -eq 23 ] || { echo "expected 23 passes and 0 failures"; exit 1; }
