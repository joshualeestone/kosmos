# checkwiring-1387: a browser check that is never run reads as coverage

## The defect

Nine checks in `docs/browser-checks/` are never referenced by `tools/browser-checks.sh`.
**Four of them were written the same day to guard fixes Josh had asked for.** The author wrote
the check, the check does not run, and nothing anywhere says so. A directory listing shows 58;
the gate runs 48.

## What this branch adds, and what it deliberately does not

**The guard, not the wiring.** A meta-test asserting every check is actually run, plus an
explicit allowlist of the nine that are not.

⚠️ **The wiring is a separate risk and I am not taking it here.** Nine checks have never
executed. A check written to guard a fix is not necessarily a check that passes today - it may
encode an intent the shipped code never matched - and turning the gate red on nine at once
during a release window is a bad trade. The allowlist converts silence into a **visible,
shrinking debt list**; the guard fails on any NEW unwired check.

## Three things I measured that changed the shape of the fix

**1. The card's "10 of 58" is 9 checks plus 1 library.** `lib-sandbox-guard.js` is required by
five checks and exports a function; it is correctly absent from the runner. The card flagged it
as "may be a library, needs a look", so I looked. **The exemption keys on `module.exports`, not
on the `lib-` prefix, because a name is a convention and an export is a fact** - and the test
asserts the exemption is EARNED by something actually requiring it.

**2. My first sweep matched comments.** A bare basename grep counts a check that is only
discussed in prose: `render-projects` appears on four lines and is EXECUTED on one. That is the
mention-versus-execution error `tools.every-test-runs.test.js` was written about, and I made it
in the first sweep for this card.

**3. 🛑 AND THE OBVIOUS FIX FOR THAT WAS WORSE.** Matching only
`node docs/browser-checks/X.js` looks rigorous and **reported SIXTEEN checks as never-run that
run on every gate** - they are invoked by a loop at `:641`
(`run_one "$n" node "docs/browser-checks/$n.js"`). I nearly published that.

⇒ **An over-narrow pattern and an over-broad one, in the same measurement, in opposite
directions.** The discriminator that handles both: strip full-line comments, then match the
basename. A trailing comment on a real command line still counts as code, which is right - the
command on it runs.

## Verified by failing, arm by arm

```
control                                        4 pass 0 fail
a NEW unwired check appears                    3 pass 1 fail
an allowlisted check gets wired (stale entry)  3 pass 1 fail
the library loses its users (unearned)         3 pass 1 fail
restored                                       4 pass 0 fail
```

Plus a population floor and a matcher self-check, both for the same reason its sibling has them:
**if the directory read came back empty, every assertion below would pass by finding nothing.**

## Sibling, not a new pattern

`tools.every-test-runs.test.js` already does this for `tools/test-*.sh`. This file is shaped the
same way deliberately and says so. The populations differ; the principle does not.
