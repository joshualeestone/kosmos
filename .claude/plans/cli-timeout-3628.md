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

## Found along the way (not a code defect)
The CLI tests first failed at exactly 20s on every case. That was the agent1 syspolicyd
stall (#3582, #3634): the first direct exec of a newly written executable hung 34-41s
while `bash <script>` was instant. It recovered at 15:13; the same tests then passed.
The new mapping is what made those stalls visible as failures instead of passes.
