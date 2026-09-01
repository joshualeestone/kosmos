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

All six now ask `runners.isRunnable`, through a lazy `runnerPresent(p)` in create.js
(lazy for the same reason `binPaths` requires lazily: sandboxes set env first) and a
top-level require in openaiaccounts.js (no cycle: runners.js requires only platform).

## The guard grew a second matcher rather than the codebase growing a convention

`engine.runnable-not-directory.test.js` sweeps for `accessSync(..., X_OK)`. Its own
header disclosed that `existsSync` carries no `X_OK` token and is invisible to it by
construction. `EXISTS_ON_BIN` now sweeps `existsSync(<runnerBin|codexBin|claudeBin|tmuxBin|bin>)`,
optionally qualified, with an EMPTY audited set. Its control plants all six spellings
that were live on 2026-08-30 and four honest presence checks it must not fire on.

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
  case deserves its own words. Then it is one sentence at one helper.
- **tmux rides the same fix.** The loop gate covers the runner and tmux through one
  `bin`; a folder at the tmux path spawns nothing either. Not carded separately.
- **No general existsSync sweep.** Hundreds of honest presence checks; the audited
  set would stop being auditable. The name-keyed matcher plus behavioural arms is
  the honest split.

## Weakest premise, named

The name-keyed matcher enforces the literals that existed on one day. A new gate
written as `fs.existsSync(runner)` or `existsSync(candidate)` passes the sweep. The
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

- Per-file: create.test.js 143, openaiaccounts.test.js 27, runners.test.js 30,
  runnable-not-directory 22, create.runner-dir-1616 9. Zero fail.
- Full suite: HELD at time of writing, not by load but by a colleague's bisect of the
  browser gate on main. Runs on his release, `EXIT_CODE` read from the log.
- Browser gate: this branch touches `engine/` only, no `web/`, so #1720's web-change
  gate does not apply.
