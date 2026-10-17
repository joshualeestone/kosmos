# ktsowner-6362: a kts- dir with no .kts-owner names its cause (#6362)

#6362 (Mona Lisa, 2026-10-17): whole validations failed at random on `kts-` temp dirs with no `.kts-owner`, so the
leak guard could not say which test file left them. Seen on PR #6351's CI and on agyuse-6176's full validation.

## What was measured (scratch experiment, both arms, with controls)
tmpscope already writes `.kts-owner` at creation (#6061), so the card's suggested first slice was in place. A dir
with no owner comes from the exit sweep (`fs.rmSync(dir, { recursive, force })`), which removes `.kts-owner` with
everything else:
- Arm A: a process the test started is still writing into the dir while it is swept. The final rmdir fails
  (ENOTEMPTY), the catch swallows it, and the dir can stay without its owner. Rare and noisy: 3 of 20 in the first
  run, 1 of 30 in two later runs of 30; a heavier writer (a reviewer's race) left it 30 of 30.
- Arm B: a process the test started, left running, makes a folder under the test's TMPDIR after the test has
  ended (a recursive mkdir recreates the dir). 20 of 20 runs.
- Control: the same scripts with the child ending before the parent: 0 of 10 per arm.
Mona's two dirs are gone (the run's temp root is removed), so which arm they were is not recoverable.

## The change
- If tmpscope's exit sweep leaves the dir behind, it writes the owner back, marked with a third field, `survived its
  sweep`. It writes it aside (`.kts-owner.new`) and renames it in, so a kill mid-write never empties a good owner.
- The leak guard says what each state means, and only what it can know:
  - a marked owner: the sweep ran but the dir survived it, and what the dir holds (what blocked the sweep);
  - an aside copy (`.kts-owner.new`, a kill between write and rename): the sweep ran, the rewrite did not finish, and
    the name from whichever owner line is there;
  - NO owner file: "made again after its test ended, by a process that test started and left running, or by a
    tmpscope older than #6061 (or its write failed)", and what the dir holds, because a left-running process's
    folders often name their test (Mona's log shows names like `boardkeychain-4491-...`, `kosmos-sendwhy-5435-...`);
  - an empty owner (cut at creation), an unreadable owner, a dir it cannot search, a dir it cannot list, and a
    listing that failed part way (kept, marked incomplete) each get their own sentence rather than a guessed cause.
  The listing is read whole before trimming and takes `find`'s own status, so no caller's `set -e`/`pipefail`
  setting changes the answer or ends the guard.

## Decided
- **No retry on the sweep.** An earlier round added `maxRetries` and credited it with "arm A 0 of 30". Re-measured
  three ways (no retry, Node's `maxRetries`, a hand-written retry loop), 30 runs each, in two races: the no-retry base
  rate was 1 of 30, so none of the differences means anything, and a heavier race left the dir 30 of 30 with or
  without it. A change whose benefit cannot be shown is not kept. Arm A is handled by naming the file, not by
  preventing the leak.
- Arm B cannot be named by tmpscope: the process that would write the owner has already ended. Listing the contents
  is the honest next best thing. Rejected: keeping `.kts-owner` until last; it does not help arm B either.
- The guard's sentences say what was reproduced, not a frequency: how often each arm happens in real runs is not
  measured.

## Weakest premise
That the leaked folders' names identify their test. Many fixture prefixes carry a card number or a test name, but a
generic one (`tmp-`, a bare mkdtemp) would not; then the report says what is there and a person still has to look.
Two known imprecisions: a dir remade between a failed sweep and the owner rewrite is marked "survived its sweep"
(the file is still named right); and an owner rewrite that fails outright (an unwritable dir) leaves the dir reading
as owner-less, whose sentence keeps "or its write failed" but leads with the remade-dir cause.

## Not done (next slice, if the card stays open)
Find the test(s) that leave a process running. That needs the contents of a real owner-less dir, which this change
makes the next leak report print. The card's "repeated full runs" measurement is the validation run of this branch;
one full run is one data point, not a rate.

## Tests
`test-support.tmpscope.test.js` (23): a dir that survives its sweep (a locked subfolder) gets its owner back marked,
and the real guard names the file and lists the lock (control: the same file with nothing locked leaves nothing); a
real left-running child that remakes the dir after its parent ended is reported by what it wrote (the child acts only
while the test's base exists and gives up after 20 s, so an interrupted run leaves nothing). Both skip as root and on
Windows. `tools/test-test-leak-guard-4273.sh`: every guard sentence above, under set -e with and without pipefail,
including mode 000 and 300 fixtures (unlocked in the cleanup trap). Mutants red: dropping the owner rewrite, the
aside read, the search check, the read check, and the find-status read. Untested: the part-way listing failure,
which cannot be made on demand.
