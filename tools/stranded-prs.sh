#!/usr/bin/env bash
# kosmos#2022: list OPEN, non-draft PRs that look merge-ready but may be stranded,
# with the fields a PM needs to route them -- WITHOUT auto-merging.
#
#   bash tools/stranded-prs.sh [max-age-hours]      (default 2)
#
# 🛑 WHY THIS IS A VISIBILITY TOOL, NOT AN AUTO-MERGER. A merge-ready PR with no
# active owner is invisible work: it looks finished from every angle and never
# lands. But "green + unowned" is NOT enough to merge blindly -- two 2026-09-03
# instances proved it:
#   - a CONFLICTING PR whose "green CI" was stale (mergeable != CLEAN) -- needs a
#     rebase owner, not a merge;
#   - an OVERRULED ALTERNATIVE (#1951) that a different, merged PR settled the
#     opposite way -- merging the loser REGRESSES the winner.
# A naive "merge every green unowned PR" lands both as damage. So this SURFACES
# the set to a human, who routes / merges / closes. It never merges.
#
# Read-only: only `gh` reads. No writes, no merges, no `gh pr merge`.
#
# Testable: the gh command and the clock are injectable so a unit test can feed
# canned JSON without touching the network --
#   KOSMOS_GH_CMD   (default: gh)          the gh binary / stub
#   KOSMOS_NOW_EPOCH (default: date +%s)   "now", for the age cutoff
set -uo pipefail

MAX_AGE_HOURS="${1:-2}"
case "$MAX_AGE_HOURS" in
  ''|*[!0-9.]*) echo "stranded-prs: max-age-hours must be a number (got '$MAX_AGE_HOURS')" >&2; exit 2 ;;
esac

GH="${KOSMOS_GH_CMD:-gh}"
REPO="${STRANDED_PRS_REPO:-joshualeestone/kosmos}"
NOW="${KOSMOS_NOW_EPOCH:-$(date +%s)}"

# ISO-8601 (e.g. 2026-09-03T15:49:14Z) -> epoch seconds, portable across BSD and
# GNU date. Empty/unparseable -> empty (caller treats as "age unknown", never as
# "fresh", so an unparseable timestamp does not hide a stranded PR).
iso_to_epoch() {
  _iso="$1"
  [ -n "$_iso" ] || { echo ""; return; }
  # BSD date (macOS) first, then GNU date.
  _e="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$_iso" '+%s' 2>/dev/null)" \
    || _e="$(date -u -d "$_iso" '+%s' 2>/dev/null)" \
    || _e=""
  echo "$_e"
}

# Pull the candidate set in one call. mergeable/mergeStateStatus are distinct
# fields: statusCheckRollup can be all-green while mergeStateStatus is DIRTY
# (conflicting) -- the exact stale-green the card warns about.
PR_JSON="$("$GH" pr list --repo "$REPO" --state open \
  --json number,title,isDraft,updatedAt,mergeable,mergeStateStatus,statusCheckRollup,headRefName,url,body \
  --limit 100 2>/dev/null)" || {
  echo "stranded-prs: could not list PRs from $REPO (is gh authed? is the repo right?)" >&2
  exit 2
}

# Collapse statusCheckRollup to one of PASS / FAIL / PENDING / NONE.
# A check is a CheckRun (has .conclusion + .status) or a StatusContext (.state).
# FAIL if any failure/error; else PENDING if any not-yet-complete; else PASS;
# NONE if there are no checks at all.
CI_JQ='
  def ci:
    (.statusCheckRollup // []) as $c
    | if ($c|length)==0 then "NONE"
      elif any($c[];
             (.conclusion // "" | ascii_upcase) as $x
             | ($x=="FAILURE" or $x=="ERROR" or $x=="CANCELLED" or $x=="TIMED_OUT")
               or ((.state // "" | ascii_upcase)=="FAILURE" or (.state // "" | ascii_upcase)=="ERROR"))
        then "FAIL"
      elif any($c[];
             ((.status // "" | ascii_upcase) as $s | ($s=="QUEUED" or $s=="IN_PROGRESS" or $s=="PENDING" or $s=="WAITING"))
             or ((.state // "" | ascii_upcase)=="PENDING")
             or ((.conclusion // null)==null and (.state // null)==null))
        then "PENDING"
      else "PASS" end;'

# Emit one TSV row per non-draft PR, oldest-eligible fields inline. Age filtering
# and the overruled-smell probe happen in the shell loop below (the smell needs a
# second gh call per PR, which jq cannot make).
ROWS="$(printf '%s' "$PR_JSON" | jq -r "$CI_JQ"'
  .[]
  | select(.isDraft | not)
  | [ (.number|tostring),
      .updatedAt,
      (.mergeable // "UNKNOWN"),
      (.mergeStateStatus // "UNKNOWN"),
      ci,
      .headRefName,
      (.body // ""),
      (.title // "") ]
  | @tsv' 2>/dev/null)" || {
  echo "stranded-prs: could not parse the PR list (jq error)" >&2
  exit 2
}

CUTOFF=$(awk -v now="$NOW" -v h="$MAX_AGE_HOURS" 'BEGIN{printf "%d", now - (h*3600)}')

# Resolve the issue a PR addresses, from the branch name or an "Addresses #N" in
# the body. Returns "" when none is found. Same priority order as create-pr's
# detector: explicit #N wins, then branch trailing/leading -N.
issue_of() {
  _branch="$1"; _body="$2"
  case "$_body" in
    *[Aa]ddresses\ #[0-9]*) printf '%s' "$_body" | sed -n 's/.*[Aa]ddresses #\([0-9][0-9]*\).*/\1/p' | head -1; return ;;
  esac
  case "$_branch" in
    *[!0-9]-[0-9]*) printf '%s' "$_branch" | sed -n 's/.*-\([0-9][0-9]*\)$/\1/p' | head -1; return ;;
    [0-9]*-*) printf '%s' "$_branch" | sed -n 's/^\([0-9][0-9]*\)-.*/\1/p' | head -1; return ;;
  esac
  echo ""
}

printf 'Stranded merge-ready PRs in %s (open, non-draft, idle > %sh)\n' "$REPO" "$MAX_AGE_HOURS"
printf 'This is a VISIBILITY list. Route/merge/close is a human call -- see the flags.\n\n'
printf '%-6s  %-5s  %-9s  %-9s  %-8s  %s\n' "PR" "AGEh" "CI" "MERGE" "ISSUE" "FLAGS / title"
printf '%-6s  %-5s  %-9s  %-9s  %-8s  %s\n' "----" "----" "---" "-----" "-----" "-------------"

COUNT=0
# TSV read; tabs are the only delimiter, so titles/bodies with spaces are safe.
while IFS="$(printf '\t')" read -r num updated mergeable mergestate ci branch body title; do
  [ -n "${num:-}" ] || continue
  upe="$(iso_to_epoch "$updated")"
  # Age filter: skip PRs newer than the cutoff. An unknown (empty) age is NOT
  # skipped -- it is surfaced with age "?" rather than silently dropped.
  if [ -n "$upe" ]; then
    [ "$upe" -le "$CUTOFF" ] || continue
    ageh="$(awk -v now="$NOW" -v u="$upe" 'BEGIN{printf "%.0f", (now-u)/3600}')"
  else
    ageh="?"
  fi

  issue="$(issue_of "$branch" "$body")"
  flags=""
  case "$mergestate" in
    DIRTY|CONFLICTING) flags="${flags}CONFLICTING(needs-rebase) " ;;
  esac
  # Overruled-alternative smell: the PR addresses an issue that is already CLOSED.
  # A closed issue on an open PR means either another PR already settled it (the
  # #1951 shape) or the issue was retired -- either way a human must confirm the
  # approach is still live before merging. One extra gh read per PR that has an
  # issue; failure is non-fatal (smell just not computed).
  istate=""
  if [ -n "$issue" ]; then
    istate="$("$GH" issue view "$issue" --repo "$REPO" --json state -q .state 2>/dev/null | tr 'a-z' 'A-Z')" || istate=""
    case "$istate" in
      CLOSED) flags="${flags}ISSUE#${issue}-CLOSED(overruled?) " ;;
    esac
  fi
  case "$ci" in
    FAIL) flags="${flags}CI-FAIL " ;;
    PENDING) flags="${flags}CI-PENDING " ;;
    NONE) flags="${flags}NO-CI " ;;
  esac
  # Ice Cream Kitty's #2022 signature (from her hold-reason audit): a green,
  # mergeable PR whose comment defers merge to a PERSON *while the author's own
  # verification already passed* is the #1983 class -- an invented approval gate,
  # not a real hold. The two-part AND is load-bearing: matching the "held for
  # Josh" phrasing ALONE would false-positive a genuine product-decision hold
  # (#2041), which cites a person but claims no author verification. Only scan
  # comments on otherwise-clean PRs (fast + scoped). The irreducible half -- does
  # the cited rule actually gate merge -- stays a human read, so this ROUTES to a
  # human, never merges.
  if [ -z "$flags" ] && [ "$ci" = "PASS" ]; then
    _comments="$("$GH" pr view "$num" --repo "$REPO" --json comments -q '.comments[].body' 2>/dev/null || true)"
    if printf '%s' "$_comments" | grep -iqE 'held for josh|eyeball|on his nod|per the .* (frontend )?rule|awaiting josh|wait(ing)? (on|for) (josh|his (nod|approval))' \
       && printf '%s' "$_comments" | grep -iqE 'browser-check|browser check|screenshot|browser.?test|#1720|verified.*(render|tile|page)'; then
      flags="FALSE-HOLD-SUSPECT(author verified but held for a person -- read the cited rule) "
    fi
  fi
  [ -n "$flags" ] || flags="clean: looks safe to merge -- verify owner"

  # Truncate the title so the row stays one line.
  tshort="$(printf '%s' "$title" | cut -c1-48)"
  printf '%-6s  %-5s  %-9s  %-9s  %-8s  %s | %s\n' \
    "#$num" "$ageh" "$ci" "$mergestate" "${issue:+#$issue}" "$flags" "$tshort"
  COUNT=$((COUNT+1))
done <<EOF
$ROWS
EOF

printf '\n%s stranded PR(s). CONFLICTING = needs a rebase owner, not a merge; ISSUE-CLOSED = confirm the approach is still live before merging (an overruled alternative regresses on merge).\n' "$COUNT"
