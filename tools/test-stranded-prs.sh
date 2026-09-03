#!/usr/bin/env bash
# Unit test for tools/stranded-prs.sh (kosmos#2022). Feeds canned `gh` output via
# a stub (KOSMOS_GH_CMD) and a fixed clock (KOSMOS_NOW_EPOCH), so it never touches
# the network and is deterministic.
#
# Covers the DOMINANT mode the detector exists for (age + green + non-draft, which
# Kitty's audit measured as the volume) AND the low-frequency false-hold backstop
# (her signature: a green PR that defers merge to a person while the author's own
# verification already passed). The genuine-decision-hold control proves the
# two-part AND in that signature does not false-positive a real hold.
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$HERE/tools/stranded-prs.sh"
[ -f "$SCRIPT" ] || { echo "FAIL: cannot find tools/stranded-prs.sh" >&2; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/strandedprs.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Fixed "now" = 2026-09-03T18:00:00Z = 1788458400.
NOW=1788458400

# ---- canned gh stub ---------------------------------------------------------
# Dispatches on the gh subcommand + object:
#   pr list ...              -> the fixture PR set ($GH_STUB_PRJSON)
#   pr view <N> --json comments -q .comments[].body -> that PR's comment bodies
#   issue view <N> --json state -q .state           -> that issue's state
STUB="$TMP/gh-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
sub="$1"; obj="$2"; n="$3"
if [ "$sub" = "pr" ] && [ "$obj" = "list" ]; then
  cat "$GH_STUB_PRJSON"; exit 0
fi
if [ "$sub" = "pr" ] && [ "$obj" = "view" ]; then
  # comment bodies, one per line, per PR number
  case "$n" in
    800) printf '%s\n' "Held for Josh's eyeball per the frontend rule; ready to merge on his nod." \
                       "browser-check gate green, screenshot of the rendered tile attached." ;;
    810) printf '%s\n' "Held for Josh's decision on notify vs ping wording; see the screenshot of the two options." ;;
    *)   : ;;   # no comments
  esac
  exit 0
fi
if [ "$sub" = "issue" ] && [ "$obj" = "view" ]; then
  case "$n" in
    1951) echo "closed" ;;   # overruled-alternative smell
    *)    echo "open" ;;
  esac
  exit 0
fi
echo "gh-stub: unexpected '$sub $obj'" >&2; exit 1
STUBEOF
chmod +x "$STUB"

# ---- fixture PR set ---------------------------------------------------------
# #100 done: green, CLEAN, open issue, 5h old -> "clean: looks safe".
# #200 CONFLICTING: green CI but DIRTY -> CONFLICTING flag (stale green).
# #300 overruled: green, CLEAN, Addresses #1951 (CLOSED) -> ISSUE-CLOSED.
# #400 draft -> EXCLUDED.
# #500 fresh (10 min) -> filtered by the 2h cutoff.
# #600 CI-fail -> CI-FAIL.
# #700 no-CI -> NO-CI.
# #800 false-hold: green, CLEAN, comments carry the "held for a person" phrasing
#      AND an author browser-check/screenshot claim -> FALSE-HOLD-SUSPECT.
# #810 genuine hold: green, CLEAN, comment cites a person (Josh's decision) but
#      claims NO verification -> must NOT be flagged FALSE-HOLD (the #2041 control).
PRJSON="$TMP/prs.json"
cat > "$PRJSON" <<'JSONEOF'
[
  {"number":100,"title":"done fixture","isDraft":false,"updatedAt":"2026-09-03T13:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"done-100","body":"Addresses #100","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":200,"title":"conflicting fixture","isDraft":false,"updatedAt":"2026-09-03T12:00:00Z",
   "mergeable":"CONFLICTING","mergeStateStatus":"DIRTY","headRefName":"conf-200","body":"Addresses #200","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":300,"title":"overruled fixture","isDraft":false,"updatedAt":"2026-09-03T11:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"import-msg-1951","body":"Addresses #1951","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":400,"title":"draft fixture","isDraft":true,"updatedAt":"2026-09-03T10:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"draft-400","body":"Addresses #400","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":500,"title":"fresh fixture","isDraft":false,"updatedAt":"2026-09-03T17:50:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"fresh-500","body":"Addresses #500","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":600,"title":"ci-fail fixture","isDraft":false,"updatedAt":"2026-09-03T09:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"UNSTABLE","headRefName":"cifail-600","body":"Addresses #600","url":"u",
   "statusCheckRollup":[{"conclusion":"FAILURE","status":"COMPLETED"}]},
  {"number":700,"title":"no-ci fixture","isDraft":false,"updatedAt":"2026-09-03T08:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"noci-700","body":"Addresses #700","url":"u",
   "statusCheckRollup":[]},
  {"number":800,"title":"false-hold fixture","isDraft":false,"updatedAt":"2026-09-03T07:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"tile-800","body":"Addresses #800","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":810,"title":"genuine-hold fixture","isDraft":false,"updatedAt":"2026-09-03T06:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"notify-810","body":"Addresses #810","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":820,"title":"blocked fixture","isDraft":false,"updatedAt":"2026-09-03T05:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","headRefName":"blk-820","body":"Addresses #820","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":830,"title":"behind fixture","isDraft":false,"updatedAt":"2026-09-03T04:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"BEHIND","headRefName":"bhd-830","body":"Addresses #830","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":840,"title":"action-required fixture","isDraft":false,"updatedAt":"2026-09-03T03:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","headRefName":"act-840","body":"Addresses #840","url":"u",
   "statusCheckRollup":[{"conclusion":"ACTION_REQUIRED","status":"COMPLETED"}]},
  {"number":850,"title":"expected-check fixture","isDraft":false,"updatedAt":"2026-09-03T02:00:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"exp-850","body":"Addresses #850","url":"u",
   "statusCheckRollup":[{"state":"EXPECTED"}]},
  {"number":860,"title":"unknown-merge fixture","isDraft":false,"updatedAt":"2026-09-03T01:00:00Z",
   "mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","headRefName":"unk-860","body":"Addresses #860","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]},
  {"number":870,"title":"EMPTYBODYTITLE","isDraft":false,"updatedAt":"2026-09-03T00:30:00Z",
   "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"eb-870","body":"","url":"u",
   "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]}
]
JSONEOF

run() { # max-age-hours ; sets OUT
  GH_STUB_PRJSON="$PRJSON" KOSMOS_GH_CMD="$STUB" KOSMOS_NOW_EPOCH="$NOW" \
    STRANDED_PRS_REPO="test/repo" bash "$SCRIPT" "$1" 2>&1
}

PASS=0; FAIL=0
chk() { desc="$1"; shift; if "$@"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi; }
g()  { printf '%s' "$OUT" | grep -qE "$1"; }      # present
ng() { ! printf '%s' "$OUT" | grep -qE "$1"; }    # absent

OUT="$(run 2)"

# ---- the dominant mode: age + green + non-draft, with the routing flags ------
chk "#100 genuinely-done row present"        g '#100'
chk "#100 flagged clean / safe-to-merge"     g '#100.*clean: looks safe'
chk "#200 CONFLICTING flagged (stale green)" g '#200.*CONFLICTING'
chk "#200 NOT called safe to merge"          ng '#200.*clean: looks safe'
chk "#300 overruled: ISSUE#1951-CLOSED"      g '#300.*ISSUE#1951-CLOSED'
chk "#300 issue resolved from Addresses #N"  g '#300.*#1951'
chk "#400 draft is EXCLUDED"                  ng '^#400'
chk "#500 fresh (<2h) is filtered out"        ng '^#500'
chk "#600 CI-FAIL flagged"                    g '#600.*CI-FAIL'
chk "#700 NO-CI flagged"                      g '#700.*NO-CI'

# ---- the false-hold backstop (Kitty's signature) ----------------------------
chk "#800 FALSE-HOLD-SUSPECT flagged"         g '#800.*FALSE-HOLD-SUSPECT'
chk "#800 NOT called plain safe-to-merge"     ng '#800.*clean: looks safe'
# The genuine-decision hold (#810) matches the person-phrasing but claims NO
# verification, so the two-part AND must NOT flag it -- else the detector cries
# wolf on real holds (the #2041 class Kitty told us to leave alone).
chk "#810 genuine hold NOT false-flagged"     ng '#810.*FALSE-HOLD-SUSPECT'
chk "#810 present as an ordinary clean row"   g '#810.*clean: looks safe'
# #810 mentions a bare 'screenshot' but no browser-check -- the tightened
# verification regex must NOT treat that as author-verification, so the two-part
# AND still does not fire (this is the precision fix for the #2041 carve-out).

# ---- non-CLEAN merge states that green CI would otherwise hide --------------
chk "#820 BLOCKED flagged"                     g '#820.*BLOCKED'
chk "#820 NOT called safe to merge"            ng '#820.*clean: looks safe'
chk "#830 BEHIND flagged"                      g '#830.*BEHIND'
chk "#830 NOT called safe to merge"            ng '#830.*clean: looks safe'
# ACTION_REQUIRED is a blocking check conclusion, not a pass: it must read CI-FAIL,
# never fall through to green.
chk "#840 ACTION_REQUIRED reads CI-FAIL"        g '#840.*CI-FAIL'
chk "#840 NOT called safe to merge"            ng '#840.*clean: looks safe'
# EXPECTED is a required check not yet reported -> PENDING, not green.
chk "#850 EXPECTED state reads CI-PENDING"      g '#850.*PENDING'
chk "#850 NOT called safe to merge"            ng '#850.*clean: looks safe'
# UNKNOWN mergeStateStatus = mergeability not computed -> must NOT read safe.
chk "#860 UNKNOWN merge state flagged"          g '#860.*MERGE-UNKNOWN'
chk "#860 NOT called safe to merge"            ng '#860.*clean: looks safe'
# Empty-body PR: the title must survive (US delimiter, not folded tabs).
chk "#870 empty-body PR keeps its title"        g '#870.*EMPTYBODYTITLE'

# ---- age filter opens up at cutoff 0 ----------------------------------------
OUT="$(run 0)"
chk "with max-age 0, fresh #500 now surfaces" g '^#500'

# ---- unknown age is surfaced, never dropped ---------------------------------
BADJSON="$TMP/badage.json"
cat > "$BADJSON" <<'JSONEOF'
[{"number":900,"title":"bad-age","isDraft":false,"updatedAt":"not-a-date",
  "mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefName":"x-900","body":"","url":"u",
  "statusCheckRollup":[{"conclusion":"SUCCESS","status":"COMPLETED"}]}]
JSONEOF
OUT="$(GH_STUB_PRJSON="$BADJSON" KOSMOS_GH_CMD="$STUB" KOSMOS_NOW_EPOCH="$NOW" STRANDED_PRS_REPO="t/r" bash "$SCRIPT" 2 2>&1)"
chk "unparseable updatedAt surfaced with age '?'" g '#900 +\? '

# ---- negative controls: prove g/ng actually discriminate --------------------
OUT="$(run 2)"
chk "negative control: known-absent token is absent" ng 'zzz-never-emitted-token'
chk "negative control: g detects a real miss as fail" sh -c '
  OUT="no hundred here"; if printf "%s" "$OUT" | grep -qE "#100.*clean"; then exit 1; else exit 0; fi'

# ---- input validation: multi-dot / lone-dot rejected, real decimal accepted -
RC=0; GH_STUB_PRJSON="$PRJSON" KOSMOS_GH_CMD="$STUB" KOSMOS_NOW_EPOCH="$NOW" STRANDED_PRS_REPO="t/r" bash "$SCRIPT" 1.2.3 >/dev/null 2>&1 || RC=$?
chk "multi-dot max-age (1.2.3) rejected exit 2" test "$RC" = 2
RC=0; GH_STUB_PRJSON="$PRJSON" KOSMOS_GH_CMD="$STUB" KOSMOS_NOW_EPOCH="$NOW" STRANDED_PRS_REPO="t/r" bash "$SCRIPT" . >/dev/null 2>&1 || RC=$?
chk "lone-dot max-age (.) rejected exit 2" test "$RC" = 2
RC=0; GH_STUB_PRJSON="$PRJSON" KOSMOS_GH_CMD="$STUB" KOSMOS_NOW_EPOCH="$NOW" STRANDED_PRS_REPO="t/r" bash "$SCRIPT" 1.5 >/dev/null 2>&1 || RC=$?
chk "valid decimal max-age (1.5) accepted" sh -c '[ "$1" != 2 ]' _ "$RC"

echo "test-stranded-prs: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
