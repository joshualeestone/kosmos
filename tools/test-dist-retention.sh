#!/bin/bash
# #1605 -- tests for dist-retention.sh. Fixture-based: every arm builds its own
# throwaway dist dir (never the real one) so arms cannot contaminate each other.
# Each arm asserts the POSTCONDITION (which files are present/absent), not just an
# exit code, so a tool that exits 0 while deleting the wrong thing still fails.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/dist-retention.sh"
PASS=0; FAIL=0
ok(){ echo "PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "FAIL  $1"; FAIL=$((FAIL+1)); }

# #1605 second-copy gate: every fixture version is also copied, byte for byte, into
# one shared MIRROR (fixture bytes are a pure function of the version, so arms
# cannot disagree about them). The pre-gate arms below run with LEGACY args: the
# mirror as --copy-base (so every candidate has a proven copy, and they test the
# keep rules exactly as before) and --prod-history 0 (fixtures are not git repos).
# The gate and the history rule have their own arms at the end, without LEGACY.
mirror_version(){ # $1=dir $2=version $3=arch $4=ext
  local f
  mkdir -p "$MIRROR"
  for f in "kosmos-$2-$3.$4" "kosmos-$2-$3.$4.sha256" "kosmos-$2-$3.manifest.json"; do
    cp "$1/$f" "$MIRROR/$f"
  done
}

# Build a fixture dist dir: $1=dir, $2=served version, rest=versions to create.
make_fixture(){
  local dir="$1" served="$2"; shift 2
  mkdir -p "$dir"
  local v
  for v in "$@"; do
    printf 'tar-%s\n' "$v"    > "$dir/kosmos-${v}-arm64.tar.gz"
    printf 'sha-%s\n' "$v"    > "$dir/kosmos-${v}-arm64.tar.gz.sha256"
    printf '{"version":"%s"}\n' "$v" > "$dir/kosmos-${v}-arm64.manifest.json"
    mirror_version "$dir" "$v" arm64 tar.gz
  done
  # Protected invariants a real dist carries.
  : > "$dir/kosmos-arm64.tar.gz";        : > "$dir/kosmos-arm64.tar.gz.sha256"
  : > "$dir/tmux-arm64.tar.gz";          : > "$dir/tmux-arm64.tar.gz.sha256"
  : > "$dir/kosmos-win-x64.zip";         : > "$dir/kosmos-win-x64.zip.sha256"
  : > "$dir/Kosmos.pkg"; : > "$dir/Kosmos.pkg.sha256"; : > "$dir/Kosmos.pkg.inputs"
  : > "$dir/latest-win.json"
  printf '{"version":"%s","sha256":"deadbeef","artifact":"kosmos-%s-arm64.tar.gz","manifest":"kosmos-%s-arm64.manifest.json"}\n' \
    "$served" "$served" "$served" > "$dir/latest.json"
}
present(){ [ -e "$1/$2" ]; }
absent(){ [ ! -e "$1/$2" ]; }
count_files(){ find "$1" -type f | wc -l | tr -d ' '; }
assert_invariants(){ # $1=dir label $2=dir
  local lbl="$1" d="$2" bad=0 f
  for f in kosmos-arm64.tar.gz kosmos-arm64.tar.gz.sha256 tmux-arm64.tar.gz \
           tmux-arm64.tar.gz.sha256 kosmos-win-x64.zip kosmos-win-x64.zip.sha256 \
           Kosmos.pkg Kosmos.pkg.sha256 Kosmos.pkg.inputs latest.json latest-win.json; do
    present "$d" "$f" || { bad=1; echo "    missing invariant: $f"; }
  done
  [ "$bad" -eq 0 ] && ok "$lbl: all protected invariants intact" || no "$lbl: an invariant was deleted"
}

TMP="$(mktemp -d)"; SRV=""
trap '[ -z "$SRV" ] || kill "$SRV" 2>/dev/null; rm -rf "$TMP"' EXIT
MIRROR="$TMP/mirror"
LEGACY=(--prod-history 0 --copy-base "file://$MIRROR")

# --- Arm 1: dry run deletes nothing ------------------------------------------
D="$TMP/a1"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
before="$(count_files "$D")"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 2>&1)"; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "dry run: exit 0" || no "dry run: exit $rc"
[ "$before" = "$after" ] && ok "dry run: deleted nothing ($before files)" || no "dry run: file count changed $before -> $after"
echo "$out" | grep -q "prune candidates:.*3 version" && ok "dry run: reports 3 prune candidates" || no "dry run: wrong prune count -- $out"

# --- Arm 2: --prune without --yes refuses ------------------------------------
D="$TMP/a2"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
before="$(count_files "$D")"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune >/dev/null 2>&1; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 2 ] && ok "prune w/o --yes: refuses (exit 2)" || no "prune w/o --yes: exit $rc (want 2)"
[ "$before" = "$after" ] && ok "prune w/o --yes: deleted nothing" || no "prune w/o --yes: file count changed"

# --- Arm 3: --prune --yes, served in-window ----------------------------------
D="$TMP/a3"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "prune --yes: exit 0" || no "prune --yes: exit $rc"
{ absent "$D" kosmos-0.6.08-arm64.tar.gz && absent "$D" kosmos-0.6.09-arm64.tar.gz && absent "$D" kosmos-0.6.10-arm64.tar.gz; } \
  && ok "prune --yes: oldest 3 versions deleted" || no "prune --yes: oldest 3 not all deleted"
{ absent "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && absent "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "prune --yes: pruned version's sidecars also deleted" || no "prune --yes: sidecars left orphaned"
{ present "$D" kosmos-0.6.11-arm64.tar.gz && present "$D" kosmos-0.6.22-arm64.tar.gz; } \
  && ok "prune --yes: newest 12 retained" || no "prune --yes: a retained version was deleted"
assert_invariants "prune --yes" "$D"

# --- Arm 4: served version OUTSIDE keep window is protected -------------------
D="$TMP/a4"; make_fixture "$D" 0.6.08 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "served-outside-window: 0.6.08 protected despite being oldest" || no "served-outside-window: served version was pruned!"
{ absent "$D" kosmos-0.6.09-arm64.tar.gz && absent "$D" kosmos-0.6.10-arm64.tar.gz; } \
  && ok "served-outside-window: the other 2 out-of-window versions pruned" || no "served-outside-window: 09/10 not pruned"

# --- Arm 4c: served parse takes FIRST "version", not a nested one ------------
# latest.json names 0.6.08 (oldest, outside a keep-12 window) but also carries a
# nested "version":"9.9.9". A greedy parse would read 9.9.9 (not a real triple),
# leave 0.6.08 unprotected, and PRUNE the served release. First-match keeps 0.6.08.
D="$TMP/a4c"; make_fixture "$D" 0.6.08 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
printf '{"version":"0.6.08","sha256":"x","artifact":"kosmos-0.6.08-arm64.tar.gz","meta":{"version":"9.9.9"}}\n' > "$D/latest.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.08-arm64.tar.gz \
  && ok "nested-version parse: served 0.6.08 protected (first-match, not 9.9.9)" \
  || no "nested-version parse: served release was PRUNED -- greedy parse bug"

# --- Arm 5: keep >= number of versions prunes nothing ------------------------
D="$TMP/a5"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
before="$(count_files "$D")"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 20 --prune --yes >/dev/null 2>&1
after="$(count_files "$D")"
[ "$before" = "$after" ] && ok "keep>=count: deleted nothing" || no "keep>=count: deleted something ($before -> $after)"

# --- Arm 6: unrecognised stray + alias never touched -------------------------
D="$TMP/a6"; make_fixture "$D" 0.6.22 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
printf 'stray\n' > "$D/random-stray.txt"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
present "$D" random-stray.txt && ok "unrecognised stray: never deleted" || no "unrecognised stray: deleted!"
present "$D" kosmos-arm64.tar.gz && ok "alias kosmos-arm64.tar.gz: never treated as a versioned triple" || no "alias: deleted!"

# --- Arm 7: version sort is numeric, not lexical -----------------------------
# versions 0.6.9, 0.6.10, 0.6.11; served 0.6.11; keep 2. Numeric-correct: keep
# {0.6.10,0.6.11}, prune 0.6.9. Lexical-wrong ("0.6.9">"0.6.11"): would keep 0.6.9
# and prune 0.6.10. Asserting 0.6.9 pruned AND 0.6.10 kept discriminates the two.
D="$TMP/a7"; make_fixture "$D" 0.6.11 0.6.9 0.6.10 0.6.11
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 2 --prune --yes >/dev/null 2>&1
absent "$D" kosmos-0.6.9-arm64.tar.gz && ok "sort: 0.6.9 pruned (numeric ordering)" || no "sort: 0.6.9 kept -- lexical sort bug"
present "$D" kosmos-0.6.10-arm64.tar.gz && ok "sort: 0.6.10 retained (numeric ordering)" || no "sort: 0.6.10 pruned -- lexical sort bug"

# --- Arm 8b: valid latest.json but ZERO versioned triples --------------------
# The bash-3.2 empty-array-under-set-u case. make_fixture with no version args
# creates the invariants + a latest.json but no triples.
D="$TMP/a8b"; make_fixture "$D" 0.6.30
before="$(count_files "$D")"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "versionless dist: dry run exit 0 (no empty-array crash)" || no "versionless dist: dry run exit $rc -- $out"
echo "$out" | grep -qE "versioned triples found: +0" && ok "versionless dist: reports 0 found" || no "versionless dist: wrong found count -- $out"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "versionless dist: prune --yes exit 0 (no crash in orphan check)" || no "versionless dist: prune exit $rc"
[ "$before" = "$after" ] && ok "versionless dist: deleted nothing" || no "versionless dist: file count changed"

# --- Arm 8: argument / precondition refusals ---------------------------------
bash "$TOOL" "${LEGACY[@]}" --keep 12 >/dev/null 2>&1; [ $? -ne 0 ] && ok "no --dist: refuses" || no "no --dist: did not refuse"
bash "$TOOL" "${LEGACY[@]}" --dist "$TMP/does-not-exist" >/dev/null 2>&1; [ $? -ne 0 ] && ok "non-dir --dist: refuses" || no "non-dir: did not refuse"
mkdir -p "$TMP/nolatest"; bash "$TOOL" "${LEGACY[@]}" --dist "$TMP/nolatest" >/dev/null 2>&1; [ $? -ne 0 ] && ok "dir without latest.json: refuses" || no "no latest.json: did not refuse"
bash "$TOOL" "${LEGACY[@]}" --dist "$TMP/a5" --keep -3 >/dev/null 2>&1; [ $? -ne 0 ] && ok "negative --keep: refuses" || no "negative --keep: did not refuse"

# --- Arm 9: --keep 0 deletes all but the served version ----------------------
D="$TMP/a9"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 0 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "keep 0: exit 0" || no "keep 0: exit $rc"
{ present "$D" kosmos-0.6.20-arm64.tar.gz && absent "$D" kosmos-0.6.18-arm64.tar.gz && absent "$D" kosmos-0.6.19-arm64.tar.gz; } \
  && ok "keep 0: only the served version survives" || no "keep 0: wrong survivors"
assert_invariants "keep 0" "$D"

# --- Arm 10: --json output is valid JSON naming the served version -----------
D="$TMP/a10"; make_fixture "$D" 0.6.22 0.6.20 0.6.21 0.6.22
js="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 2 --json 2>/dev/null)"
if command -v node >/dev/null 2>&1; then
  echo "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);if(o.served_version==="0.6.22"&&Array.isArray(o.prune_versions)&&o.prune_versions.includes("0.6.20"))process.exit(0);process.exit(1)})' \
    && ok "--json: valid JSON, names served + prune list" || no "--json: bad JSON or wrong fields -- $js"
  echo "$js" | grep -q '"staged_version"' && no "--json: emits staged_version with no staging pointer (output must be unchanged)" || ok "--json: no staged_version without a staging pointer (output unchanged)"
else
  echo "$js" | grep -q '"served_version":"0.6.22"' && ok "--json: names served version" || no "--json: missing served -- $js"
fi

# --- Arm 11: leading-zero --keep is base 10, not octal -----------------------
# --keep 08 must mean keep 8. Under the octal bug the arithmetic errors, the keep
# window empties, and everything but the served version is pruned. Asserting a mid
# version (0.6.12) is KEPT discriminates the bug (which prunes it) from the fix.
D="$TMP/a11"; make_fixture "$D" 0.6.19 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 08 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "octal keep: --keep 08 exit 0" || no "octal keep: exit $rc"
present "$D" kosmos-0.6.12-arm64.tar.gz && ok "octal keep: --keep 08 keeps 0.6.12 (base-10, window of 8)" || no "octal keep: 0.6.12 pruned -- octal bug (window emptied)"
absent "$D" kosmos-0.6.08-arm64.tar.gz && ok "octal keep: --keep 08 prunes the oldest 4" || no "octal keep: 0.6.08 not pruned"
assert_invariants "octal keep" "$D"

# --- Arm 12: served protected by artifact filename despite version-format skew ---
# latest.json version "0.6.5" (a phantom, no triple) but artifact names the real
# kosmos-0.6.08 file (oldest, outside a keep-12 window). Version-string protection
# alone would prune 0.6.08; artifact-filename protection keeps it.
D="$TMP/a12"; make_fixture "$D" 0.6.08 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
printf '{"version":"0.6.5","sha256":"x","artifact":"kosmos-0.6.08-arm64.tar.gz","manifest":"kosmos-0.6.08-arm64.manifest.json"}\n' > "$D/latest.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "artifact-name protection: served 0.6.08 kept despite version=\"0.6.5\"" \
  || no "artifact-name protection: served file PRUNED (version-format skew bug)"

# --- Arm 13: latest.json missing the "version" key refuses WITH a diagnostic ---
# Under set -e + pipefail a no-match grep would silently abort; the parse must
# tolerate it so the friendly "names no version" refusal is reached.
D="$TMP/a13"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
printf '{"artifact":"kosmos-0.6.20-arm64.tar.gz"}\n' > "$D/latest.json"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -q "names no version"; } \
  && ok "missing version key: refuses WITH diagnostic (no silent abort)" \
  || no "missing version key: rc=$rc, no diagnostic -- $out"

# --- Arm 14: latest.json missing the "artifact" key still runs ---------------
# The artifact field is optional (belt-and-suspenders); a no-match must not abort.
D="$TMP/a14"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
printf '{"version":"0.6.20"}\n' > "$D/latest.json"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "missing artifact key: still runs (field is optional)" || no "missing artifact key: aborted rc=$rc -- $out"
echo "$out" | grep -q "served version (protected): 0.6.20" && ok "missing artifact key: version protection still applies" || no "missing artifact key: served not protected -- $out"

# --- Arm 15: version-string protection works with NO artifact field ----------
# Isolates the version-string served protection. latest.json carries ONLY a
# "version" (a real shape -- test-install.sh and site-restore write version-only),
# so the artifact-filename path cannot mask it. Served = 0.6.08, oldest, outside a
# keep-12 window: only the version-string protection can save it. If that
# protection is removed, 0.6.08 is pruned and this arm goes red.
D="$TMP/a15"; make_fixture "$D" 0.6.08 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
printf '{"version":"0.6.08"}\n' > "$D/latest.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "version-only latest.json: served 0.6.08 protected by version-string path" \
  || no "version-only latest.json: served release PRUNED (version-string protection broken)"

# --- Arm 16: a pre-existing malformed dist does not false-trip the backstop ---
# A KEPT version already missing a sidecar BEFORE the run is not the prune's fault.
# The prune should succeed (exit 0, oldest pruned) and NOT report a tool bug.
D="$TMP/a16"; make_fixture "$D" 0.6.22 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
rm -f "$D/kosmos-0.6.15-arm64.manifest.json"   # kept version, pre-missing a sidecar
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "pre-malformed dist: prune succeeds (exit 0, no false bug report)" || no "pre-malformed dist: exit $rc -- $out"
echo "$out" | grep -q "this is a bug" && no "pre-malformed dist: falsely reported a tool bug" || ok "pre-malformed dist: did not misattribute a pre-existing gap to the prune"
{ absent "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.15-arm64.tar.gz; } \
  && ok "pre-malformed dist: still pruned oldest, kept 0.6.15's remaining files" || no "pre-malformed dist: wrong prune result"

# --- Arm 17: an absurd --keep clamps to keep-all, never wraps to prune ---------
# A ~20-digit --keep would overflow 64-bit arithmetic and wrap to a small window,
# pruning instead of keeping all. It must be clamped so nothing is pruned.
D="$TMP/a17"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
before="$(count_files "$D")"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 18446744073709551617 --prune --yes >/dev/null 2>&1; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "absurd keep: exit 0" || no "absurd keep: exit $rc"
[ "$before" = "$after" ] && ok "absurd keep: clamped to keep-all, pruned nothing (no 64-bit wrap)" || no "absurd keep: pruned something ($before -> $after) -- wrap bug"

# ===========================================================================
# #2112: the Windows (kosmos-<V>-win-x64.{zip,zip.sha256,manifest.json}) family,
# protected by latest-win.json. Same guarantees as arm64. make_fixture already
# lays down the win ALIAS + an empty latest-win.json; add_win adds versioned win
# triples + a real latest-win.json served pointer.
# ===========================================================================
add_win(){ # $1=dir $2=served-win-version, rest=win versions to create
  local dir="$1" served="$2"; shift 2
  local v
  for v in "$@"; do
    printf 'zip-%s\n' "$v" > "$dir/kosmos-${v}-win-x64.zip"
    printf 'sha-%s\n' "$v" > "$dir/kosmos-${v}-win-x64.zip.sha256"
    printf '{"version":"%s"}\n' "$v" > "$dir/kosmos-${v}-win-x64.manifest.json"
    mirror_version "$dir" "$v" win-x64 zip
  done
  printf '{"version":"%s","sha256":"deadbeef","artifact":"kosmos-%s-win-x64.zip","manifest":"kosmos-%s-win-x64.manifest.json"}\n' \
    "$served" "$served" "$served" > "$dir/latest-win.json"
}

# --- Win Arm 1: dry run reports win prune candidates, deletes nothing ---------
D="$TMP/w1"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.24 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22 0.6.23 0.6.24
before="$(count_files "$D")"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 3 2>&1)"; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "win dry run: exit 0" || no "win dry run: exit $rc"
[ "$before" = "$after" ] && ok "win dry run: deleted nothing" || no "win dry run: file count changed $before -> $after"
echo "$out" | grep -q "dist-retention \[win-x64\]" && ok "win dry run: emits a win-x64 block" || no "win dry run: no win block -- $out"
echo "$out" | grep -A6 "win-x64" | grep -q "prune candidates:.*4 version" && ok "win dry run: 4 win prune candidates (7 found, keep 3, served in-window)" || no "win dry run: wrong win prune count -- $out"

# --- Win Arm 2: --prune --yes prunes old win + sidecars, keeps newest+served,
#     and NEVER touches the win alias / arm64 / pkg / pointers ------------------
D="$TMP/w2"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.24 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22 0.6.23 0.6.24
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 3 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "win prune --yes: exit 0" || no "win prune --yes: exit $rc"
{ absent "$D" kosmos-0.6.18-win-x64.zip && absent "$D" kosmos-0.6.18-win-x64.zip.sha256 && absent "$D" kosmos-0.6.18-win-x64.manifest.json; } \
  && ok "win prune --yes: oldest win triple + sidecars deleted" || no "win prune --yes: old win triple not fully deleted"
{ present "$D" kosmos-0.6.24-win-x64.zip && present "$D" kosmos-0.6.23-win-x64.zip && present "$D" kosmos-0.6.22-win-x64.zip; } \
  && ok "win prune --yes: served + newest 3 win retained" || no "win prune --yes: a retained win version was deleted"
assert_invariants "win prune --yes" "$D"    # alias, arm64, pkg, latest*.json all intact
present "$D" kosmos-0.6.15-arm64.tar.gz && ok "win prune: the arm64 family is untouched by a win prune" || no "win prune: an arm64 file was deleted"

# --- Win Arm 3: served win version OUTSIDE the keep window is protected --------
D="$TMP/w3"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.18 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22   # served 0.6.18 is the OLDEST
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 2 --prune --yes >/dev/null 2>&1; rc=$?
present "$D" kosmos-0.6.18-win-x64.zip && ok "win served-outside-window: served 0.6.18 protected despite being oldest" || no "win served-outside-window: served win version PRUNED!"
{ absent "$D" kosmos-0.6.19-win-x64.zip && absent "$D" kosmos-0.6.20-win-x64.zip; } && ok "win served-outside-window: the other out-of-window win versions pruned" || no "win served-outside-window: 19/20 not pruned"

# --- Win Arm 4: BOTH families pruned in one run, independent keep windows ------
D="$TMP/w4"; make_fixture "$D" 0.6.22 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22   # 8 arm64, served 0.6.22
add_win "$D" 0.6.24 0.6.19 0.6.20 0.6.21 0.6.22 0.6.23 0.6.24                                   # 6 win, served 0.6.24
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 3 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "both families: prune --yes exit 0" || no "both families: exit $rc"
{ absent "$D" kosmos-0.6.15-arm64.tar.gz && present "$D" kosmos-0.6.22-arm64.tar.gz; } \
  && ok "both families: arm64 keep window applied (oldest pruned, newest kept)" || no "both families: arm64 window wrong"
{ absent "$D" kosmos-0.6.19-win-x64.zip && present "$D" kosmos-0.6.24-win-x64.zip; } \
  && ok "both families: win keep window applied independently" || no "both families: win window wrong"
assert_invariants "both families" "$D"

# --- Win Arm 5: fail-safe -- win triples present but latest-win.json absent ----
#     => the win family is NOT pruned (cannot identify the served release). ------
D="$TMP/w5"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.24 0.6.18 0.6.19 0.6.20 0.6.24
rm -f "$D/latest-win.json"                        # remove the win pointer AFTER add_win wrote it
before="$(count_files "$D")"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 1 --prune --yes 2>&1)"; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "win fail-safe: exit 0 (arm64 still processes; win refused)" || no "win fail-safe: exit $rc -- $out"
echo "$out" | grep -q "NOT pruning win-x64" && ok "win fail-safe: says it is NOT pruning win (no pointer)" || no "win fail-safe: no refusal message -- $out"
{ present "$D" kosmos-0.6.18-win-x64.zip && present "$D" kosmos-0.6.19-win-x64.zip; } \
  && ok "win fail-safe: NO win triple deleted without a served pointer" || no "win fail-safe: a win triple was pruned with no pointer -- UNSAFE"

# --- Win Arm 6: the win alias is never treated as a versioned triple -----------
D="$TMP/w6"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.20 0.6.18 0.6.19 0.6.20
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 1 --prune --yes >/dev/null 2>&1
present "$D" kosmos-win-x64.zip && ok "win alias kosmos-win-x64.zip: never pruned ([0-9] anchor excludes it)" || no "win alias: deleted!"

# --- Win Arm 6b: served win protected by ARTIFACT FILENAME despite version skew -
#     (mirrors arm64 Arm 12): latest-win.json version="0.6.5" but the file is
#     kosmos-0.6.05-win-x64.zip; the artifact-name fallback must protect it. -----
D="$TMP/w6b"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.05 0.6.05 0.6.06 0.6.07 0.6.08
# Skew the pointer: version field "0.6.5" (unpadded) while the served file is padded.
printf '{"version":"0.6.5","artifact":"kosmos-0.6.05-win-x64.zip","manifest":"kosmos-0.6.05-win-x64.manifest.json"}\n' > "$D/latest-win.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 1 --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.05-win-x64.zip && ok "win artifact-name protection: served 0.6.05 kept despite version=\"0.6.5\" skew" || no "win artifact-name protection: served win file PRUNED (skew bug)"

# --- Win Arm 6c: an unrecognised win-shaped stray is never touched -------------
D="$TMP/w6c"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.20 0.6.18 0.6.19 0.6.20
: > "$D/kosmos-win-x64-notes.txt"; : > "$D/win-x64-stray.zip"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 1 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-win-x64-notes.txt && present "$D" win-x64-stray.zip; } \
  && ok "win stray files: unrecognised win-shaped names never deleted" || no "win stray files: a stray was deleted!"

# --- Win Arm 7: a dist with ZERO win triples emits NO win block ----------------
#     (arm64-only behaviour is byte-identical to pre-#2112) ---------------------
D="$TMP/w7"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20    # no add_win: only the empty latest-win.json + alias
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 12 2>&1)"
echo "$out" | grep -q "win-x64" && no "zero-win dist: emitted a win block for a dist with no win releases" || ok "zero-win dist: no win block (arm64-only output unchanged)"
echo "$out" | grep -q "staged version" && no "no staging pointer: printed a staged line" || ok "no staging pointer: no staged line (output unchanged)"

# ===========================================================================
# The staging channel: a STAGED build (named by latest-staging.json for arm64,
# latest-win-staging.json for win-x64) is waiting for its promote, so it is
# protected like the served one. Each arm uses --keep 0, which keeps ONLY what
# is protected: without the staged protection the staged (newest) version is
# pruned, so each arm goes red when that protection is removed.
# ===========================================================================

# --- Staged Arm 1: arm64 staged version survives --keep 0 -------------------
D="$TMP/s1"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20 0.6.21
printf '{"version":"0.6.21","sha256":"x","artifact":"kosmos-0.6.21-arm64.tar.gz","manifest":"kosmos-0.6.21-arm64.manifest.json"}\n' > "$D/latest-staging.json"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 0 --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "arm64 staged: prune exit 0" || no "arm64 staged: exit $rc -- $out"
{ present "$D" kosmos-0.6.21-arm64.tar.gz && present "$D" kosmos-0.6.21-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.21-arm64.manifest.json; } \
  && ok "arm64 staged: the version latest-staging.json names is protected" || no "arm64 staged: the STAGED release was PRUNED"
{ present "$D" kosmos-0.6.20-arm64.tar.gz && absent "$D" kosmos-0.6.18-arm64.tar.gz && absent "$D" kosmos-0.6.19-arm64.tar.gz; } \
  && ok "arm64 staged: served kept, the unprotected versions still pruned" || no "arm64 staged: wrong survivors"
echo "$out" | grep -q "staged version (protected): 0.6.21" && ok "arm64 staged: the report names the staged version" || no "arm64 staged: no staged line -- $out"
present "$D" latest-staging.json && ok "arm64 staged: the staging pointer itself is never touched" || no "arm64 staged: latest-staging.json deleted!"

# --- Staged Arm 2: win-x64 staged version survives --keep 0 -----------------
# The real Windows pointer shape: "artifact" is the ALIAS, "versioned" names the zip.
D="$TMP/s2"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.24 0.6.22 0.6.23 0.6.24 0.6.25
printf '{"version":"0.6.25","sha256":"x","artifact":"kosmos-win-x64.zip","versioned":"kosmos-0.6.25-win-x64.zip","arch":"x64"}\n' > "$D/latest-win-staging.json"
out="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 0 --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "win staged: prune exit 0" || no "win staged: exit $rc -- $out"
{ present "$D" kosmos-0.6.25-win-x64.zip && present "$D" kosmos-0.6.25-win-x64.zip.sha256; } \
  && ok "win staged: the version latest-win-staging.json names is protected" || no "win staged: the STAGED Windows release was PRUNED"
{ present "$D" kosmos-0.6.24-win-x64.zip && absent "$D" kosmos-0.6.22-win-x64.zip && absent "$D" kosmos-0.6.23-win-x64.zip; } \
  && ok "win staged: served kept, the unprotected win versions still pruned" || no "win staged: wrong survivors"
{ present "$D" latest-win-staging.json && present "$D" kosmos-win-x64.zip; } && ok "win staged: the staging pointer and the alias are never touched" || no "win staged: pointer or alias deleted!"
js="$(bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 0 --json 2>/dev/null)"
echo "$js" | grep -q '"win_x64":{[^}]*"staged_version":"0.6.25"' && ok "win staged: --json names the staged version" || no "win staged: --json has no staged_version -- $js"

# --- Staged Arm 3: the win staged build is protected by its VERSIONED name ---
# Version-format skew (pointer "0.6.5", file kosmos-0.6.05-...): only the
# "versioned" filename can protect it, since a Windows pointer's "artifact" is
# the alias. Mirrors Win Arm 6b for the staged pointer.
D="$TMP/s3"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.04 0.6.04 0.6.05
printf '{"version":"0.6.5","sha256":"x","artifact":"kosmos-win-x64.zip","versioned":"kosmos-0.6.05-win-x64.zip","arch":"x64"}\n' > "$D/latest-win-staging.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 0 --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.05-win-x64.zip && ok "win staged skew: protected by its versioned filename despite version=\"0.6.5\"" || no "win staged skew: the staged file was PRUNED"

# --- Staged Arm 4: the SERVED Windows pointer protects by "versioned" too ----
# latest-win.json's real shape names the alias in "artifact", so the skew
# fallback must read "versioned" to protect the served zip.
D="$TMP/s4"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.05 0.6.05 0.6.06 0.6.07
printf '{"version":"0.6.5","sha256":"x","artifact":"kosmos-win-x64.zip","versioned":"kosmos-0.6.05-win-x64.zip","arch":"x64"}\n' > "$D/latest-win.json"
bash "$TOOL" "${LEGACY[@]}" --dist "$D" --keep 1 --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.05-win-x64.zip && ok "win served skew (real pointer shape): protected by its versioned filename" || no "win served skew: the served zip was PRUNED"

# =============================================================================
# #1605 SECOND-COPY GATE. No LEGACY args from here on: each arm names its own
# --copy-base, and uses --prod-history 0 only where history is not under test.
# =============================================================================
ten(){ echo 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17; }

# --- Gate 1: a confirmed prune with NO --copy-base refuses and deletes nothing
D="$TMP/g1"; make_fixture "$D" 0.6.17 $(ten)
before="$(count_files "$D")"
out="$(bash "$TOOL" --dist "$D" --keep 2 --prod-history 0 --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && ok "gate: --prune --yes without --copy-base refuses (exit 2)" || no "gate: no-copy-base exit $rc -- $out"
[ "$before" = "$(count_files "$D")" ] && ok "gate: without --copy-base nothing deleted" || no "gate: deleted without a copy base!"

# --- Gate 2: a copy base that holds NOTHING refuses every candidate -----------
D="$TMP/g2"; make_fixture "$D" 0.6.17 $(ten); mkdir -p "$TMP/empty-mirror"
before="$(count_files "$D")"
out="$(bash "$TOOL" --dist "$D" --keep 2 --prod-history 0 --copy-base "file://$TMP/empty-mirror" --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "gate: no copies -> exit 0 (refusing is not an error)" || no "gate: no copies exit $rc -- $out"
[ "$before" = "$(count_files "$D")" ] && ok "gate: no copies -> NOTHING deleted" || no "gate: deleted a version with no proven copy!"
echo "$out" | grep -q "REFUSED, kept (no proven byte-identical copy): 8 version" && ok "gate: report names 8 refused versions" || no "gate: refusal not reported -- $out"

# --- Gate 3: a MISMATCHED copy is refused; a matching one (control) is pruned -
# Same dist, same run: 0.6.08's copy has different bytes, 0.6.09's is exact.
D="$TMP/g3"; make_fixture "$D" 0.6.17 $(ten); M="$TMP/g3-mirror"; mkdir -p "$M"
cp "$MIRROR"/kosmos-0.6.0[89]-arm64.* "$M/"
printf 'tampered\n' > "$M/kosmos-0.6.08-arm64.tar.gz"
out="$(bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$M" --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "gate mismatch: exit 0" || no "gate mismatch: exit $rc -- $out"
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "gate mismatch: 0.6.08 (copy differs) kept, whole triple" || no "gate mismatch: deleted a version whose copy DIFFERS"
{ absent "$D" kosmos-0.6.09-arm64.tar.gz && absent "$D" kosmos-0.6.09-arm64.manifest.json; } \
  && ok "gate control: 0.6.09 (exact copy) pruned, so the gate can say yes" || no "gate control: an exactly-copied version was NOT pruned -- the gate refuses everything"
echo "$out" | grep -q "kosmos-0.6.08-arm64: copy of kosmos-0.6.08-arm64.tar.gz DIFFERS" && ok "gate mismatch: reason names the differing file" || no "gate mismatch: no DIFFERS reason -- $out"

# --- Gate 4: a copy missing ONE sidecar keeps the WHOLE triple ----------------
D="$TMP/g4"; make_fixture "$D" 0.6.17 $(ten); M="$TMP/g4-mirror"; mkdir -p "$M"
cp "$MIRROR"/kosmos-0.6.08-arm64.* "$M/"; rm -f "$M/kosmos-0.6.08-arm64.manifest.json"
bash "$TOOL" --dist "$D" --keep 9 --prod-history 0 --copy-base "file://$M" --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "gate partial copy: all three files kept (no half-deleted triple)" || no "gate partial copy: deleted part of a triple whose copy is incomplete"

# --- Gate 5: the served site and the dist itself are not a second copy --------
D="$TMP/g5"; make_fixture "$D" 0.6.17 $(ten); before="$(count_files "$D")"
for base in https://installkosmos.com/dist https://INSTALLKOSMOS.COM/dist https://www.installkosmos.com/dist https://chaoskosmos.com/dist "file://$D" "file://$D/" http://example.com/x; do
  bash "$TOOL" --dist "$D" --keep 2 --prod-history 0 --copy-base "$base" --prune --yes >/dev/null 2>&1; rc=$?
  [ "$rc" -eq 1 ] && ok "gate base refused: $base" || no "gate base ACCEPTED (exit $rc): $base"
done
[ "$before" = "$(count_files "$D")" ] && ok "gate base: nothing deleted by any refused base" || no "gate base: files deleted"

# --- Gate 6: --check-copies dry run reports the gate and deletes nothing ------
D="$TMP/g6"; make_fixture "$D" 0.6.17 $(ten)
before="$(count_files "$D")"
js="$(bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$TMP/g3-mirror" --check-copies --json 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$before" = "$(count_files "$D")" ] && ok "check-copies: dry run, nothing deleted" || no "check-copies: rc $rc or files changed"
echo "$js" | grep -q '"copy_proven":\["0.6.09"\],"copy_refused":\["0.6.08"\]' && ok "check-copies: --json splits proven/refused" || no "check-copies: wrong json -- $js"
out="$(bash "$TOOL" --dist "$D" --check-copies --prod-history 0 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "needs --copy-base" && ok "check-copies without --copy-base: refuses, and says why" || no "check-copies without --copy-base: rc $rc -- $out"

# =============================================================================
# #1605 KEEP RULE: prior served versions from git, rollback pointers, versions.html
# =============================================================================
gitc(){ git -C "$1" -c user.email=t@example.invalid -c user.name=t -c commit.gpgsign=false "${@:2}"; }
serve(){ # $1=dist $2=version : point latest.json at it and commit, like a promote
  printf '{"version":"%s","sha256":"x","artifact":"kosmos-%s-arm64.tar.gz"}\n' "$2" "$2" > "$1/latest.json"
  gitc "$1" add latest.json >/dev/null && gitc "$1" commit -q -m "promote $2" -- latest.json
}

# --- History 1: the site repo's promote log protects the prior N served ------
S="$TMP/h1site"; D="$S/dist"; make_fixture "$D" 0.6.17 $(ten)
git init -q "$S"
for v in 0.6.09 0.6.11 0.6.13 0.6.15 0.6.17; do serve "$D" "$v"; done
out="$(bash "$TOOL" --dist "$D" --keep 0 --prod-history 2 --copy-base "file://$MIRROR" --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "history: exit 0" || no "history: exit $rc -- $out"
{ present "$D" kosmos-0.6.17-arm64.tar.gz && present "$D" kosmos-0.6.15-arm64.tar.gz && present "$D" kosmos-0.6.13-arm64.tar.gz; } \
  && ok "history: served 0.6.17 + prior 2 served (0.6.15, 0.6.13) kept" || no "history: a prior served version was pruned -- $out"
{ absent "$D" kosmos-0.6.11-arm64.tar.gz && absent "$D" kosmos-0.6.16-arm64.tar.gz && absent "$D" kosmos-0.6.08-arm64.tar.gz; } \
  && ok "history: the 3rd prior served (0.6.11) and never-served versions pruned" || no "history: kept too much -- $out"
echo "$out" | grep -q "prior served (protected):   0.6.15 0.6.13 " && ok "history: report names the prior served versions" || no "history: report -- $out"

# --- History 2: a version served twice (a rollback, then forward) counts once -
# Log newest first: 0.6.17, 0.6.13, 0.6.15, 0.6.13, 0.6.11. Distinct prior 3 =
# 0.6.13 0.6.15 0.6.11. Without the dedupe the slots go 13,15,13 and 0.6.11 is pruned.
S="$TMP/h2site"; D="$S/dist"; make_fixture "$D" 0.6.17 $(ten)
git init -q "$S"
for v in 0.6.11 0.6.13 0.6.15 0.6.13 0.6.17; do serve "$D" "$v"; done
bash "$TOOL" --dist "$D" --keep 0 --prod-history 3 --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.13-arm64.tar.gz && present "$D" kosmos-0.6.15-arm64.tar.gz && present "$D" kosmos-0.6.11-arm64.tar.gz; } \
  && ok "history dedupe: 0.6.13 served twice still leaves room for 0.6.11" || no "history dedupe: a repeat promote consumed a slot"
absent "$D" kosmos-0.6.12-arm64.tar.gz && ok "history dedupe: a never-served version pruned (control)" || no "history dedupe: over-kept"

# --- History 3: unreadable history (not a git checkout) prunes NOTHING --------
D="$TMP/h3"; make_fixture "$D" 0.6.17 $(ten)
before="$(count_files "$D")"
out="$(bash "$TOOL" --dist "$D" --keep 0 --copy-base "file://$MIRROR" --prune --yes 2>&1)"; rc=$?
[ "$before" = "$(count_files "$D")" ] && ok "history unreadable: default --prod-history 3 fails closed, nothing deleted" || no "history unreadable: pruned without history!"
echo "$out" | grep -q "cannot be read from latest.json's git history" && ok "history unreadable: says why" || no "history unreadable: silent -- $out"
bash "$TOOL" --dist "$D" --keep 0 --prod-history 0 --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
absent "$D" kosmos-0.6.08-arm64.tar.gz && ok "history opt-out: --prod-history 0 prunes (control)" || no "history opt-out: still refused"

# --- History 4: a rollback pointer and versions.html protect what they name ---
S="$TMP/h4site"; D="$S/dist"; make_fixture "$D" 0.6.17 $(ten)
printf '{"version":"0.6.09","artifact":"kosmos-0.6.09-arm64.tar.gz"}\n' > "$D/latest-rollback.json"
printf '<a href="dist/kosmos-0.6.11-arm64.tar.gz">0.6.11</a>\n' > "$S/versions.html"
printf 'see kosmos-0.6.13-arm64.tar.gz\n' > "$TMP/h4-refs.txt"
bash "$TOOL" --dist "$D" --keep 0 --prod-history 0 --referenced-by "$TMP/h4-refs.txt" --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.09-arm64.tar.gz && ok "rollback pointer: the version it names is kept" || no "rollback pointer: PRUNED"
present "$D" kosmos-0.6.11-arm64.tar.gz && ok "versions.html: a linked download is kept (read by default)" || no "versions.html: linked download PRUNED"
present "$D" kosmos-0.6.13-arm64.tar.gz && ok "--referenced-by: a named artifact is kept" || no "--referenced-by: PRUNED"
{ absent "$D" kosmos-0.6.10-arm64.tar.gz && absent "$D" kosmos-0.6.12-arm64.tar.gz; } && ok "references: unreferenced versions still pruned (control)" || no "references: over-kept"
out="$(bash "$TOOL" --dist "$D" --referenced-by "$TMP/no-such-file" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "is not a readable file" && ok "--referenced-by a missing file: refuses, and says why" || no "--referenced-by a missing file: rc $rc -- $out"
out="$(bash "$TOOL" --dist "$D" --referenced-by "" 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "empty path" && ok "--referenced-by \"\": refuses (an empty variable in a caller protects nothing)" || no "--referenced-by \"\": rc $rc -- $out"

# =============================================================================
# Review round 1 (challenge-loop): each arm below failed OPEN before its fix.
# =============================================================================
# copy_fixture_into <src-dist> <dst-dist>: the fixture triples and invariants, but
# not latest.json (a clone already carries the committed pointer).
copy_fixture_into(){ ( cd "$1" && for f in *; do [ "$f" = latest.json ] || cp "$f" "$2/"; done ); }

# --- History 5: a SHALLOW clone of the site repo fails closed -----------------
S="$TMP/h5site"; D="$S/dist"; make_fixture "$D" 0.6.17 $(ten)
git init -q "$S"
for v in 0.6.10 0.6.11 0.6.12 0.6.13 0.6.17; do serve "$D" "$v"; done
C="$TMP/h5shallow"; git clone -q --depth 1 "file://$S" "$C" 2>/dev/null; copy_fixture_into "$D" "$C/dist"
[ "$(git -C "$C" rev-parse --is-shallow-repository)" = "true" ] && ok "shallow: fixture really is shallow" || no "shallow: fixture is not shallow, the arm proves nothing"
before="$(count_files "$C/dist")"
out="$(bash "$TOOL" --dist "$C/dist" --keep 0 --prod-history 3 --copy-base "file://$MIRROR" --prune --yes 2>&1)"
[ "$before" = "$(count_files "$C/dist")" ] && ok "shallow: nothing pruned (history is incomplete, not empty)" || no "shallow: PRUNED from a shallow history -- $out"
echo "$out" | grep -q "cannot be read from latest.json's git history" && ok "shallow: says why" || no "shallow: silent -- $out"
# Control: a FULL clone at its upstream prunes normally and keeps the prior 3.
F="$TMP/h5full"; git clone -q "file://$S" "$F" 2>/dev/null; copy_fixture_into "$D" "$F/dist"
bash "$TOOL" --dist "$F/dist" --keep 0 --prod-history 3 --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
{ present "$F/dist" kosmos-0.6.11-arm64.tar.gz && absent "$F/dist" kosmos-0.6.10-arm64.tar.gz && absent "$F/dist" kosmos-0.6.08-arm64.tar.gz; } \
  && ok "full clone (control): prior 3 kept, the rest pruned" || no "full clone (control): wrong result"

# --- History 6: a checkout BEHIND its upstream fails closed -------------------
B="$TMP/h6behind"; git clone -q "file://$S" "$B" 2>/dev/null; copy_fixture_into "$D" "$B/dist"
git -C "$B" reset -q --hard HEAD~2; copy_fixture_into "$D" "$B/dist"
before="$(count_files "$B/dist")"
out="$(bash "$TOOL" --dist "$B/dist" --keep 0 --prod-history 3 --copy-base "file://$MIRROR" --prune --yes 2>&1)"
[ "$before" = "$(count_files "$B/dist")" ] && ok "behind upstream: nothing pruned" || no "behind upstream: PRUNED from a stale history -- $out"

# --- History 7: a prior pointer with version-format skew protects its artifact -
S="$TMP/h7site"; D="$S/dist"; make_fixture "$D" 0.6.17 $(ten)
git init -q "$S"
printf '{"version":"0.6.9","sha256":"x","artifact":"kosmos-0.6.09-arm64.tar.gz"}\n' > "$D/latest.json"
gitc "$D" add latest.json >/dev/null && gitc "$D" commit -q -m "promote 0.6.9" -- latest.json
serve "$D" 0.6.17
bash "$TOOL" --dist "$D" --keep 0 --prod-history 1 --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.09-arm64.tar.gz && ok "history skew: prior \"0.6.9\" protects kosmos-0.6.09 by its artifact name" || no "history skew: prior served build PRUNED"
absent "$D" kosmos-0.6.10-arm64.tar.gz && ok "history skew: an unserved version is still pruned (control)" || no "history skew: over-kept"

# --- Gate 7: spellings that reach this dist or the site are refused ----------
D="$TMP/g7"; make_fixture "$D" 0.6.17 $(ten); before="$(count_files "$D")"
enc="$(dirname "$D")/%67%37"   # %67%37 decodes to g7: the dist itself
for base in "file://$enc" https://u@installkosmos.com/dist https://installkosmos.com./dist 'https://installkosmos.com%2e/x' https://CHAOSKOSMOS.COM../dist https://kosmos-site-abc123.vercel.app/dist https://KOSMOS.VERCEL.APP./dist; do
  out="$(bash "$TOOL" --dist "$D" --keep 2 --prod-history 0 --copy-base "$base" --prune --yes 2>&1)"; rc=$?
  [ "$rc" -eq 1 ] && ok "gate base refused: $base" || no "gate base ACCEPTED (exit $rc): $base -- $out"
done
[ "$before" = "$(count_files "$D")" ] && ok "gate base: nothing deleted by an encoded or disguised base" || no "gate base: files deleted"

# --- Gate 8: a base of LINKS to this dist's files is not a second copy -------
for kind in sym hard; do
  D="$TMP/g8$kind"; make_fixture "$D" 0.6.17 $(ten); L="$TMP/g8$kind-links"; mkdir -p "$L"
  for f in "$D"/kosmos-0.6.*; do
    if [ "$kind" = sym ]; then ln -s "$f" "$L/$(basename "$f")"; else ln "$f" "$L/$(basename "$f")"; fi
  done
  before="$(count_files "$D")"
  out="$(bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$L" --prune --yes 2>&1)"
  [ "$before" = "$(count_files "$D")" ] && ok "gate ${kind}links: nothing pruned" || no "gate ${kind}links: PRUNED against links to itself -- $out"
  echo "$out" | grep -q "is the same file as the local one" && ok "gate ${kind}links: says why" || no "gate ${kind}links: no reason -- $out"
done

# --- Gate 9: "pruned" in --json is true only when something was deleted -------
D="$TMP/g9"; make_fixture "$D" 0.6.17 $(ten); mkdir -p "$TMP/g9-empty"
js="$(bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$TMP/g9-empty" --prune --yes --json 2>&1)"
echo "$js" | grep -q '"pruned":false' && ok "json: pruned false when the gate refused everything" || no "json: pruned claims a deletion that did not happen -- $js"
D="$TMP/g9b"; make_fixture "$D" 0.6.17 $(ten)
js="$(bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$MIRROR" --prune --yes --json 2>&1)"
echo "$js" | grep -q '"pruned":true' && ok "json: pruned true when versions were deleted (control)" || no "json control: -- $js"

# --- Gate 10: a copy base that REDIRECTS is not followed (real https, local) ---
# The server answers /ok/<name> with the mirror's bytes and /redir/<name> with a
# 302 to /ok/<name>. Following the redirect would prove the copy; the tool must
# refuse it. The /ok base is the control that the harness can say yes at all.
if command -v openssl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  TLS="$TMP/tls"; mkdir -p "$TLS"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TLS/k.pem" -out "$TLS/c.pem" -days 1 \
    -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 >/dev/null 2>&1
  cat > "$TLS/srv.py" <<'PYEOF'
import http.server, ssl, sys, os
root = sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        kind, _, name = self.path.lstrip('/').partition('/')
        if kind == 'redir':
            self.send_response(302); self.send_header('Location', '/ok/' + name); self.end_headers(); return
        p = os.path.join(root, os.path.basename(name))
        if kind != 'ok' or not os.path.isfile(p):
            self.send_response(404); self.end_headers(); return
        b = open(p, 'rb').read()
        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
s = http.server.HTTPServer(('127.0.0.1', 0), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(sys.argv[1], sys.argv[2])
s.socket = ctx.wrap_socket(s.socket, server_side=True)
print(s.server_address[1], flush=True); s.serve_forever()
PYEOF
  python3 "$TLS/srv.py" "$TLS/c.pem" "$TLS/k.pem" "$MIRROR" > "$TLS/port" 2> "$TLS/srv.err" & SRV=$!
  # Up to 30s: a cold python on a loaded CI runner took longer than the first 5s allowed.
  for _ in $(seq 1 60); do [ -s "$TLS/port" ] && break; kill -0 "$SRV" 2>/dev/null || break; sleep 0.5; done
  PORT="$(cat "$TLS/port" 2>/dev/null)"
  if [ -n "$PORT" ]; then
    D="$TMP/g10"; make_fixture "$D" 0.6.17 $(ten); before="$(count_files "$D")"
    out="$(CURL_CA_BUNDLE="$TLS/c.pem" bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "https://127.0.0.1:$PORT/redir" --prune --yes 2>&1)"
    [ "$before" = "$(count_files "$D")" ] && ok "gate redirect: a 302 to a matching copy is NOT followed, nothing pruned" || no "gate redirect: followed a redirect and pruned -- $out"
    D="$TMP/g10ok"; make_fixture "$D" 0.6.17 $(ten)
    out="$(CURL_CA_BUNDLE="$TLS/c.pem" bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "https://127.0.0.1:$PORT/ok" --prune --yes 2>&1)"
    { absent "$D" kosmos-0.6.08-arm64.tar.gz && absent "$D" kosmos-0.6.09-arm64.manifest.json; } \
      && ok "gate redirect (control): the same copy served directly over https is proven and pruned" || no "gate redirect control: https harness cannot prove a copy -- $out"
  else
    no "gate redirect: the local https server did not start -- $( [ -s "$TLS/c.pem" ] && echo 'cert made' || echo 'NO cert (openssl failed)' ); server stderr: $(tr '\n' ' ' < "$TLS/srv.err" 2>/dev/null | cut -c1-400)"
  fi
  kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
else
  no "gate redirect: needs openssl and python3 to run (not skipped silently)"
fi

# --- Gate 11: the gate refuses for the WINDOWS family too --------------------
D="$TMP/g11"; make_fixture "$D" 0.6.15 0.6.15
add_win "$D" 0.6.24 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22 0.6.23 0.6.24
M="$TMP/g11-mirror"; mkdir -p "$M"; cp "$MIRROR"/kosmos-0.6.1[89]-win-x64.* "$M/"
printf 'tampered\n' > "$M/kosmos-0.6.18-win-x64.zip"
out="$(bash "$TOOL" --dist "$D" --keep 5 --prod-history 0 --copy-base "file://$M" --prune --yes 2>&1)"
{ present "$D" kosmos-0.6.18-win-x64.zip && present "$D" kosmos-0.6.18-win-x64.zip.sha256 && present "$D" kosmos-0.6.18-win-x64.manifest.json; } \
  && ok "win gate: a win zip whose copy DIFFERS is kept, whole triple" || no "win gate: deleted a win version whose copy differs -- $out"
absent "$D" kosmos-0.6.19-win-x64.zip && ok "win gate (control): an exactly-copied win version is pruned" || no "win gate control: -- $out"

# --- Gate 12: a promote DURING the copy gate stops the deletion ---------------
# A curl shim repoints latest.json at a prune candidate the first time the gate
# fetches, standing in for a promote that lands while slow downloads run.
REAL_CURL="$(command -v curl)"; SHIM="$TMP/g12shim"; mkdir -p "$SHIM"
D="$TMP/g12"; make_fixture "$D" 0.6.17 $(ten)
cat > "$SHIM/curl" <<SHEOF
#!/bin/bash
if [ ! -e "$SHIM/fired" ]; then : > "$SHIM/fired"
  printf '{"version":"0.6.08","artifact":"kosmos-0.6.08-arm64.tar.gz"}\\n' > "$D/latest.json"; fi
exec "$REAL_CURL" "\$@"
SHEOF
chmod +x "$SHIM/curl"
out="$(PATH="$SHIM:$PATH" bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$MIRROR" --prune --yes 2>&1)"; rc=$?
[ -e "$SHIM/fired" ] && ok "promote race: the shim fired (the arm exercised the race)" || no "promote race: shim never ran, arm proves nothing"
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.09-arm64.tar.gz; } && ok "promote race: nothing deleted after the pointer moved" || no "promote race: DELETED what the new pointer serves -- $out"
[ "$rc" -ne 0 ] && echo "$out" | grep -q "changed while the copies were being checked" && ok "promote race: exits non-zero and says why" || no "promote race: rc $rc -- $out"

# --- Gate 13: the same-file refusal holds where stat is GNU ------------------
# A stub that behaves like GNU stat: -f is --file-system (report + exit 1), -c works.
GS="$TMP/g13gnu"; mkdir -p "$GS"
cat > "$GS/stat" <<'SHEOF'
#!/bin/bash
f=""; fmt=""; mode=""
while [ $# -gt 0 ]; do case "$1" in
  -L) shift ;; -f) mode=f; shift ;; -c) mode=c; fmt="$2"; shift 2 ;; -c*) mode=c; fmt="${1#-c}"; shift ;;
  *) f="$1"; shift ;; esac; done
if [ "$mode" = f ]; then printf '  File: "%s"\n    ID: 0 Namelen: 255\n' "$f"; echo "stat: cannot read file system information for '%d:%i'" >&2; exit 1; fi
python3 - "$fmt" "$f" <<'PYEOF'
import os, sys
st = os.stat(sys.argv[2])
print(sys.argv[1].replace('%d', str(st.st_dev)).replace('%i', str(st.st_ino)).replace('%s', str(st.st_size)))
PYEOF
SHEOF
chmod +x "$GS/stat"
D="$TMP/g13"; make_fixture "$D" 0.6.17 $(ten); L="$TMP/g13-links"; mkdir -p "$L"
for f in "$D"/kosmos-0.6.*; do ln -s "$f" "$L/$(basename "$f")"; done
before="$(count_files "$D")"
out="$(PATH="$GS:$PATH" bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$L" --prune --yes 2>&1)"
[ "$before" = "$(count_files "$D")" ] && ok "gnu stat: links to itself still refused, nothing pruned" || no "gnu stat: PRUNED against links to itself -- $out"
D="$TMP/g13ctl"; make_fixture "$D" 0.6.17 $(ten)
PATH="$GS:$PATH" bash "$TOOL" --dist "$D" --keep 8 --prod-history 0 --copy-base "file://$MIRROR" --prune --yes >/dev/null 2>&1
absent "$D" kosmos-0.6.08-arm64.tar.gz && ok "gnu stat (control): a real copy is still proven and pruned" || no "gnu stat control: the stub broke the real path"

echo "----"
echo "test-dist-retention: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
