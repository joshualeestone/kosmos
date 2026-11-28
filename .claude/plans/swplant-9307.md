# swplant-9307: a planted plain file at a temp name refuses the save (kosmos#9307)

## Finished looks like
engine/securewrite.js never reaches its in-place fallback because plain files were planted at its guessable temp names:
a create that fails EEXIST counts as a refusal, as a swapped name already does (#9285), and the save fails with the file
left as it was. The fallback still works for real failures, and the module's own tests reach it through one.

## The call
An EEXIST from the `wx` create of a fresh temp name throws ERR_KOSMOS_TEMP_SWAPPED (`planted: true`, the EEXIST as its
cause), so it is counted with the swaps and `swappedAttempts > 0` refuses the save. One is enough, as #9285 decided for
swaps. An EEXIST anywhere else (the chmod, the rename) is not counted.

Rejected: refusing only when all three attempts were plants. A plant at one name with two other failures would still
reach the fallback, which is the #9285 review 2 gap again.

## Tests
- New (engine/securewrite.test.js): plain files at all three names refuse the save (no in-place open, config unchanged,
  the refusal marked planted with the EEXIST kept); one plant among two EPERM failures refuses too; CONTROL: three EPERM
  failures still take the fallback and write. Fails on main ("three planted files did not refuse the save").
- Moved to EPERM, since EEXIST now refuses: securewrite.fsync-5434 (wxFails), accounts.fsync-5434 (two tests),
  store.fsync-5434 (three). The #9285 mixed-plant atomicOnly test's last attempt is now a planted refusal.
- Every test file that mentions EEXIST, writeSecret or securewrite (49 found by grep) passes.

## Weakest premise
That nothing legitimate leaves a file at a fresh temp name. The name carries pid, thread, start time and a sequence
number, so the honest routes are a crashed earlier process with the same pid, thread and start millisecond (the reaper
reads such a temp as this process's own and cannot remove it), a second copy of the module loaded in the same thread and
millisecond (a cleared require cache restarts the sequence) finding a temp a failed unlink left, or a network mount that
resends an exclusive create after a lost reply and answers EEXIST for the file it just made. Any of the three fails
that save only when the other two attempts fail too; one EEXIST and a clean next attempt still saves.

## Review 1
Seven more "every atomic attempt fails, the file is left as it was" tests forced the failure with EEXIST, which now
refuses before atomicOnly is consulted, so they passed whatever atomicOnly did (agyhooks, setupsettings, person,
create.codex, trust, settingswrite, allowance fsync-5434). Moved to EPERM; measured: with atomicOnly ignored in
securewrite.js all seven files go red (1, 3, 2, 1, 5, 3, 2 failures), so they test their claim again.

## Review 2
No other test injects EEXIST to reach the fallback or the atomicOnly exit (searched the whole repo); the planted-once
retry tests (#1761, #1787) still test what they name. Added: an atomicOnly arm with three plants (the refusal, never the
raw EEXIST), a `planted` flag on the final refusal (true for a plant, false for links only), the reloaded-module route
above, and the #9285 doc's measured claim scoped to swap refusals.

## Review 3
Mutation-checked by the reviewer: with the EEXIST refusal disabled, or with "refuse only when all three are plants", the
new tests go red. Left open and carded (kosmos#9325): plant shapes that fail the create with another code (a Windows
file held open and delete-pending fails EPERM, which is also the ordinary Windows fallback reason, so it cannot count).

## Review 4
Mutation-checked (three mutations, each red). Added: directory and dangling-link plant arms (any EEXIST counts; with the
check narrowed to regular files the test goes red), and the doc says a caller now sees ERR_KOSMOS_TEMP_SWAPPED rather
than the other attempts' own codes, which ride as `lastAttempt` (no caller branches on them; githubdevice.js shows the
code to a person, and shows this one).

## Review 5
Mutation-checked again (four mutations, each red). Corrected: the doc said no caller branches on the other attempts'
codes "(checked)"; engine/backupstate.js does (it marks a failed state save `retry` on EPERM or EACCES), found by the
reviewer after my search looked only near each call. Behaviour kept: a refused save is not retried at once, as for a
swap since #9285, because a prompt retry only draws three more guessable names. Added the fourth honest route
(containers with their own pid namespaces sharing a folder). The store test matches the raw EPERM by code. The
dangling-link arm's "not followed" line was dropped (it could not fail where it runs).

## Review 6
Every reader of an error code on a writeSecret failure path was traced: backupstate (not retry, as stated),
githubdevice (shows the code), and two others that read codes from other calls. Added: a backupstate test that a state
save refused by a plant is not retry while three EPERMs still are (fails on main, where the plant case was retry), the
`planted` flag in the module header, and an exact plant count in the #9307 test.

## Reviews 7 and 8 (the cap)
Review 7 (opus) mutation-checked four more mutations, each red; doc nits fixed (backupstate's own header names the
not-retry exception, only the last attempt's error rides along, the retry tests' citation). Review 8 (sonnet): the
module header said no caller branches on the code while the doc below names backupstate; both now say backupstate
reads every code for its retry rule and this one is not a retry code. No code change after review 8, only comments.
