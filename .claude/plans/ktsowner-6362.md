# ktsowner-6362: a kts- dir with no .kts-owner names its cause (#6362)

#6362 (Mona Lisa, 2026-10-17): whole validations failed at random on `kts-` temp dirs with no `.kts-owner`, so the
leak guard could not say which test file left them. Seen on PR #6351's CI and on agyuse-6176's full validation.

## What was measured (scratch experiment, both arms, with controls)
tmpscope already writes `.kts-owner` at creation (#6061), so the card's suggested first slice was in place. A dir
with no owner comes from the exit sweep (`fs.rmSync(dir, { recursive, force })`), which removes `.kts-owner` first:
- Arm A: a process the test started is still writing into the dir while it is swept. The final rmdir fails
  (ENOTEMPTY), the catch swallows it, and the dir stays without its owner. 3 of 20 runs.
- Arm B: a process the test started, left running, makes a folder under the test's TMPDIR after the test has
  ended (a recursive mkdir recreates the dir). 20 of 20 runs.
- Control: the same scripts with the child ending before the parent: 0 of 10 per arm.
Mona's two dirs are gone (the run's temp root is removed), so which arm they were is not recoverable.

## The change
- tmpscope's sweep retries (`maxRetries: 3`), and if the dir still exists afterwards it writes `.kts-owner` back
  with a third field, `survived its sweep`. Measured after: arm A left 0 dirs in 30 runs (the retry wins the race).
- The leak guard reads that field ("its exit sweep ran but the dir survived it (...)"), and for a dir with NO owner
  it lists what the dir holds (five names, then a count), because a left-running process's folders usually name
  their test (Mona's log shows names like `boardkeychain-4491-...`, `kosmos-sendwhy-5435-...`). It reads the whole
  listing before trimming, so no early-closing pipe can end the guard under set -e and pipefail.

## Decided
- Arm B cannot be named by tmpscope: the process that would write the owner has already ended. Listing the contents
  is the honest next best thing. Rejected: keeping `.kts-owner` until last (a sweep that removes everything but the
  owner, then the owner, then the dir): it does not help arm B either, and an owner-only dir after a failed rmdir is
  what the marked rewrite already gives.
- The guard's owner-less sentence says what was reproduced ("made again after its test ended, by a process that test
  started and left running, or by a tmpscope older than #6061"), not a frequency: how often each arm happens in real
  runs is not measured.

## Weakest premise
That the leaked folders' names identify their test. Many fixture prefixes carry a card number or a test name, but a
generic one (`tmp-`, a bare mkdtemp) would not; then the report says what is there and a person still has to look.

Also: if a process remakes the dir between a failed sweep and the owner rewrite, the dir is marked "survived its
sweep" though it was remade; the guard then names the file (right) with a cause that is only roughly right.

## Not done (next slice, if the card stays open)
Find the test(s) that leave a process running. That needs the contents of a real owner-less dir, which this change
makes the next leak report print. The card's "repeated full runs" measurement is the validation run of this branch;
one full run is one data point, not a rate.

## Tests
`test-support.tmpscope.test.js`: a dir that survives its sweep (a locked subfolder) gets its owner back marked, and
the real guard names the file (control: the same file with nothing locked leaves nothing); a real left-running child
that remakes the dir after its parent ended is reported by what it wrote. `tools/test-test-leak-guard-4273.sh`: the
marked owner line, the owner-less listing under set -e and pipefail, and the five-then-count trim. Mutant: dropping
the owner rewrite reds the survive-sweep test. NOT guarded by a test: the sweep's retry (`maxRetries`). Node retries
ENOTEMPTY, EBUSY and EPERM but not the EACCES the locked-folder test makes, and a real ENOTEMPTY race is not
deterministic; arm A's "0 of 30" is the scratch measurement, not a suite check.
- Review 1: an EMPTY `.kts-owner` (a kill while tmpscope wrote it at creation) has its own sentence ("owner line
  cut"); only a dir with NO owner file gets the "made again" explanation, which now keeps "or its write failed".
