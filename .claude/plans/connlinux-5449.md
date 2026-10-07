# Plan: Connect screen's stuck "way out" gets a Linux arm (#5449)

## Goal / Done when
On a Linux board, the Connect screen's **stuck** state names a way out a person on a
headless server can actually take, instead of the Mac-shaped "open Terminal, type
`claude`." Mac and Windows copy are unchanged. A browser check (like the Windows one)
asserts the Linux arm renders and the Mac/Windows arms still render as before.

## Background
`web/index.html` has a binary platform-copy layer: `onWindows(platform)` (true only when
the served platform is `win32`), a `windowsCopyTable()`/`windowsCopy(key)` for Windows
strings, and inline Mac strings as the default for everything else. The Connect stuck
card (`phase === 'stuck'`, around line 72915) builds its "way out" as:
- first sentence: Windows install note (gated `onWindows && canInstallClaude === false`)
  else the platform-neutral "Nothing is broken by this. You can try again...";
- sign-in hatch: Windows PowerShell line, else (`canRunClaude && !onWindows`) the Mac
  hatch "Already use Terminal? ... open Terminal, type `claude`", else nothing.

The `!onWindows` arm currently catches Linux, so a headless Linux server is told to open
a Terminal app it does not have. That is the Mac-shaped way out this card is about.

## Approach (copy only; no engine/backend changes)
1. Add `onLinux(platform)` mirroring `onWindows` (served platform `=== 'linux'`), with the
   same no-page-scope-const / no-brace constraints the other copy fns follow (the harness
   lifts them by name and counts braces).
2. In the stuck card's sign-in hatch, split the current `!onWindows` arm into Linux vs
   Mac. Linux arm (served platform linux, `canRunClaude`): a hatch whose summary and body
   name the server shell, e.g. "Have a shell on the server?" / "Sign in to Claude on the
   machine running Kosmos: open a terminal there (for a headless server, SSH in), run
   `claude`, follow its sign-in, then come back and press Try again." Mac arm: unchanged
   "open Terminal, type `claude`."
3. Keep the platform-neutral first sentence for Linux (it is already correct). The
   Windows install note stays Windows-gated and is untouched.
4. Browser check: add/extend a connect-stuck render check (mirroring the Windows
   connect-stuck coverage) that renders the stuck card with a served `linux` platform and
   asserts the Linux way-out copy appears and "open Terminal" does not; keep a Mac and a
   Windows control so the arms stay distinct.

## Verification
- Full node/web suite green (`unset KOSMOS_AGENT_TOKEN; bash tools/run-tests.sh`).
- Browser checks through the fair queue
  (`QUEUED_HEAVY_LIB=$HOME/work/agent-workforce bash tools/queued-heavy.sh ... bash tools/browser-checks.sh`).
- Challenge-loop to convergence; second-agent review (per Liu Kang).

## Scope / non-goals
- Copy only. No change to `engine/connect.js`, the download gate, or `canInstallClaude`
  (that is Kitty's #5419 / PR #5453; confirmed no file overlap, and #5453 defers this copy
  to #5449).
- Not changing Mac or Windows wording.
- Wording is a reversible call; exact Linux phrasing documented here and open to review.
