# The uninstall does not remove everything it claims to (#891)

Baron caught this hunting an intermittent install-gate red: the byte-for-byte
"every user file survives the uninstall" check went red on run 9 of 20. The
diff named the file:

    4a5
    > ecdc8d7e8c0f146fa4bb05ae1cd94a29fbe217ee  ./seen-version.json

One file appeared in the sandbox's data folder during the run and the
uninstall left it there. Reported via Splinter, routed to me: the install
path is my lane.

## Root cause, confirmed by reading the code

`server.js:4103` writes `<AGENT_WORKFORCE_DATA>/seen-version.json` on
`POST /api/whats-new/seen` (#543: the board silently records the current
version the first time the "what changed" page is seen). `install/setup.sh`'s
`uninstall()` deletes `KOSMOS_HOME` (the app tree) and, inside the person's
data folder, only `$_support/bin` (the shared supervisor and codex bridge,
already classed as app plumbing). It never touches `seen-version.json`.

## The class is bigger than the one file the gate happened to catch

`engine/discover.js:38-41`'s own comment already names the family, written
before this bug was found:

> the flag lives on disk beside the app's other remembered answers
> (seen-version.json, first-run.json), not in the browser, because "forever"
> has to survive a new browser, a new port and the next version.

That sentence describes THREE files as one class, not two: `discover.js`'s own
`found-agents-dismissed.json` (the "found your existing agents" dismissal),
plus `seen-version.json` and `first-run.json` it names beside itself. All
three share the same shape and the same reason to exist: a boolean or a
version string the app checked once so it does not ask again, written
straight to the data-folder root, never read by anything except the route
that wrote it. None of them is the person's data (a chat, a project, an
agent's files) -- they are the app's own memory of questions already asked,
which is exactly what an uninstall's "back to a clean slate" promise covers
and exactly what `$_support/bin`'s removal a few lines above already argues
for the supervisor.

Confirmed none of the three is currently swept (grepped `install/setup.sh`
and `tools/test-install.sh` for all three names: zero hits before this
change). Confirmed `first-run.json` and `found-agents-dismissed.json` are
NOT touched by the separate "Forget my data" feature either (`engine/
forget.test.js` explicitly pins that `first-run.json` survives a Forget) --
that is a different, correct answer for a different operation: Forget clears
the person's data while leaving the app itself usable, so it must NOT
re-trigger onboarding. Uninstall removes the whole app, so leaving these
behind serves no one; a reinstall should start from the same blank slate a
first install does.

## A second bug, found in challenge-loop iteration 1: the sweep targeted the
## wrong directory for two of the three files

`engine/store.js`'s `ROOT` already resolves `AGENT_WORKFORCE_DATA` (it joins
the env var with the app's own `'AgentWorkforce'` subfolder when the var is
set, and falls back to the real default otherwise). `server.js`'s
whats-new route and `engine/discover.js`'s `DISMISS_FILE` did not use
`store.ROOT` for their write path -- they used
`process.env.AGENT_WORKFORCE_DATA || store.ROOT`, which LOOKS like the same
fallback but is not: when the env var IS set, the `||` short-circuits past
`store.ROOT`'s own join, and the file lands one directory ABOVE where every
sibling file (including `first-run.json`, which correctly uses `store.ROOT`
alone) actually sits.

With the env var unset -- every real install -- this is invisible, because
`store.ROOT` and the buggy expression resolve to the exact same path. It is
exactly the condition a sandboxed install gate sets deliberately (to point
the app at a disposable folder), which is precisely why Baron's gate caught
`seen-version.json` at the sandbox data folder's ROOT (`./seen-version.json`
in the diff, i.e. `$SB/data/seen-version.json`) rather than under
`AgentWorkforce/` where this card's first fix swept.

**This means my original fix, targeting `$_support/seen-version.json` and
`$_support/found-agents-dismissed.json` (`$_support` = the `AgentWorkforce`
subfolder), was correct for real end users but would NOT have caught a
recurrence under the sandboxed gate's own conditions** -- the same
conditions that produced the original 1-in-10 flake. My first version of
the new `tools/test-install.sh` check seeded the files at the path the
*sweep* expects rather than the path the *real write code* produces under
`AGENT_WORKFORCE_DATA`, so it would have passed regardless of whether the
underlying bug were fixed.

**Fixed at the root**, not worked around in the sweep: `server.js`'s
whats-new route (four call sites: the GET read, the mkdir, the tmp path, the
rename target) and `engine/discover.js`'s `DISMISS_FILE` now use
`store.ROOT` alone, matching `engine/firstrun.js`'s already-correct pattern.
Confirmed no test pins the old (buggy) path: `server.test.js`'s whats-new
test only round-trips through the HTTP route (GET after POST), so it never
observed which directory the file actually landed in; `engine/
discover.test.js` asserts `DISMISS_FILE.startsWith(SB)`, a containment
check the corrected path still satisfies. Both pass unchanged.

With this fixed, `_support` in `install/setup.sh` (`AgentWorkforce`
subfolder) and `store.ROOT` in the engine now agree unconditionally, so the
uninstall sweep is correct under both real-install and sandboxed-gate
conditions, and `tools/test-install.sh`'s new seeding
(`$SB/data/AgentWorkforce/{file}.json`) matches where the real code actually
writes.

## Fix

`install/setup.sh`'s `uninstall()`, right beside the existing supervisor
sweep (`rm -rf "$_support/bin"`): remove the three remembered-answer files
directly under `$_support` if present. `rm -f` (not `-rf`, they are files,
and `-f` is silent on a file that never existed -- a fresh install that
never showed the what's-new page, for example, has no `seen-version.json` to
remove).

Explicitly NOT swept: anything else under `$_support` -- `chats/`,
`projects.json`, `connect.json`, `secrets/`, `messages.jsonl`,
`room-seen.json`, `removed.json`, `usage/`, `attachments/`, agent folders.
Most of those are the person's actual content or credentials (chat
history, project records, connection state, OAuth app config) and are
excluded on that basis, plainly. Two are closer calls, raised in
challenge-loop iteration 1, and worth being honest about rather than
folding into the same sentence as the credentials:

- `room-seen.json` (per-room unread-cursor bookkeeping) is the same
  "have we seen this" SHAPE as the three swept files. Left alone anyway:
  the cost of leaving it is a stale unread badge after a reinstall, not a
  re-triggered onboarding flow, so it does not carry the same "the person
  is being asked something they already answered" weight #891 is about.
- `removed.json` (`engine/remove.js`) is NOT credentials or connection
  state -- that was a mischaracterization in an earlier version of this
  paragraph. `remove.js`'s own header is explicit that removal is a board
  VISIBILITY choice, reversible, nothing on disk deleted. It is closer to
  the person's own curation of what their board shows than to "the app
  silently remembered a question so it would not ask again," which is
  the actual class #891 and `discover.js`'s own comment define. Left out
  of this card on that basis: it was not named in the issue, it is not
  part of the code-defined "remembered answers" family the other three
  belong to, and reaching for a fourth, un-requested file is exactly the
  "cleaned up too enthusiastically" failure the uninstall's own header
  warns against. Worth a second look by whoever owns the board's found-
  agents-on-reinstall experience, not decided here.

## Question 2 (what loaded the sandboxed board's page during the gate)

Not this card. Baron is on it directly per Splinter's routing; his diagnostic
copy now keeps request evidence on a FAIL for the rest of his loop.

## Verification plan

- Extend `tools/test-install.sh`'s existing byte-for-byte gate: seed all
  three files into `$SB/data/AgentWorkforce/` before the uninstall step
  (matching how the test already seeds `you.json`, `agents/`, `projects/`,
  `.hidden-record` before the upgrade-preserves-user-data check), run
  uninstall, assert none of the three survive.
- New unit-level coverage isn't warranted here beyond the install-gate
  script itself: this is shell behavior in `install/setup.sh`, and the
  existing test harness (`tools/test-install.sh`) is the only thing in the
  repo that actually exercises `uninstall()` end to end, matching how every
  other uninstall behavior in this file is proven (the PATH-line removal,
  the plist sweep, the app-bundle ownership check all have their proof
  there, not in a `.test.js` file).
- Run `tools/test-install.sh` locally in full before merge, confirm the
  byte-for-byte check passes both for the pre-existing seeded files AND the
  three newly-swept ones.
- On the intermittency itself (1/10 baseline): this fix makes the file
  ALWAYS get removed once created, which removes the failure mode
  entirely regardless of the still-open question of what created it on some
  runs and not others. Not claiming a rate ("fixed the flake") since the
  flake's trigger (question 2) is not this card's to close -- claiming
  only what this card actually changes: the sweep, unconditionally, once
  the file exists.
