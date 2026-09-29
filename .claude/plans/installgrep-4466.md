# installgrep-4466: the install gate's restart check accepts #4466's --force

## What broke
The 0.7.11 staging cut (2026-09-29 15:28 CDT) failed at step 4b, the sandboxed real install of the bundle just
built: 145 passed, 1 failed, "the launchd bootstrap's restart reads the choice again first". Nothing was served.

#4466 (f6f3d3a88) changed install/setup.sh's launchd-bootstrap restart to `kosmos restart --force >/dev/null 2>&1 || true`
(an install run from an agent's pane is not the agent restarting the board). tools/test-install.sh:899 is a STATIC
grep for the literal text `restart >/dev/null 2>&1 || true` preceded by `_kosmos_board_decide`, so it no longer
matched. The behaviour is correct: the decide still runs on the line before the restart.

test-install.sh runs only at cut time (release.sh step 4b); no PR gate runs it, so #4466's review and CI never saw it.

## Change
The pattern takes `--force` as optional (ERE, `[|][|]` for the literal pipes). The check itself is unchanged: the
line before the restart must be the decide.

## Measured, three arms (the pipeline exactly as the check runs it)
- main's setup.sh: old pattern FAIL, new PASS
- pre-#4466 setup.sh (f6f3d3a88~1): old PASS, new PASS
- main's setup.sh with the decide line removed: new FAIL (the check can still fail on what it guards)

## Follow-up (Splinter, 15:29)
Card: run test-install.sh's static (non-install) checks before merge (CI or the pre-push gate), so a merge that breaks
one is caught at merge, not at the cut.

## Weakest premise
Only this one static check was broken by #4466's --force: the cut's 4b run is the evidence (145 passed, 1 failed), and
it runs every check in the file.
