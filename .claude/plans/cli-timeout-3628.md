# A killed or unspawnable CLI must not read as exit 0 in the CLI test harnesses (kosmos#3628)

## Problem
The CLI test harnesses turned execFile's callback error into an exit code with
`err && typeof err.code === 'number' ? err.code : 0`. When the harness timeout fires,
execFile kills the child and reports err.code = null, err.signal = 'SIGTERM', so a
timed-out run read as exit 0: a PASS for any test expecting success. A spawn failure
(err.code = 'ENOENT', a string) read as 0 the same way.

The card named two files. A sweep found 12 copies in 10 cli.*.test.js files. A wider
sweep for other spellings (`err?.code ?? 0`, `(err && err.code) || 0`, `err.code || 0`)
found none, with a positive control proving the pattern matches all three spellings.
cli.world-outbox-1704.test.js already mapped to -1, and engine/create.js (production)
maps to 1; both are safe and unchanged.

## Change
- All 12 sites: `err ? (typeof err.code === 'number' ? err.code : 'no exit code (' +
  (err.signal || err.code) + ')') : 0`. A string can never equal a numeric expected
  code, and the failure message names the signal or error.
- The multi-MB stdin cases (5 calls in cli.msg-stdin-2909 and cli.post-stdin-2909) get a
  named 60s timeout. They escape megabytes through sed, which took 10s at load 60; now
  that a timeout fails the test, the 20s default had no margin under fleet load. The post
  file's runCli did not accept a timeout argument, so it gained one (otherwise the new
  argument would have silently done nothing).

## Tests
cli.exit-code-mapping-3628.test.js:
- a real stub killed by a 200ms timeout, and a real ENOENT, through the old mapping
  (contrast: both read 0) and the new one (both read a labelled string);
- real exit codes 3 and 0 still map as before;
- a guard: no *.test.js may contain the unsafe form, with a positive control on the
  pattern and a floor (>=10 files use the safe form) so the scan must reach the harnesses.
  Perturbation: reverting one harness reds the guard.

## Found along the way (not a code defect)
The CLI tests first failed at exactly 20s on every case. That was the agent1 syspolicyd
stall (#3582, #3634): the first direct exec of a newly written executable hung 34-41s
while `bash <script>` was instant. It recovered at 15:13; the same tests then passed.
The new mapping is what made those stalls visible as failures instead of passes.
