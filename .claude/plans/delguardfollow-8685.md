# delguardfollow-8685: the Windows delete guard's follow-ups (#8640)

## Finished looks like
On Windows, opening the page of an agent that is running no longer starts the process listing, and the page reads the
roster once; the nits on the card are closed, each with a test that can fail.

## Change
1. engine/delete-leftover.js `planAsync` (Windows): read the roster once (status.paneLook) and hand it to every plan
   the page makes (opts.look: the probe's warm plan, the plan after it, and that plan's stored-records look). When that
   read shows the agent running (liveIn, the one rule plan() itself uses: session name, then claim), no listing is read.
   A plain plan() with none handed reads exactly as before (#7819's failed-look test still holds).
2. `liveIn(look, clean, platform)`: plan()'s running check, factored out so planAsync asks the same question.
3. `foldersIfNeeded`: the folder must also be under the workers root, as plan() requires, before a listing is read.
4. engine/status.js NOT COVERED: a path named through an environment variable or as a relative path.
5. The 8.3 test calls status.win32Powershell(), not bare powershell.exe.
6. cli.leftover-limits-8685.test.js: the Windows CLI's plan (50 s) and delete (240 s) limits outlast the engine waits.

## Decided, and rejected
- The card's option A (hand plan() a roster read) over option B (start the listing beside the drive probe): B still
  pays for the listing on a living agent; A removes it and also halves the page's roster reads.
- The handed read can be as old as the drive probe (up to 20 s), as the listing's already could. The delete re-plans
  with fresh reads before it acts (delAsync), so the guard does not rest on it.
- Not measured here: agent-page latency on a busy Windows box (the card asks for it); needs the Windows box.

## Weakest premise
That a roster read showing the agent running is enough to skip the listing. It is what plan() already does (the
listing is read only when the roster shows no live session), so the page now skips only work the plan threw away.

## Tests
engine/delete-leftover.offthread-7835.test.js (Windows path driven on any platform): roster read once through the probe;
a running agent starts no listing; control: a leftover with nothing running is read for; an agent recorded outside
the workers folder costs no listing; the delete's last read starts its own while another page's read is held. On
main's delete-leftover.js the first, second and fourth fail; the fifth fails with `fresh` ignored. The #7835 "plans
once" test now counts plans by the identity read every plan makes once (a roster count can no longer see a second
plan); it fails when planAsync is forced to plan twice.
