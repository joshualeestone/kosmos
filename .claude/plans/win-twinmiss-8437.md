# win-twinmiss-8437: a twin miss on an incidental rule no longer refuses the whole Windows guard (kosmos#8437)

**Posture:** production

## Problem
#5664 step A (PR #8438) adds, on Windows, each Read/Edit rule on the real path it reaches (`withRealTwins`): a rule on
a link's own path covers nothing there (measured). When a twin cannot be written (a share, too wide, a path the rules
cannot carry, a real place that cannot be worked out), step A refused the WHOLE guard with nothing written, for any rule.
So one instruction-file import on a mapped drive or behind an odd junction left every token-only Windows agent with no
file-tool denies at all, the board token's included. On Linux the same kind of gap goes to the not-whole list and the
guard is still written. Raised in #8438's review round 8 and carded.

## Change
- `withRealTwins` also returns `misses`: each gap with the rule it came from (and whether it is a token rule).
- `isProtectedRule(rule, rules)` (new, exported): whether a rule's path is, or is under, one of the places the guard
  exists to protect: the board token and its temp copy, the sender-token folders, the launch hand-off, the undo stores
  and switches, the guard's own settings files and folder, its list and record, the records the board trusts.
  Case-blind on Windows. A name that only starts the same (`sendertokens-old`) is not under it.
- The guard refuses (nothing written, as before) when a miss is on a token or protected rule, or on a rule not known
  to be incidental. A miss on a known incidental place (an import, the start-up config, a command script, shell start
  files, plugins, launch folders) is added to `configUnsafe`: the guard is written and says it is not whole, naming it.
- Tests (engine/tokenguard.win32-5664.test.js, the Windows job runs it): the classification, pure; and on a Windows
  filesystem an import reached through a junction into a `[x]` folder now leaves the guard written, the token denied,
  the import named. The existing "a protected place that is not the token ... refuses too" test still holds. Both new
  tests fail against origin/main.

## Review round 1
- The worlds registry (worldWrites) was missing from the protected list: added.
- The protected list drifts toward a quiet gap when a new protected field is added. Flipped the default: a miss
  refuses unless its rule is on a place KNOWN to be incidental (isIncidentalRule: imports, start-up config, command
  scripts, shell start files, plugins, launch folders). A new kind of rule therefore errs toward refusing. Tests pin
  every protected field, the incidental ones, and that a rule of neither kind is not incidental.

## Decided, not missed
- Launch-folder misses are classed incidental and worded as a start-up file (on Windows launchPathDirs returns no
  folders, so none occurs today).
- The undo stores and the trusted records count as protected (they are what the guard denies for the token's sake:
  a forged undo record is what restore writes out; the trusted records decide who made which agent). Weakest point now:
  the INCIDENTAL list is by field name, so a new incidental kind added later refuses until listed (too strict, never
  a quiet gap); a sibling or import glob miss also refuses today. Would change my mind: a common setup that this
  over-refuses.

## Not covered
- Unchanged from #8438: links under a glob segment for non-token rules, a one-letter share host, the production
  tooWide closure has no filesystem test.

## Done when
- engine/tokenguard.win32-5664 all pass on the Windows box; the two new tests fail on origin/main.
- Policy tests green. Mac/Linux CI green (Windows-only code); the Windows job runs the file.
