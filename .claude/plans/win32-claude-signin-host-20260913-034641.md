# win32-claude-signin-host: an honest Windows dead end, and a switched-off Windows sign-in host

Branch: `win32-claude-signin-host`, off `origin/main` `3b0e86bd` (after #2978).
Design: `C:\Users\joshu\kosmos-scripts\win32-claude-signin-design.md` (Plan agent, 2026-09-13,
written against `04e23b70`; every reference below was re-found on `3b0e86bd`). Parity audit
P0-4. This branch is design slice 1 (the ENGINE part only) and slice 2.

## Why

On Windows, `connect.launchSignin` runs `tmux new-session ...`. There is no tmux, so the spawn
fails with ENOENT and the person lands on "we could not open the window Claude signs in through",
a sentence about a window that never existed on this platform. The design measured the real
`claude.exe` 2.1.270 and found that `claude auth login --claudeai` is a plain-text program that
reads the pasted code from stdin with readline, so it can run over pipes with no console. That is
option (e). Until it is measured live (L-1, slice 3) it must not be the live path.

## Scope

### Slice 1 (engine only)

- In `launchSignin`, when no sign-in host exists for this platform (win32 while the Windows host is
  switched off), go stuck BEFORE any tmux command, with the true reason
  `Kosmos cannot run the Claude sign-in on Windows yet`. `becomeStuck` is unchanged, so
  `canRunClaude: claudeHatchAvailable()` still rides on the record.
- `killSession()` routes through the host; with no host it does nothing, so `becomeStuck`,
  `cancel` and `finishConnected` issue no tmux command on win32 either.
- The Mac is byte-identical (the tmux host issues the same argv through `run()`).
- NOT in this branch: `web/index.html`. See "Web follow-ups".

### Slice 2: the `signinHost` seam and the Windows pipe host, shipped OFF

**The seam, inside `engine/connect.js`:**

```
host.open({ claudeBin, launchDir, needsLogin }) -> Promise<{ ok, stdout, stderr, because? }>
host.capture()                                 -> Promise<{ ok, stdout, stderr }>
host.sendCode(code)                            -> Promise<{ ok, stderr }>
host.sendEnter()                               -> Promise<{ ok, stderr }>
host.kill()                                    -> Promise<void>
```

- `tmuxSigninHost`: the five tmux calls moved verbatim. `open` builds the same
  `env [CLAUDE_CONFIG_DIR=<dir> | -u CLAUDE_CONFIG_DIR] <claude> [auth login --claudeai]` argv
  (its measurement comments move with it) and runs
  `new-session -d -s kosmos-connect -x 220 -y 50 ...`. `sendCode` is the two `send-keys` calls
  (`-l -- <code>`, then `Enter`) and folds both stderrs exactly as the driver did.
- `win32SigninHost`: `engine/win32signin.js`'s `createSigninHost()`.
- Selection: `signinHostFor(platform)`; darwin/linux get tmux, win32 gets the Windows host only
  when `WINDOWS_SIGNIN_HOST_ENABLED` (or the test override) is on, otherwise null (slice 1).
- Test setters, `setRunner` style: `setSigninPlatformForTests(p)` (null = `process.platform`) and
  `setWindowsSigninHostForTests(on)`. The second REFUSES outside a `node --test` process
  (`live-execution.inTestProcess()`), so nothing but a code edit turns the host on in production.
  `resetForTests` puts both back and forgets the Windows host instance.
- The only driver change beyond routing: `becomeStuck(owner, made.because || <the tmux sentence>, ...)`
  at the open failure, so the Windows host can say something true about a program that did not
  start. The tmux host never sets `because`, so the Mac sentence is unchanged.

**`engine/win32signin.js`:**

- Spawns `<claude> auth login --claudeai` directly: no shell, no `cmd /c`, `windowsHide: true`,
  `stdio: ['pipe','pipe','pipe']`. On win32 the args are always those three, whatever
  `needsLogin` says; `needsLogin` keeps its meaning for the five driver checks that read it.
- Env: `win32launch.childEnv(process.env, null, launchDir, null)` (signature on main:
  `childEnv(baseEnv, token, configDir, cliDir, runner)`): markers stripped, `KOSMOS_AGENT_TOKEN`
  deleted, `CLAUDE_CONFIG_DIR` set or deleted (#1922).
- Keeps stdout+stderr in arrival order, decoded per stream, ANSI escapes stripped, CRLF -> LF,
  `sk-ant-[\w-]+` redacted BEFORE the cap, oldest text dropped past
  `SIGNIN_OUTPUT_LIMIT_CHARS = 64 * 1024`. Text is normalised a whole line at a time (the unfinished
  last line is normalised on each capture), so an escape or a token split across chunks is never
  half-processed; a line that outgrows the limit is committed at a non-token character, or dropped
  whole if it has none (fail closed).
- `capture()`: running -> `{ok:true, stdout:text}`; the FIRST capture after the child closes ->
  the final text with `ok:true` (so `sawLoginDone` is set from "Login successful."); every later one
  -> `{ok:false, stderr: <last 12 stderr lines> + "claude auth login exited with code N"}`, which
  feeds the unchanged #1922 rescue (`checkLive` after ~3 s of failed captures).
- `sendCode(code)` writes `code + '\n'` to stdin; the code is never on a command line and never in
  any returned text. `sendEnter()` writes nothing (auth login has no Enter-driven screen; a bare
  newline would be read as an empty code and print "Invalid code").
- `kill()` ends stdin, then `child.kill()`, once; idempotent.
- `open` failures (sync throw or async `error`, e.g. ENOENT) -> `{ok:false, because, stderr}` with an
  honest sentence and the error code, redacted.
- Convention 3: `open` spawns only when `liveExecutionAllowed()` or a test spawn seam
  (`setSpawn`) is installed; otherwise `refuseOrWarn` (throws in a test process, warns in
  production) and `{ok:false}`.
- Never logs output, the code, or a token.

**The switch.** `WINDOWS_SIGNIN_HOST_ENABLED = false`, a code constant in `connect.js` with a doc
comment, exported read-only for the ship-off control. Not an env var: an agent session can set an
env var, it cannot ship a commit. **Slice 3 flips it** in a one-line commit that also replaces the
synthesised fixtures with L-1 captures and inverts the ship-off control arm (which then asserts
the host is on), only after L-1 passes and Josh approves.

## Tests

Fake child = EventEmitter + PassThrough stdin/stdout/stderr, runs on any OS.

1. `engine/connect.test.js` as is, with `driverTest` (and the few hand-rolled flows) pinned to
   `darwin` through `setSigninPlatformForTests`, so on this Windows box the Mac arms still exercise
   the tmux host and its byte-identical argv via `fakeTerminal`. Any other suite that reaches
   `launchSignin` through a runner is pinned the same way if the comparison run shows it moved.
2. `engine/win32signin.test.js`: env (no `KOSMOS_AGENT_TOKEN`, markers stripped,
   `CLAUDE_CONFIG_DIR` set / deleted), argv (no code, no shell, no `cmd`), escape stripping, CRLF,
   the 64 KB cap, drain once then `ok:false` with the exit code, idempotent kill, redaction
   (stdout, stderr tail, open failure), code on stdin only, Convention 3 refusal.
3. `engine/connect.win32signin.test.js`, driver arms with the host forced ON:
   happy path (browser-open -> awaiting-code -> code on stdin -> `Login successful.` + exit 0 ->
   CONNECTED); #1937 reauth of a live credential, exit 0 WITH the success text finishes, WITHOUT it
   goes stuck; exit 1 with `Login failed: ...` -> stuck with the message in `tail`; `Invalid code`
   -> the rejection arm, then a second code is accepted; cancel kills the child; the 15-minute
   limit; spawn ENOENT -> stuck with an honest sentence.
4. Slice 1 arms: win32 with the host OFF issues no tmux command at all, the stuck reason is the
   Windows sentence, `canRunClaude === claudeHatchAvailable()`; and the ship-off control (no test
   override -> no spawn even with a spawn seam installed).
5. Fixture text marked "synthesised from claude.exe 2.1.270 binary strings; re-capture in slice 3".
6. `engine.reachable.test.js` EXCUSED gains the two new test setters (the #265 guard).

Revert controls (hand edits or a scratch copy, never `git checkout`/`restore` on working files),
each must go red: switch defaulting on; the code on a command line; a missing redaction; the #1937
rule; slice 1's tmux avoidance.

Suites: `connect*`, `server.connect*`, `subscription*`, `authprobe*`, `claudeaccounts*`,
`win32launch`, `win32signin`, `engine.reachable`, `one-derivation`, `fixture-discipline`,
`platform-gate-wiring`, plus `engine.runnable-not-directory` (source-reads `connect.js`: the
`becomeStuck` region, `start`/`willInstall`/`claudeHatchAvailable`/`installClaudeCode` regions,
`redirectDowngrades(` count) and `firstrun*` (drives `connect.setRunner`). Run with the
no-schtasks preload, scratch APPDATA/LOCALAPPDATA/USERPROFILE, runtime node 24.19, compared by name
and first error line against a `git archive` of origin/main.

## Web follow-ups (after `win32-board-copy` merges; NOT this branch)

- The Windows "Already use PowerShell?" hatch copy (W-13), with the Start-menu steps, shown open.
- The install note shown only when `!canRunClaude` (the "tells an installed user to install" bug).
- A Windows `frClaudeConfirmSentence`.
- A painter arm for the new stuck reason `Kosmos cannot run the Claude sign-in on Windows yet`
  (`FR_CONN_SAY` / `ACCT_FLOW_SAY`), and, once slice 3 is on, Windows wording for "the sign-in
  window closed before Claude finished" (there is no window on Windows).

## Slice 3 (needs Josh's go): L-1

Runbook is in the branch report; it signs a real account in, into a SANDBOX `CLAUDE_CONFIG_DIR`.

## Results (Windows box, runtime node 24.19, no-schtasks preload, scratch APPDATA/LOCALAPPDATA/USERPROFILE)

- `engine/win32signin.test.js` 11/11, `engine/connect.win32signin.test.js` 11/11.
- Suite set vs a `git archive` of origin/main, by name and first error line: main 253 pass /
  80 fail, branch 276 / 79. No new failure. The 79 are main's own Windows failures (runner
  download refused on win32, POSIX-only arms, cross-process flows); two differ only by the scratch
  temp path in the message. The one main-only failure is `git ls-files` in an archive, which is not
  a repository (environmental). Only `engine/connect.test.js` needed the darwin pin; no other suite
  moved.
- Revert controls, each on a scratch copy of HEAD, each red: switch defaulting on (slice 1 arm);
  the code on a command line (3 arms); redaction removed (redaction arm); #1937 rule removed
  (the WITHOUT-success arm); tmux used on Windows while off (slice 1 arm).
- schtasks block log: never created by any run (nothing reached schtasks).
- `start()` has one more `killSession()` (the #1560 leftover-session kill with no flow yet). It
  now kills through the platform's host: tmux on a Mac as before, nothing on Windows while off.

## Risks

- `resolveBin('claude')` could name a `.cmd` shim on some installs; spawning it without a shell
  fails (EINVAL), which this host reports as stuck honestly. L-1 records which file the box has.
- A leftover `auth login` after a board restart (Windows does not kill children with the parent):
  slice 4.
