# kosmos#1381: em dashes on operator-facing output lines (agent-workforce tools/ slice)

## The card
#1381 (split from the closed #1322) records em dashes on non-`#`-comment lines across ~30 fleet
scripts in `~/.claude/bin`, `~/.claude/scripts`, and `tools/`. Its explicit instruction:
> "Anyone taking this should CLASSIFY before fixing. The useful axis is not where is the character
> but does this string reach a person, and which person."
Josh's one style rule is no em dashes in anything he reads.

## Scope of THIS PR
The agent-workforce `tools/` slice only - the part this repo owns and can merge cleanly. The
`~/.claude/bin` + `~/.claude/scripts` slice lives upstream (claude-setup) and is a separate PR under
the same upstream-authority question #1963 is parked on. Not bundled here.

## What I measured and classified
Only two files in agent-workforce had non-comment em dashes: `tools/kosmos-artifact-check.sh` (13)
and `tools/prove-it-fails.sh` (3). I read every one of the 16 lines. ALL are user-facing output:
- kosmos-artifact-check.sh: `bad`/`unp`/`ok`/`echo >&2`/`printf` - its findings print into the
  release-cut output Josh reads.
- prove-it-fails.sh: `echo` guidance printed to the operator running the prover.
None is in a comment. So all 16 are genuine defects under Josh's rule; there was nothing to leave.

## The fix
Replaced the em dash character (U+2014) with an ASCII hyphen on non-comment lines in the two files.
A per-line pass that skips any line
whose lstrip starts with `#`, so comments are untouched (though these two files had none on the hit
lines). After the fix, a sweep of EVERY `.sh` in the repo finds zero non-comment em dashes, so the
agent-workforce slice is complete.

⚠️ The skip-`#`-leading-lines heuristic is NOT generally string-context-aware: a `#`-leading line
inside a heredoc or a quoted string would be misread as a comment. I did not rely on it being
generally sound - I spot-checked both files by reading every em-dash line (all 16 hits are plain
`echo`/`printf`/`bad`/`unp`/`ok` output, none inside a heredoc or a `#`-leading string), so the
heuristic is correct FOR THESE TWO FILES. A future file with that shape would need the line read,
not the heuristic trusted.

## Verification
- `bash -n` both files: clean.
- `tools/test-artifact-check-wired.sh`: green (its greps target structural strings - KOSMOS_SITE_BASE,
  the `--repo $MAIN_REPO` call, exit codes - none of the changed messages).
- The diff is exactly 16 em-dash->hyphen substitutions: measured set-equality (every removed line
  carried an em dash; normalized-removed == added as a multiset), so no other edit slipped in.
- No node code touched; not in the node suite.

## Weakest premise (name it)
"All 16 reach a person" rests on `bad`/`unp`/`ok` being output functions. Verified by reading their
definitions: they echo a status-marked line to stdout/stderr, which is exactly the release-harness
output. If one were somehow a no-op the change would still be harmless (a hyphen renders identically
in any context), so the classification cannot cause a regression even if a single call were
mis-labelled.
