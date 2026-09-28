# xsitechild-4309: the xsite, connect and doorflight tests never start the host's gh or vercel

Addresses #4309 (claimed:raiden, Liu Kang m2189 and m2227). Filed by Johnny Cage.

## Finished when
- `server.xsite-1636.test.js` leaves nothing in its sandbox after it exits, shown by a check
  that fails when the leak cause is put back.
- `aw-xsite` can come off `tools/test-leak-allowlist.txt`. (It is not on main yet: Johnny's
  #4298 adds it. Whichever of #4298 and this PR merges second removes it; agreed m2235.)

## Cause (measured, 2026-09-28)
- `/api/connections` asks every door, including the gh and Vercel device doors
  (`engine/devicedoor.js`). With no `AGENT_WORKFORCE_GH_BIN` / `AGENT_WORKFORCE_VERCEL_BIN`
  set, each resolves the host's real CLI (`/opt/homebrew/bin/...`) and runs it with the
  test's `HOME=<SANDBOX>/home`.
- A spawn logger on the xsite test saw exactly four children: `gh auth status` and
  `vercel whoami`, twice each. All four exited.
- `vercel whoami` in a temp HOME writes `Library/Application Support/com.vercel.cli` and
  `Library/Caches/com.vercel.cli` at once, and 4 seconds after it exits a new
  `.npm/_logs/*.log` appears: its detached update check is a grandchild that outlives it.
  The board never holds that process, so it cannot be stopped or waited for. The card's
  "stop and wait for the child" is therefore not possible; not starting it is the fix.
- Before and after: main leaves `aw-xsite/home/Library/Application Support` 8 s after the
  test exits (with a fresh TMPDIR, even run alone, on this Mac, which has vercel). With the
  fix it leaves nothing.

## Change
- Both tests set `AGENT_WORKFORCE_GH_BIN` and `AGENT_WORKFORCE_VERCEL_BIN` to non-existent
  paths inside the sandbox, so each door reports the tool as missing and starts nothing. This
  is the same pattern as `CLAUDE_BIN` and `TMUX_BIN` in the same files, and as
  `engine.dirmode-1763.test.js`.
- Each test records the files passed to `child_process.execFile` / `spawn` (wrapped before
  `server.js` loads, because `devicedoor.js` takes them at require time), and a last test
  asserts no host `gh` or `vercel` started and that `home/Library` and `home/.npm` are absent.
- Control: with the two env lines removed, the new test fails on this Mac in all three files.

## Scope decisions
- `server.connect.test.js` has the same defect (3 gh + 3 vercel starts, measured), so it is
  fixed here. Its leftover folder did NOT reproduce in my before/after run, so for this file
  the claim is "it started host CLIs", not "it leaked".
- `server.doorflight-1618.test.js` also starts them (5 + 5). First agreed that Johnny's #4298
  would take it (m2235), but this branch's first validation went red on the leak guard with
  `aw-doorflight` (not on the allowlist), and #4298 has no PR yet, so main fails every full run
  until one of us lands. It is fixed here instead (Johnny agreed, m2239): #4298 will then drop
  its doorflight change and its aw-xsite allowlist line. Measured: main leaves
  `aw-doorflight/home/Library/Application Support` 8 s after exit; the fix leaves nothing in
  two runs. Johnny noted an in-process half too (board timers writing after rm); it did not
  show in these runs, and the full-suite leak guard is the check for it.
- Rejected: adding the two bins to `engine/sandbox.js`'s half-sandbox audit. It would make
  every sandboxed board refuse to start without them, roughly 100 tests plus the browser
  check fixtures, which is a product change well beyond this card.

## Weakest part
- On a machine without gh or vercel installed (CI), the new check passes with or without the
  fix, because no host tool exists to start. It only discriminates on developer Macs, which
  is where the leak happens.
