# drivewarm-9020: the Windows drive-kind test does not race a cold PowerShell (kosmos#9020)

Finished means: cli.task-files-win32-8227's two Windows arms (items 1 and 4) no longer fail because the real drive
table took longer than the CLI's 10 s one-shot bound on a busy CI runner. A real failure to read the drive as local
still fails, and the message now says how long the read took.

## Measured (from the run on the card, 45509671346, and engine/windrives.js on main)
- Item 1 took 10,199 ms. windrives.infoOf's default bound is ONE_SHOT_TIMEOUT_MS = 10,000 ms, so execFileSync killed
  PowerShell at 10 s; took(null) set failedAt, and infoOf answered null (not LOCAL): item 1's first assertion.
- infoOf does not read again until REFRESH_MS has passed since failedAt, so item 4, in the same process, asked through
  the CLI (`task built --file`), got null again, and the CLI did not send the path (its designed fail-closed answer):
  item 4's "the path sent was not the one named through the link". One cause, two reds.

## Built
- A test helper, learnRealTable(letter): setLearnForTests(null) (forgets a failed read, the test-only reset), then
  infoOf with a 30 s bound (60 s before review round 1), and the time it took. Item 1 uses it in place of its bare infoOf; item 4 calls it first
  (so it no longer depends on item 1 having run, or on the 10 s bound). Both messages say the read's time; each arm
  has a 120 s timeout.

## Rejected
- Raising ONE_SHOT_TIMEOUT_MS in the product: the 10 s bound is the CLI's promise to a person waiting on it, and a
  timeout already ends correctly (not sent, and why). A slow runner is not a reason to make the person wait longer.
- Retrying in the CLI on a timeout: same reason; and the card's red is the test's, not a user-visible wrong answer.
- Listing it as FLAKY in tools/windows-tests.js: hides a red whose cause is known and fixable.

## Round 1 (opus, blind) fixes
- WARNING fixed: the first version gave the read 60 s, which is exactly the runner's per-test limit
  (tools/windows-tests.js runs each file with --test-timeout=60000), so a slow read would have ended as a bare test
  timeout, not the new message, and my weakest-premise sentence claimed the opposite. Now the read gets 30 s and each
  Windows arm 120 s (its own timeout option), so a read past 30 s fails with its time in the message.
- NIT taken: every read prints "MEASURED: drive read took N ms (one-shot bound 10000 ms)", which windows-tests.js keeps
  in the log on a pass: the one place a real cold read on Windows is measured against the product's bound.
- NIT fixed: 10,199 ms was the whole of item 1, not the read alone; the comment now says so.

## Weakest premise
That PowerShell's cold start is all of the 10 s. If a runner needs more than 30 s, this still fails, with the read's
time in the message; and the MEASURED lines will show whether the product's 10 s bound is too tight for real
computers, which is the question a person would care about.
