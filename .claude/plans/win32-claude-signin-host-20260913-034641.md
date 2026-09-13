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
- Selection: `signinHost()` (no argument; it reads the platform pin or `process.platform`);
  darwin/linux get tmux, win32 gets the Windows host only when `WINDOWS_SIGNIN_HOST_ENABLED` (or the
  test override) is on, otherwise null (slice 1). A flow keeps its host on `owner.signinHost`;
  `killSession(owner)` uses it, or `signinHost()` when there is no flow.
- Test setters, `setRunner` style: `setSigninPlatformForTests(p)` (null = `process.platform`) and
  `setWindowsSigninHostForTests(on)`. The second REFUSES outside a `node --test` process
  (`live-execution.inTestProcess()`), so nothing but a code edit turns the host on in production.
  `resetForTests` LEAVES BOTH PINS ALONE (a suite sets them once for its file) and only kills and
  forgets the Windows host instance.
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

1. `engine/connect.test.js` as is, pinned to `darwin` ONCE AT THE TOP OF THE FILE (right after its
   requires) through `setSigninPlatformForTests`, not inside `driverTest`, so on this Windows box
   every Mac arm still exercises the tmux host via `fakeTerminal`. The tmux commands are
   ARGV-identical to main. Their ORDER differs in one harmless place: `host.open` adds one async
   hop, so a reauth test's final teardown `kill-session` can land one position later (review
   round 1). Any other suite that reaches `launchSignin` through a runner is pinned the same way
   if the comparison run shows it moved.
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
Added by review round 1, to measure alongside (i)-(vii):
- (viii) token-exchange latency: time from the pasted code reaching stdin to "Login successful."
  (the host hides the screen after a send; the driver's blank grace is 45 s, so a slower exchange
  would read "the sign-in window went blank").
- (ix) whether `auth login` re-prints "Paste code here" after an `Invalid code`, and the exact
  `Invalid code` wording (the host keys on /Invalid code/ to bring the prompt back).
- (x) which Claude Code file the box has at `~\.local\bin` (`claude.exe`, or a `.cmd` script,
  which the host refuses with the script sentence).
- (xi) the stuck card's tail and every capture never contain the pasted code or either `#` half.
- (xii) every byte `auth login` prints on stdout AND stderr between the paste reaching stdin and
  the result ("Login successful." / "Login failed" / "Invalid code"). Review round 2 probe C: a
  stderr warning 0.3 s after the send reads as an unknown screen, and a 14 s exchange then goes
  stuck at ~12 s with "Claude showed a screen we do not recognise" (not a regression: before round
  1 it said "did not work" at ~7 s; no known CLI output does this). If L-1 sees ANY such output,
  slice 3 either hides unrecognised post-send text or gives an unknown screen during `completing`
  the blank grace. No code change in this branch.

## Review log

### Round 1 (opus) on 000b911d: not converged, 1 BUG, 3 TEST-GAPs, 3 NITs

Rebased onto origin/main `c05c662d` first (clean).

- BUG 1, a slow valid code read as rejected: the kept screen never lost the prompt, so the
  driver's 6 s rejection rule fired during any token exchange longer than that. FIX: `sendCode`
  hides the kept text (the screen shows only output since the send) until an `Invalid code` line
  arrives on stderr after the send, which brings the whole screen back. Arms: a 9 s exchange never
  shows "did not work" and ends CONNECTED with one stdin line; the unit arm shows the prompt hidden
  after a send and back after `Invalid code`; the existing Invalid-code driver arm still rejects.
- TEST-GAP 2: Windows arm for a dead credential (file CONNECTED, live NONE at start), exit 0
  without the success text, live CONNECTED after, finishing through `deadCredential`.
- TEST-GAP 3: Windows arm through `start()`'s #1560 leftover-session kill (file and live both
  connected, no flow, host off): CONNECTED with zero tmux commands, the live check proven reached.
- TEST-GAP 4: unit arm for `EXIT_PIPE_GRACE_MS`: `exit` with no `close` keeps capturing until the
  grace, then drains once and fails.
- NIT 5: an extensionless resolved path starts as `<path>.exe` when that file exists; ENOENT beside
  a `.cmd`/`.bat`/`.ps1`, and EINVAL on one, both give "Kosmos can only start the Claude Code program
  file (claude.exe), and this computer has a script version it cannot start directly".
- NIT 6: every code sent is remembered as its whole string and each `#` half of at least
  `SENT_FRAGMENT_MIN_CHARS` (8), and replaced with `[redacted code]` in the capture and the stderr
  tail. Arm: a program echoing the code, whole and by halves; a two-character half is not hunted.
- NIT 7: plan drift fixed (`signinHost()`, `resetForTests` leaves the pins, the darwin pin at the
  top of the file) and "byte-identical" restated as argv-identical with the one teardown hop.

Round 2 results (c86d84db on c05c662d; same guard, runtime node 24.19, scratch APPDATA/LOCALAPPDATA/USERPROFILE):
- `engine/win32signin.test.js` 16/16, `engine/connect.win32signin.test.js` 14/14.
- Suite set vs a `git archive` of `c05c662d`, by name and first error line: base 253 pass / 80
  fail, branch 284 / 79. No new failure; the same main-only `git ls-files` archive failure; two
  `claudeaccounts` arms differ only by the scratch temp path in the message.
- Revert controls on scratch copies of HEAD, all red: BUG 1 no-hide (the 9 s arm and the unit
  hide arm); TEST-GAP 2 without `|| owner.deadCredential`; TEST-GAP 3 with a tmux fallback in
  `killSession` (both slice 1 arms); TEST-GAP 4 without the grace timer; NIT 5 without the script
  mapping; NIT 6 without sent-code redaction; and round 1's five re-run (switch on, code on a
  command line, token redaction removed, #1937 rule, tmux on Windows).
- The first run of the 9 s arm went stuck on the suite's 1.35 s blank grace (4.5x its 300 ms
  unknown grace) and its late timer signed the NEXT arm in; the arm now sets a 3 s unknown grace
  and clears its timer on teardown.
- No schtasks block log was created by any run.

### Round 2 (opus) on 2c8f13c1: no BUG, SAFETY or TEST-GAP; 3 NITs

Rebased onto `169c1a33` first (clean).

- NIT A, sent-code redaction ran after the cap and only on whole pieces (probe R1: the cap cut
  inside an echoed code and left up to 33 characters of a half readable; R3: a split echo showed a
  20-character prefix on the unfinished line). FIX: `createTextKeeper(limit, sentPieces)` redacts the
  sent pieces in `commit` BEFORE `keepNewest` and on the unfinished line in `text()`, and masks a
  partial sent piece of `SENT_PARTIAL_MIN_CHARS` (4) or more at a cut edge (the start of the kept
  text, the end of the unfinished line). `capture()` keeps a whole-piece pass for text kept before
  the send. The header and keeper comments now state exactly that, and what is not guaranteed (a
  shorter partial at a cut edge). Arms R1 (four cap shifts on one long line, two on
  newline-delimited filler, and the stderr tail) and R3.
- NIT A, R4: a wrong paste equal to the URL's `state` redacted the URL on the re-shown screen and
  the rejection arm stored the broken link. FIX: `classifyPane` reads the URL through
  `usableOauthUrl`, which treats a URL containing win32signin's `REDACTION_MARKER` as no URL, so
  every writer keeps `mem.url`. Driver arm R4.
- NIT B: plan only, L-1 item (xii).
- NIT C: EFTYPE (a direct `.ps1`) on a script extension gets the script sentence; EFTYPE on a broken
  `.exe` keeps the general sentence. Arm for both.

Round 3 results (08ff4646 on 169c1a33; same guard and scratch roots):
- `engine/win32signin.test.js` 20/20, `engine/connect.win32signin.test.js` 15/15;
  `engine/connect.test.js` unchanged (56 pass, the same 14 Windows failures main has).
- Suite set vs a `git archive` of `169c1a33`, by name and first error line: base 253 / 80, branch
  289 / 79. No new failure; the same main-only `git ls-files` archive failure; two `claudeaccounts`
  arms differ only by the scratch temp path.
- Revert controls on scratch copies of HEAD, all red (14): NIT A redaction moved back after the cap
  (R1, R3); R4 without the redacted-URL guard; NIT C without EFTYPE; plus every round 1 and round 2
  control re-run (no-hide, deadCredential, tmux fallback, grace, script mapping, sent redaction,
  switch on, code on a command line, token redaction, #1937, tmux on Windows).
- No schtasks block log was created by any run.

### Round 3 (sonnet) on 29ddd377: 1 BUG, 1 TEST-GAP

Rebased onto `da1b5a21` first (clean).

- BUG, a sent piece split by a REAL newline leaked: `maskTrailingSentPartial` only fired when the
  text ENDED with a piece prefix, and a committed line always ends with `\n`, so on the normal path
  it never fired (`warn: saw <20 chars of the state>\n<rest>\n` kept the 20 characters). Stripping
  the newline alone would still leak the MIDDLE of a piece wrapped across 3+ lines. FIX (the
  coordinator's broader decision): `maskSentPieces` treats every line boundary as a cut edge. Per
  line (a trailing CR ignored): a line that is wholly an interior piece of a sent code of 8+
  characters is masked; otherwise a line-starting suffix and a line-ending prefix of 4+ are masked.
  Each committed line's end is checked when it commits, so a wrap straddling two pushes is caught
  at both halves. The keeper docblock states the guarantee and its limits (an interior fragment
  under 8 on its own line, a partial under 4 at an edge, an interior fragment sharing its line
  with other text, and pre-send text beyond whole pieces).
- TEST-GAP: arms for one newline (one push, and straddling two pushes, the repro), two newlines
  (prefix / 15-character interior / suffix), three newlines (9/9/9/rest), CRLF, and the stderr
  tail; leak check is any 6+ prefix or suffix and any 8-character window of either half. Control
  arm: a 3-character edge, a 7-character interior line and an unrelated OAuth URL line stay intact.

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
