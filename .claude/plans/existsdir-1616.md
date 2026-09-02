# kosmos#1616: the gates that LAUNCH an agent asked existsSync, and existsSync accepts a directory

Renet Tilley, 2026-09-01. Branch `existsdir-1616` off `origin/main` at 5e328edd.

## The mechanism, measured rather than assumed

`runners.isRunnable(p)` is one definition of "is this runnable" (#1592): a plain file,
`X_OK` for this process. Every runner gate on the creation path asked a different
question, `fs.existsSync(bin)`, which answers yes to a DIRECTORY and to a file with no
exec bit. The card measured the split on one machine:

    a DIRECTORY at the bin path:  existsSync true    isRunnable false
    a real executable:            existsSync true    isRunnable true

So a folder at `~/.local/bin/claude` was refused by the first-run screen, which only
REPORTS, and accepted by the path that SPAWNS, which then failed later with a worse
message. Two definitions of one fact, the defect shape this codebase keeps paying for.

## The sites, by mechanism and by line at 5e328edd

| site | function | line | old question |
|---|---|---|---|
| switch an agent's provider | `setProvider` | create.js:845 | `!fs.existsSync(runnerBin)` |
| give an agent its job | `installJob` | create.js:1848 | `!fs.existsSync(runnerBin)` |
| create on OpenAI, early gate | `createAgentInner` | create.js:2027 | `!fs.existsSync(codexBin)` |
| create, the bin loop (runner and tmux) | `createAgentInner` | create.js:2415 | `!fs.existsSync(bin)` |
| offer OpenAI as the way out | `createAgentInner` | create.js:2417 | `fs.existsSync(codexBin)` |
| sign in with a key | `addWithKey` | openaiaccounts.js:340 | `!fs.existsSync(bin)` |

The card named five. The sixth, the alternative offer, hangs off the fourth: with a
FOLDER at the codex path and a sign-in on the machine, creation said "or create this
agent on OpenAI instead", which is the dead click in words #548 was written to stop.

All seven now ask `runners.isRunnable` (the six below plus `docs/browser-checks/live-connect.js`'s
tmux spawn gate, found in review), through a `runnerRunnable(p)` helper in create.js over
a top-level require of runners.js (iteration 2 replaced a lazy require whose stated
reason the code did not support), a top-level require in openaiaccounts.js, and a
top-level require in the driver (no cycle: runners.js requires only platform).

## The guard grew a second matcher rather than the codebase growing a convention

`engine.runnable-not-directory.test.js` sweeps for `accessSync(..., X_OK)`. Its own
header disclosed that `existsSync` carries no `X_OK` token and is invisible to it by
construction. `EXISTS_ON_BIN` now sweeps `existsSync(<runnerBin|codexBin|claudeBin|tmuxBin|bin|tmux|claude|codex>)`,
optionally qualified, with an EMPTY audited set. Its control plants all seven spellings
that were live on 2026-08-30 (the card lists one twice, so four distinct, plus the
alternative-offer line, plus a browser-check driver's tmux gate found by the iteration-1
reviewer) and five honest presence checks it must not fire on.

**Its gap, stated at the definition and repeated here:** it is keyed on identifier
NAMES. An existsSync over a differently named variable, over `path.join(dir, 'claude')`,
or a `statSync(bin)` that never asks `isFile`, is invisible to it. A guard keyed on a
literal cannot enforce a property; the behavioural arms below are what enforce it.

## The arms, and the revert table

`engine/create.runner-dir-1616.test.js`: nine arms, each driving the real code with a
real directory AND a real 0644 file, with a runnable control per gate. The fixture
asserts its own premise first (existsSync yes, isRunnable no) so no arm passes vacuously.

Every site reverted to `existsSync` individually, the mutation confirmed applied by
`git diff --stat`, the file restored from the captured buffer afterwards:

| revert | behavioural arm red, by name | sweep red |
|---|---|---|
| M1 setProvider | `setProvider refuses to switch...` | yes |
| M2 installJob | `installJob refuses a directory...` | yes |
| M3 early OpenAI gate | **GREEN on first pass. See below.** Then `the early OpenAI runner gate refuses a directory BEFORE the name is judged` | yes |
| M4 bin loop | three arms: claude path, tmux path, alternative offer | yes |
| M5 alternative offer | `the OpenAI alternative is NOT offered...` | yes |
| M6 addWithKey | `addWithKey refuses a directory...` | yes |

### M3 was green, and why that is the reusable finding

The early OpenAI gate and the late loop gate refuse a directory with the SAME
sentence, so an arm keyed on the sentence cannot tell which gate fired: revert the
early one and the late one catches the same input. A stronger assertion on the same
observable would not help. The observable that DIFFERS is order: the early gate sits
before `nameProblem`, so with a directory at the codex path and an empty name, the
runner refusal must win. The added arm pins that, and M3 now reds by name.

Same shape as the securewrite finding on credwrite-1787 (a mode cannot discriminate,
an inode can): when a guard will not bite, find an observable that differs.

## Decided on this branch, and what would change my mind

- **The refusal sentence stays "could not find".** For a present-but-stripped file
  that is slightly false. It is kept because it is the word the first-run screen
  already uses for the same state and the UI matches on it; a second sentence would
  be a second definition. Would change my mind: a Josh ruling that the stripped-file
  case deserves its own words. Then it is one sentence at one helper. The same ruling
  covers the engine-side `alternative.because` ("the codex runner is not on this
  computer"), which is the same slightly-false statement for the same case.
- **tmux rides the same fix.** The loop gate covers the runner and tmux through one
  `bin`; a folder at the tmux path spawns nothing either. Not carded separately.
- **No general existsSync sweep.** Hundreds of honest presence checks; the audited
  set would stop being auditable. The name-keyed matcher plus behavioural arms is
  the honest split.

## Weakest premise, named

The name-keyed matcher enforces the literals that existed on one day. A new gate
written as `fs.existsSync(runner)` or `existsSync(candidate)` passes the sweep, and so does
a call split across lines, because the sweep is per-line. The
arms catch it only if it sits on a path they drive. Nothing here makes the property
un-violable; it makes the two known spellings and the six known sites un-violable.

## Restore from the buffer, not from git

The first perturbation pass restored each mutated file with `git checkout`, which
restores HEAD, and the fix was uncommitted at the time. The restore check caught it
(`file !== orig`), the edits were re-applied from a saved script, and the fix was
committed before the second pass. The script now restores from the captured buffer
and additionally asserts the file matches HEAD, which is only true once the fix is
committed. Recorded so the next person commits first.

## Verification

- Per-file after iteration 2: create.test.js 143, openaiaccounts.test.js 27,
  runners.test.js 30, runnable-not-directory 22, create.runner-dir-1616 9. Zero fail.
- Full suite at 1a385a53 (after iteration 2), tree clean, `tools/run-tests.sh` with the
  exit code written to the log by the runner's own last line: **`EXIT_CODE=0`, 3609 tests,
  0 fail**, 19:28 to 19:30 CDT on 2026-09-01. Re-run at 46d61489 (after iteration 4):
  **`EXIT_CODE=0`, 3609 tests, 0 fail**, 19:39 to 19:41. The hold that preceded the first
  run (a colleague's browser-gate bisect on main) was lifted at 19:13.
- Browser gate: this branch touches no `web/` file. It does touch one line of a
  browser-check DRIVER (`docs/browser-checks/live-connect.js`, since iteration 1), and
  #1720's gate keys on `web/` changes needing a `docs/browser-checks/` touch, so it does
  not fire here. The driver line is verified by `node --check` and by runners.test.js
  covering the callee; the release cut is what exercises the driver itself.

## Challenge loop, iteration 1 (2026-09-01 19:05)

One WARNING, two CONVENTIONs, four NITs, all applied: a tmux spawn gate in
`docs/browser-checks/live-connect.js` asked presence under a name the matcher did not key
on (fixed, matcher widened to bare `tmux|claude|codex`, the line planted in the control);
the guard header contradicted itself across a sentence boundary (past tense now); the helper
block had split `binPaths` from its own doc comment (moved above it, and renamed
`runnerRunnable` for what it answers); the per-line gap is disclosed; the tmux arm drives both
wrong shapes; the counts in prose match the arrays. The reviewer independently reproduced
three rows of the revert table on scratch copies and confirmed the old openaiaccounts suite
stays green under M6, so the new arm is what carries that property.

## Challenge loop, iteration 2 (2026-09-01 19:30)

Two WARNINGs, two CONVENTIONs, three NITs, all applied or recorded: the helper's lazy
require had a rationale the code does not support (plain top-level require now); the
matcher's gap disclosure names the two known unswept presence checks (`remote.js` tunnel
binary, `live-connect.js` launcher) and why they are left; the plan no longer says
"engine only"; the `alternative.because` wording is in the decided scope; the claude-loop
control asserts CREATED. Recorded, not changed: the bin loop has no DRY_RUN guard
(pre-existing); the driver line is exercised only by the release cut. The reviewer
reproduced three revert rows and measured the per-line gap.

## Challenge loop, iteration 3 (2026-09-01 19:35)

Two CONVENTIONs, three NITs, all applied: the helper comment counted four DRY_RUN gates
where there are three (the bin loop and the alternative offer are the unguarded two);
the mechanism paragraph still described the lazy require iteration 2 removed; three
lines had been appended to rather than rewrapped; the driver's require is hoisted beside
its sibling; the two weaker controls say why they are weaker. The reviewer reproduced
four revert rows and checked the load-order claim against the require graph.

## Challenge loop, iteration 4

One CONVENTION, three NITs, all applied: `binPaths` pointed at the module const instead
of two lazy requires; the matcher discloses that its qualifier accepts one dotted level;
the census names `reporthook.js`; the driver comment says "would fail", since that
failure was not measured for the driver. The reviewer reproduced three revert rows and
the driver revert (sweep only, as disclosed).
