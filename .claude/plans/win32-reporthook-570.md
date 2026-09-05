# win32 write-half: a native-Windows report hook, node-invoked (kosmos#570)

## Problem
The self-report WRITE path cannot fire on native win32 (my #570 gate-(b) finding): the Claude
Code hook command is `bash "kosmos-report-hook.sh"`, and the Windows bundle carries no bash, no
hook script, no CLI. So a native-Windows agent has no way to say working/idle/needs_you/blocked/
stopped, and the board can only scrape (which on Windows means nothing, there is no pane). This is
the write half of the decision recorded on #570: reuse the Mac two-stage design, build ONE new
thing (a bash-free hook entrypoint), leave the state model and the record engine untouched.

## Delivery is a POST, not a local write (the resolved weakest premise)
Read the substrate: the bash hook's effect is `kosmos report <word> --auto`, which POSTs to the
board's `/api/report` with the board + agent tokens; the SERVER records the self-report on receipt
(engine/selfreport.js). So the win32 hook is a faithful CLIENT of that same route, not a
re-implementation of the record engine.

## Design
- **engine/reporthook.js** (platform-aware wiring, no caller changes):
  - `hookScriptPath(platform)`: win32 returns the node entry `kosmos-report-hook.js` beside this
    module (app/engine/ installed, engine/ source); posix returns the `.sh` as before.
  - `entryFor(scriptPath, {platform, node})`: win32 -> `"<node>" "<script>"` (node = the node doing
    the wiring, i.e. bundled runtime/node.exe on a win32 install, so no HOME is resolved and the
    module keeps its zero-dependency contract); posix -> `bash "<script>"`.
  - `MARKER` widens from `kosmos-report-hook.sh` to the stem `kosmos-report-hook`, so one dedup key
    matches both the `.sh` and the `.js` command. Back-compat: every already-wired `.sh` entry still
    reads as ours.
  - `unsafeForCommand(s, platform)`: the command-safety guard is platform-specific. Backslash is
    dangerous in sh but is the ordinary separator on win32, so the old posix guard would refuse
    every Windows path; win32 refuses `"` and `%`, and on win32 BOTH the script and node paths are
    vetted.
  - Both `ensureWired` callers (accounts.prepare, setup.sh) already pass `hookScriptPath()`, so they
    produce win32-correct wiring with zero change.
- **engine/kosmos-report-hook.js** (new, the win32 hook entry): reads the Claude Code event JSON on
  stdin, maps it to the SAME six words the bash hook uses (with the #1058 SessionStart startup-only
  source guard and the 60s PreToolUse throttle), then POSTs `/api/report` with the board+agent token
  headers. Fail-safe (always exit 0); only SessionStart says a delivery failure out loud
  (systemMessage), like the bash hook. Pure mapping + injectable transport; a `require.main` guard so
  a test never sends. Ships via the engine glob.
- **tools/build-kosmos-windows.sh**: add the hook entry to the build's refuse-loop, so a build that
  fails to stage it ABORTS rather than shipping a bundle that cannot report (the glob already stages
  it; this guarantees it).

## Rejected
- A local selfreport write on win32: wrong, delivery is a POST the server records from.
- Passing the node path as a new argument to every caller: needless churn; the node doing the wiring
  IS the bundled node on a win32 install, so `process.execPath` (injectable) is correct and callers
  stay unchanged.
- Backgrounding the POST like the bash hook: the bash hook backgrounds to survive the board bouncing
  mid-UPDATE; the Windows bundle has no update path, so that stall window does not exist. This awaits
  under a short timeout (< the hook's 15s), and a cross-platform detached child is not worth it for v1.

## Weakest premise
The exact `/api/report` behavior on a real win32 box (does the hook fire natively, does the POST land)
cannot be verified from a Mac. Everything here is Mac-unit-tested by injecting platform/node and the
fetch transport; the box's role is the real-win32 verify (Splinter is routing that). The one residual
unverifiable-from-a-Mac point is which shell Claude Code uses to run a hook on Windows: the win32
command-safety guard is the conservative superset of cmd.exe and PowerShell metacharacters, so it
over-refuses (degrading to scraping) rather than under-refusing, and can be relaxed once the box
confirms the shell.

## Tests
engine/kosmos-report-hook.test.js (event->word mapping incl the source guard + throttle, resolvePort
incl win32 uid -1, token headers, the /api/report body shape, fail-safe + loud-SessionStart,
non-loud silence, throttle skip); engine/reporthook.test.js #570 cases (platform-aware entryFor +
hookScriptPath, unsafeForCommand backslash split, win32 ensureWired all-seven + guard, MARKER stem
back-compat); a build-verify test that the hook is refused-into the zip. Full suite 4723/4723 green.

## Not in scope
No board/server change (reconcileReport + selfreport already portable and handle the received report).
The real-win32 verify. Any change to the Mac bash hook.
