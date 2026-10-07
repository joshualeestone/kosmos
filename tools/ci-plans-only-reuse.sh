#!/usr/bin/env bash
# #5488: may this pull_request run reuse an earlier green verdict instead of taking three macOS runners?
#
# Usage: tools/ci-plans-only-reuse.sh <head-sha> <head-branch>
# Prints the database id of the run whose verdict can be reused, on stdout, or nothing.
# Says why on stderr. Always exits 0: any doubt prints nothing, and nothing means "run the suite".
#
# Reusable only when ALL of these hold:
#   - a successful `test.yml` pull_request run exists for this branch at another sha, whose suite jobs
#     RAN and passed (not itself a reuse: that would chain past the age cap), created at most
#     KOSMOS_REUSE_MAX_AGE_S seconds ago (default 21600, six hours);
#   - that sha is still in this clone (a force-push can drop it: then there is nothing to diff);
#   - every path changed since that sha, BOTH sides of a rename (--no-renames), is a plain Markdown
#     file directly under .claude/plans/ with a name of letters, digits, '.', '_' and '-' only, and a
#     plain-file mode on both sides (no symlink, no executable bit);
#   - none of them is a goldencard-2519 plan, which render-talk-goldencard-2519.test.js reads.
#
# Why that narrow (measured on #5488, every test that walks tracked files or names a plan):
#   - no-brand-refs-1881, no-name-refs-3071 and the launchagent leak guard exclude .claude/plans/;
#   - fixture-discipline.test.js checks every tracked PATH for segments like `undefined` or `foo:`
#     (a plain-named .md file cannot be one), and tools.no-phone-home-4253.test.js reads every
#     tracked `*.test.js` (a .md file cannot be one);
#   - docs/ is NOT safe: both scans read it on purpose.
#
# Why "the newest green run", not "the previous run": a red or cancelled run says nothing about the
# code, so only a green one can be reused, and the diff from it must be plans-only.
#
# Weakest premise: a pull_request run tests the merge of the head into main AS IT WAS. Reusing it
# skips re-testing this head against a main that has moved since; the age cap bounds how far. The
# window is not new: a PR already merges with main moved since its last run. The push run on main
# after the merge tests the merged tree either way.

set -u
HEAD_SHA="${1:-}"; BRANCH="${2:-}"
MAX_AGE="${KOSMOS_REUSE_MAX_AGE_S:-21600}"
say() { printf 'ci-plans-only-reuse: %s\n' "$*" >&2; }

if [ -z "$HEAD_SHA" ] || [ -z "$BRANCH" ]; then say "no head sha or branch given: run the suite"; exit 0; fi
case "$MAX_AGE" in ''|*[!0-9]*) say "KOSMOS_REUSE_MAX_AGE_S is not a number: run the suite"; exit 0 ;; esac

runs="$(gh run list --workflow test.yml --branch "$BRANCH" --event pull_request --status success \
  --limit 20 --json databaseId,headSha,createdAt \
  --jq '.[] | "\(.databaseId) \(.headSha) \((now - (.createdAt | fromdateiso8601)) | floor)"' 2>/dev/null)"
if [ -z "$runs" ]; then say "no earlier green run for this branch: run the suite"; exit 0; fi

# Only a run whose suite jobs RAN and passed is a source. A run that itself reused a verdict also
# concludes success with a fresh createdAt, so accepting it would chain reuses past the age cap forever.
suite_ran() { # <run id>: 0 only if it has suite jobs and every one concluded success
  local c
  c="$(gh run view "$1" --json jobs --jq '.jobs[] | select(.name | startswith("suite (")) | .conclusion' 2>/dev/null)" || return 1
  [ -n "$c" ] || return 1
  ! printf '%s\n' "$c" | grep -qv '^success$'
}
prev_id=""; prev_sha=""; prev_age=""
while read -r id sha age; do
  [ -n "$id" ] || continue
  [ "$sha" != "$HEAD_SHA" ] || continue
  if suite_ran "$id"; then prev_id="$id"; prev_sha="$sha"; prev_age="$age"; break; fi
  say "green run $id did not run the suite itself (a reuse, or unreadable): looking further back"
done <<EOF
$runs
EOF
if [ -z "$prev_id" ]; then say "no green run at another sha whose suite ran: run the suite"; exit 0; fi
case "$prev_id$prev_age" in *[!0-9]*) say "unexpected run listing ($prev_id, age $prev_age): run the suite"; exit 0 ;; esac
if [ "$prev_age" -gt "$MAX_AGE" ]; then
  say "the newest green run $prev_id is ${prev_age}s old (over ${MAX_AGE}s; main may have moved far): run the suite"; exit 0
fi

if ! git cat-file -e "${prev_sha}^{commit}" 2>/dev/null; then
  say "the green run's sha $prev_sha is not in this clone (force-pushed away?): run the suite"; exit 0
fi
if ! changed="$(git diff --no-renames --raw "$prev_sha" "$HEAD_SHA" 2>/dev/null)"; then
  say "could not diff $prev_sha..$HEAD_SHA: run the suite"; exit 0
fi
if [ -z "$changed" ]; then say "nothing changed since run $prev_id: run the suite (a re-run is deliberate)"; exit 0; fi

TAB="$(printf '\t')"
while IFS= read -r line; do
  # --raw: ":<old mode> <new mode> <old blob> <new blob> <status>\t<path>". Both modes must be a plain
  # file (100644) or absent (000000): a symlink or an executable bit is not "a plan".
  f="${line#*$TAB}"; meta="${line%%$TAB*}"; meta="${meta#:}"
  om="${meta%% *}"; rest="${meta#* }"; nm="${rest%% *}"
  case "$om:$nm" in
    100644:100644|000000:100644|100644:000000) ;;
    *) say "$f changed mode ($om to $nm): run the suite"; exit 0 ;;
  esac
  case "$f" in
    .claude/plans/goldencard-2519-*) say "$f is read by render-talk-goldencard-2519.test.js: run the suite"; exit 0 ;;
  esac
  name="${f#.claude/plans/}"
  if [ "$name" = "$f" ] || [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.md$ ]]; then
    say "$f changed since run $prev_id (at $prev_sha) and is not a plain plan file: run the suite"; exit 0
  fi
done <<EOF
$changed
EOF

say "only plan files changed since green run $prev_id (at $prev_sha, ${prev_age}s old): reusing its verdict"
printf '%s\n' "$prev_id"
