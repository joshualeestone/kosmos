# A killed or unspawnable CLI must not read as exit 0 in the CLI test harnesses (kosmos#3628)

## Problem
The CLI test harnesses turned execFile's callback error into an exit code with
`err && typeof err.code === 'number' ? err.code : 0`. When the harness timeout fires,
execFile kills the child and reports err.code = null, err.signal = 'SIGTERM', so a
timed-out run read as exit 0: a PASS for any test expecting success. A spawn failure
(err.code = 'ENOENT', a string) read as 0 the same way.

The card named two files. The class is wider: 12 copies with a 0 fallback in 10
cli.*.test.js files, plus 5 files with `err ? (err.code ?? 1) : 0` and
cli.project-create-3388's catch with a 1 fallback, where a kill reads as a clean failure
(a PASS for tests expecting exit 1 or `notEqual(code, 0)`). The first sweep only looked
for 0 fallbacks; the blind review found the 1s. cli.world-outbox-1704 mapped a kill to
-1: not a false pass in its current asserts, but the same sentinel flaw, so it is
converted too (review pass 2). engine/create.js (production, 1) is unchanged: it is not
a test harness.

## Change
Every harness (17 files, 19 sites) now REJECTS when execFile gives no numeric exit
code, with "the CLI gave no exit code (<signal or error>): killed by the harness timeout
or never started." Otherwise it resolves `err ? err.code : 0`.

Why reject and not a sentinel: my first version mapped the missing code to a labelled
string. The blind review (BLOCKER, reasoned and then shown in the contrast test) pointed
out a string still satisfies `assert.notEqual(code, 0)`, which nine tests use to mean "it
failed". Any sentinel has that flaw; only failing the test does not.

The multi-MB stdin cases (5 calls) get a named 60s timeout (BIG_INPUT_TIMEOUT_MS): they
escape megabytes through sed, 10s at load 60, and a timeout now fails the test. The
post-stdin runCli gained its timeoutMs parameter (it silently ignored a 4th argument).

## Tests
cli.exit-code-mapping-3628.test.js:
- the harness shape, on a real stub killed by a 200ms timeout and a real ENOENT: both
  reject; real exit codes 3 and 0 resolve;
- CONTRAST: on a real kill the old 0 fallback reads 0, the old 1 fallback reads 1, and a
  sentinel passes notEqual(code, 0);
- guard over root and engine/ test files: no numeric fallback for a missing code
  (`typeof x.code === 'number' ? x.code : N`, `x.code ?? N`, `x.code || N`, any N
  including -1; x = err, e, error); any bare `err ? err.code : 0` must
  sit with the reject line; positive controls for every spelling, a negative control for
  the safe form, and a floor (>= 17 files carry the reject line, excluding this file).
  Restoring world-outbox's -1 reds it too.
  Perturbations: restoring `?? 1` in one file, and deleting the reject line in another,
  each red the guard.
All 18 changed cli.* files: 113/113 pass (review pass 3, measured). The bare-code rule
is per call site: each exit code taken bare from an exec error (`code: err ? err.code`,
`code: e && e.code`, `const code = err ? err.code`) must follow a `typeof x.code !==
'number'` check within 400 characters, so one guarded site cannot vouch for another
(perturbation: a second unguarded site in cli.task-2662 reds it). Scoped to `code`
positions and err/e/error, because a first unscoped version flagged six non-exit uses
(typed error checks, an HTTP status) in four other files; those are negative controls now.
The reject message names timeout, output-buffer overflow, or spawn failure.

### The guard's weight-bearing rule is positive, not a list of bad spellings
Review pass 4 (mutation-tested) showed the spelling rules can never be complete:
`err?.code ?? 0`, a reversed ternary, `err.code === null ? 0 : ...`, a named constant,
an alias or a renamed variable all read a kill as a number and match none of them.
So the guard now REQUIRES the good form: every callback `execFile(` in a cli.* test
must check `x.code !== 'number'` and go straight into `reject` or `throw` (a reversed
ternary has the same text and still falls back, so the check alone is not enough).
An ordinary unsafe spelling fails by what it lacks. execFileSync throws and promisify(execFile)
rejects on any error, so they are not call sites; a site that does not read the exit
code at all carries the marker "exit code not read (#3628)" with its reason (one:
cli.presents-board-token-1968, which asserts what the stub received). The spelling
rules stay as a cheap second layer (now including `?.code`). Floor: 19 callback sites
in 17 files, measured. Perturbations: `err?.code ?? 0` without the check reds both
layers; a null check to a named constant reds the positive rule alone.

### Where the guard stops, decided (review pass 5)
Pass 5 found text shapes that get past the positive rule. Closed: a commented-out check
(comments are blanked before matching), a second call inside a checked call's window
(each site's window now ends at the next site), and spawn/spawnSync/exec as call sites
(none exist in cli.* today; spawnSync accepts a `.status` number check). Not chased:
shapes written to defeat a text check (resolve before the check, `if (false && ...)`, a
throw swallowed by try/catch). No source regex can see order or reachability, and each
round of review was finding new text shapes rather than defects in the harnesses, which
have been correct since pass 2. The header and the rule's comment now say this plainly
instead of claiming the class is guarded.
Weakest premise: that a future harness author writes the ordinary shape, not an evasive
one. What would change my mind: a real harness in the repo that reads a kill as a pass
while passing this guard; then the guard should become an AST check.
Also out of scope: spawnSync `notEqual(r.status, 0)` checks in tools.* and engine/*
tests. A killed spawnSync gives status null, which passes that assert; a reviewer found
none that also set a timeout, but this change does not guard them.

## Found along the way (not a code defect)
The CLI tests first failed at exactly 20s on every case. That was the agent1 syspolicyd
stall (#3582, #3634): the first direct exec of a newly written executable hung 34-41s
while `bash <script>` was instant. It recovered at 15:13; the same tests then passed.
The new mapping is what made those stalls visible as failures instead of passes.
