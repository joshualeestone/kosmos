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

# Build a fixture dist dir: $1=dir, $2=served version, rest=versions to create.
make_fixture(){
  local dir="$1" served="$2"; shift 2
  mkdir -p "$dir"
  local v
  for v in "$@"; do
    printf 'tar-%s\n' "$v"    > "$dir/kosmos-${v}-arm64.tar.gz"
    printf 'sha-%s\n' "$v"    > "$dir/kosmos-${v}-arm64.tar.gz.sha256"
    printf '{"version":"%s"}\n' "$v" > "$dir/kosmos-${v}-arm64.manifest.json"
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

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# --- Arm 1: dry run deletes nothing ------------------------------------------
D="$TMP/a1"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
before="$(count_files "$D")"
out="$(bash "$TOOL" --dist "$D" --keep 12 2>&1)"; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "dry run: exit 0" || no "dry run: exit $rc"
[ "$before" = "$after" ] && ok "dry run: deleted nothing ($before files)" || no "dry run: file count changed $before -> $after"
echo "$out" | grep -q "prune candidates:.*3 version" && ok "dry run: reports 3 prune candidates" || no "dry run: wrong prune count -- $out"

# --- Arm 2: --prune without --yes refuses ------------------------------------
D="$TMP/a2"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
before="$(count_files "$D")"
bash "$TOOL" --dist "$D" --keep 12 --prune >/dev/null 2>&1; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 2 ] && ok "prune w/o --yes: refuses (exit 2)" || no "prune w/o --yes: exit $rc (want 2)"
[ "$before" = "$after" ] && ok "prune w/o --yes: deleted nothing" || no "prune w/o --yes: file count changed"

# --- Arm 3: --prune --yes, served in-window ----------------------------------
D="$TMP/a3"; make_fixture "$D" 0.6.15 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1; rc=$?
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
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
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
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
present "$D" kosmos-0.6.08-arm64.tar.gz \
  && ok "nested-version parse: served 0.6.08 protected (first-match, not 9.9.9)" \
  || no "nested-version parse: served release was PRUNED -- greedy parse bug"

# --- Arm 5: keep >= number of versions prunes nothing ------------------------
D="$TMP/a5"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
before="$(count_files "$D")"
bash "$TOOL" --dist "$D" --keep 20 --prune --yes >/dev/null 2>&1
after="$(count_files "$D")"
[ "$before" = "$after" ] && ok "keep>=count: deleted nothing" || no "keep>=count: deleted something ($before -> $after)"

# --- Arm 6: unrecognised stray + alias never touched -------------------------
D="$TMP/a6"; make_fixture "$D" 0.6.22 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
printf 'stray\n' > "$D/random-stray.txt"
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
present "$D" random-stray.txt && ok "unrecognised stray: never deleted" || no "unrecognised stray: deleted!"
present "$D" kosmos-arm64.tar.gz && ok "alias kosmos-arm64.tar.gz: never treated as a versioned triple" || no "alias: deleted!"

# --- Arm 7: version sort is numeric, not lexical -----------------------------
# versions 0.6.9, 0.6.10, 0.6.11; served 0.6.11; keep 2. Numeric-correct: keep
# {0.6.10,0.6.11}, prune 0.6.9. Lexical-wrong ("0.6.9">"0.6.11"): would keep 0.6.9
# and prune 0.6.10. Asserting 0.6.9 pruned AND 0.6.10 kept discriminates the two.
D="$TMP/a7"; make_fixture "$D" 0.6.11 0.6.9 0.6.10 0.6.11
bash "$TOOL" --dist "$D" --keep 2 --prune --yes >/dev/null 2>&1
absent "$D" kosmos-0.6.9-arm64.tar.gz && ok "sort: 0.6.9 pruned (numeric ordering)" || no "sort: 0.6.9 kept -- lexical sort bug"
present "$D" kosmos-0.6.10-arm64.tar.gz && ok "sort: 0.6.10 retained (numeric ordering)" || no "sort: 0.6.10 pruned -- lexical sort bug"

# --- Arm 8b: valid latest.json but ZERO versioned triples --------------------
# The bash-3.2 empty-array-under-set-u case. make_fixture with no version args
# creates the invariants + a latest.json but no triples.
D="$TMP/a8b"; make_fixture "$D" 0.6.30
before="$(count_files "$D")"
out="$(bash "$TOOL" --dist "$D" --keep 12 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "versionless dist: dry run exit 0 (no empty-array crash)" || no "versionless dist: dry run exit $rc -- $out"
echo "$out" | grep -qE "versioned triples found: +0" && ok "versionless dist: reports 0 found" || no "versionless dist: wrong found count -- $out"
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1; rc=$?
after="$(count_files "$D")"
[ "$rc" -eq 0 ] && ok "versionless dist: prune --yes exit 0 (no crash in orphan check)" || no "versionless dist: prune exit $rc"
[ "$before" = "$after" ] && ok "versionless dist: deleted nothing" || no "versionless dist: file count changed"

# --- Arm 8: argument / precondition refusals ---------------------------------
bash "$TOOL" --keep 12 >/dev/null 2>&1; [ $? -ne 0 ] && ok "no --dist: refuses" || no "no --dist: did not refuse"
bash "$TOOL" --dist "$TMP/does-not-exist" >/dev/null 2>&1; [ $? -ne 0 ] && ok "non-dir --dist: refuses" || no "non-dir: did not refuse"
mkdir -p "$TMP/nolatest"; bash "$TOOL" --dist "$TMP/nolatest" >/dev/null 2>&1; [ $? -ne 0 ] && ok "dir without latest.json: refuses" || no "no latest.json: did not refuse"
bash "$TOOL" --dist "$TMP/a5" --keep -3 >/dev/null 2>&1; [ $? -ne 0 ] && ok "negative --keep: refuses" || no "negative --keep: did not refuse"

# --- Arm 9: --keep 0 deletes all but the served version ----------------------
D="$TMP/a9"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
bash "$TOOL" --dist "$D" --keep 0 --prune --yes >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "keep 0: exit 0" || no "keep 0: exit $rc"
{ present "$D" kosmos-0.6.20-arm64.tar.gz && absent "$D" kosmos-0.6.18-arm64.tar.gz && absent "$D" kosmos-0.6.19-arm64.tar.gz; } \
  && ok "keep 0: only the served version survives" || no "keep 0: wrong survivors"
assert_invariants "keep 0" "$D"

# --- Arm 10: --json output is valid JSON naming the served version -----------
D="$TMP/a10"; make_fixture "$D" 0.6.22 0.6.20 0.6.21 0.6.22
js="$(bash "$TOOL" --dist "$D" --keep 2 --json 2>/dev/null)"
if command -v node >/dev/null 2>&1; then
  echo "$js" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);if(o.served_version==="0.6.22"&&Array.isArray(o.prune_versions)&&o.prune_versions.includes("0.6.20"))process.exit(0);process.exit(1)})' \
    && ok "--json: valid JSON, names served + prune list" || no "--json: bad JSON or wrong fields -- $js"
else
  echo "$js" | grep -q '"served_version":"0.6.22"' && ok "--json: names served version" || no "--json: missing served -- $js"
fi

# --- Arm 11: leading-zero --keep is base 10, not octal -----------------------
# --keep 08 must mean keep 8. Under the octal bug the arithmetic errors, the keep
# window empties, and everything but the served version is pruned. Asserting a mid
# version (0.6.12) is KEPT discriminates the bug (which prunes it) from the fix.
D="$TMP/a11"; make_fixture "$D" 0.6.19 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19
bash "$TOOL" --dist "$D" --keep 08 --prune --yes >/dev/null 2>&1; rc=$?
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
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "artifact-name protection: served 0.6.08 kept despite version=\"0.6.5\"" \
  || no "artifact-name protection: served file PRUNED (version-format skew bug)"

# --- Arm 13: latest.json missing the "version" key refuses WITH a diagnostic ---
# Under set -e + pipefail a no-match grep would silently abort; the parse must
# tolerate it so the friendly "names no version" refusal is reached.
D="$TMP/a13"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
printf '{"artifact":"kosmos-0.6.20-arm64.tar.gz"}\n' > "$D/latest.json"
out="$(bash "$TOOL" --dist "$D" --keep 12 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -q "names no version"; } \
  && ok "missing version key: refuses WITH diagnostic (no silent abort)" \
  || no "missing version key: rc=$rc, no diagnostic -- $out"

# --- Arm 14: latest.json missing the "artifact" key still runs ---------------
# The artifact field is optional (belt-and-suspenders); a no-match must not abort.
D="$TMP/a14"; make_fixture "$D" 0.6.20 0.6.18 0.6.19 0.6.20
printf '{"version":"0.6.20"}\n' > "$D/latest.json"
out="$(bash "$TOOL" --dist "$D" --keep 12 2>&1)"; rc=$?
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
bash "$TOOL" --dist "$D" --keep 12 --prune --yes >/dev/null 2>&1
{ present "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.08-arm64.tar.gz.sha256 && present "$D" kosmos-0.6.08-arm64.manifest.json; } \
  && ok "version-only latest.json: served 0.6.08 protected by version-string path" \
  || no "version-only latest.json: served release PRUNED (version-string protection broken)"

# --- Arm 16: a pre-existing malformed dist does not false-trip the backstop ---
# A KEPT version already missing a sidecar BEFORE the run is not the prune's fault.
# The prune should succeed (exit 0, oldest pruned) and NOT report a tool bug.
D="$TMP/a16"; make_fixture "$D" 0.6.22 0.6.08 0.6.09 0.6.10 0.6.11 0.6.12 0.6.13 0.6.14 0.6.15 0.6.16 0.6.17 0.6.18 0.6.19 0.6.20 0.6.21 0.6.22
rm -f "$D/kosmos-0.6.15-arm64.manifest.json"   # kept version, pre-missing a sidecar
out="$(bash "$TOOL" --dist "$D" --keep 12 --prune --yes 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "pre-malformed dist: prune succeeds (exit 0, no false bug report)" || no "pre-malformed dist: exit $rc -- $out"
echo "$out" | grep -q "this is a bug" && no "pre-malformed dist: falsely reported a tool bug" || ok "pre-malformed dist: did not misattribute a pre-existing gap to the prune"
{ absent "$D" kosmos-0.6.08-arm64.tar.gz && present "$D" kosmos-0.6.15-arm64.tar.gz; } \
  && ok "pre-malformed dist: still pruned oldest, kept 0.6.15's remaining files" || no "pre-malformed dist: wrong prune result"

echo "----"
echo "test-dist-retention: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
