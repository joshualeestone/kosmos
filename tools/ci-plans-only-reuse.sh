#!/usr/bin/env bash
# #5488: may this pull_request run reuse an earlier green verdict instead of taking three macOS runners?
#
# Usage: tools/ci-plans-only-reuse.sh <head-sha> <head-branch>
# Prints the database id of the run whose verdict can be reused, on stdout, or nothing.
# Says why on stderr. Always exits 0: any doubt prints nothing, and nothing means "run the suite".
#
# Reusable only when ALL of these hold:
#   - a completed, successful `test.yml` pull_request run exists for this branch at another sha;
#   - that sha is still in this clone (a force-push can drop it: then there is nothing to diff);
#   - every file changed between that sha and <head-sha> is under .claude/plans/;
#   - none of them is a goldencard-2519 plan, which render-talk-goldencard-2519.test.js reads.
#
# Why .claude/plans/ and nothing wider (measured on #5488): the repo-wide scans
# (no-brand-refs-1881, no-name-refs-3071) and the launchagent leak guard exclude .claude/plans/
# by design, and no other test reads a plan in code. docs/ is NOT safe: both scans read it.
#
# Why "the newest green run", not "the previous run": a red or cancelled run says nothing about the
# code, so only a green one can be reused, and the diff from it must be plans-only.
#
# Weakest premise: a pull_request run tests the merge of the head into main AS IT WAS. Reusing it
# skips re-testing this head against a main that has moved since. The push run on main after the
# merge still tests the merged tree, and a PR pushed after a rebase is never plans-only (the rebase
# brings main's changes into the diff), so it always runs.

set -u
HEAD_SHA="${1:-}"; BRANCH="${2:-}"
say() { printf 'ci-plans-only-reuse: %s\n' "$*" >&2; }

if [ -z "$HEAD_SHA" ] || [ -z "$BRANCH" ]; then say "no head sha or branch given: run the suite"; exit 0; fi

runs="$(gh run list --workflow test.yml --branch "$BRANCH" --event pull_request --status success \
  --limit 20 --json databaseId,headSha --jq '.[] | "\(.databaseId) \(.headSha)"' 2>/dev/null)"
if [ -z "$runs" ]; then say "no earlier green run for $BRANCH: run the suite"; exit 0; fi

prev_id=""; prev_sha=""
while read -r id sha; do
  [ -n "$id" ] || continue
  if [ "$sha" != "$HEAD_SHA" ]; then prev_id="$id"; prev_sha="$sha"; break; fi
done <<EOF
$runs
EOF
if [ -z "$prev_id" ]; then say "the only green run is at this same sha: run the suite"; exit 0; fi

if ! git cat-file -e "${prev_sha}^{commit}" 2>/dev/null; then
  say "the green run's sha $prev_sha is not in this clone (force-pushed away?): run the suite"; exit 0
fi
if ! changed="$(git diff --name-only "$prev_sha" "$HEAD_SHA" 2>/dev/null)"; then
  say "could not diff $prev_sha..$HEAD_SHA: run the suite"; exit 0
fi
if [ -z "$changed" ]; then say "nothing changed since run $prev_id: run the suite (a re-run is deliberate)"; exit 0; fi

while IFS= read -r f; do
  case "$f" in
    .claude/plans/goldencard-2519-*) say "$f is read by render-talk-goldencard-2519.test.js: run the suite"; exit 0 ;;
    .claude/plans/*) ;;
    *) say "$f changed since run $prev_id (at $prev_sha): run the suite"; exit 0 ;;
  esac
done <<EOF
$changed
EOF

say "only .claude/plans/ changed since green run $prev_id (at $prev_sha): reusing its verdict"
printf '%s\n' "$prev_id"
