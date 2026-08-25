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

## Fix

`install/setup.sh`'s `uninstall()`, right beside the existing supervisor
sweep (`rm -rf "$_support/bin"`): remove the three remembered-answer files
directly under `$_support` if present. `rm -f` (not `-rf`, they are files,
and `-f` is silent on a file that never existed -- a fresh install that
never showed the what's-new page, for example, has no `seen-version.json` to
remove).

Explicitly NOT swept: anything else under `$_support` --  `chats/`,
`projects.json`, `connect.json`, `secrets/`, `messages.jsonl`,
`room-seen.json`, `removed.json`, `usage/`, `attachments/`, agent folders.
Every one of those is either the person's actual content (chat history,
project records) or their credentials/connection state, not a "have we
asked this yet" flag -- removing any of those on uninstall would be the
opposite failure the header comment already warns against ("an installer
that cleans up too enthusiastically is worse than one that leaves a folder
behind").

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
