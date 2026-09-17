# Plan: Auto-install Claude Code on Windows (win32)

## Why
A real investor (mike@mwilkes.co) could not connect Kosmos on Windows: the board showed
"we could not find Claude Code on this computer" / "We could not download Claude." Today
win32 REFUSES to download the Claude Code runner (`RUNNER_DOWNLOADS = ['darwin']`), so a
first-time Windows user must install the CLI themselves (`irm https://claude.ai/install.ps1
| iex`). Josh (2026-09-16): "this has to auto-install 100%." This slice makes Kosmos
download + verify + install Claude Code on Windows automatically, exactly as it does on Mac.

## Verified facts (2026-09-16, me, live)
- `downloads.claude.ai/claude-code-releases/latest` = 2.1.273.
- `/2.1.273/manifest.json` publishes **win32-x64** (checksum 19654006…) and **win32-arm64**
  (checksum 1257608d…), same shape as darwin-*.
- `/2.1.273/win32-x64/claude.exe` = HTTP 200, **221 MB**.
- => A VERIFIABLE binary + manifest checksum exists. We do NOT pipe a remote script to
  `iex`; we reuse Kosmos's own audited fetch→checksum→place path (connect.js), which
  verifies sha256 against the manifest BEFORE the binary is ever executed. Same trust
  posture as the Mac.

## Scope
INSTALL only. Sign-in on win32 is a SEPARATE, independently-gated slice
(`WINDOWS_SIGNIN_HOST_ENABLED = false`, connect.js) — out of scope here. After this slice a
fresh win32 user auto-installs claude.exe, then reaches the honest
`WINDOWS_SIGNIN_UNAVAILABLE_BECAUSE` state (a clear "sign in to Claude" step) instead of the
hard "We could not download Claude" dead-end. Full hands-off connect needs the sign-in slice
too (sequenced right behind this).

## Changes (ordered)
1. **engine/platform.js** — add `'win32'` to `RUNNER_DOWNLOADS` (line ~70). Rewrite the
   darwin-only rationale comment to record that a real win32 build now exists (mirroring how
   SUPPORTED/SELF_INSTALL comments were rewritten "because the port happened"). This flips
   `canDownloadRunner('win32')` → true, which un-gates download() AND auto-retires the web
   manual-install note (all three web gates key on canInstallClaude, not the platform string).
2. **engine/connect.js `platformKey(platform)`** — make it win32-aware: darwin →
   `darwin-${arch}` (unchanged); win32 → `win32-${arch}` (`os.arch()==='arm64'?'arm64':'x64'`).
   ONE source of truth (CLAUDE.md conv #5); keep it test-injectable (thread the `platform`
   param download() already carries).
3. **engine/connect.js `download()`** — add the win32 branch WITHOUT duplicating Mac logic:
   - dest filename: `claude-${version}-${plat}${win32 ? '.exe' : ''}` (the `.exe` is
     load-bearing — Windows execFile won't run an extensionless file; matches install.ps1).
   - URL leaf: `${base}/${version}/${plat}/${win32 ? 'claude.exe' : 'claude'}`.
   - guard `fs.chmodSync(part, 0o755)` off on win32 (no-op there).
   - update the comment block that currently asserts "darwin-${arch} build … on any other OS
     it would download a Mac binary" — now false for win32.
4. **engine/connect.js `installClaudeCode()` install step** — on win32, run
   `claude.exe install <targetDir>` with the target `path.join(installHome, '.local','bin')`
   so the sandbox seam (`AGENT_WORKFORCE_HOME`) and resolveBin's canonical rung agree.
   ⚠️ OPEN: confirm `claude.exe install <dir>` positional arg against the real 2.1.273 win32
   binary before finalizing (read from install.ps1, not from --help). Verify on the box.
   The post-install presence gate already resolves `claude.exe` via pathextCandidates (#570).
5. **web/index.html** — the happy-path note self-retires via canInstallClaude. Edit/remove
   the now-false `claudeInstallNote` ("Kosmos can't install Claude Code for you on Windows
   yet"). This is a rendered-surface change → needs a docs/browser-checks assertion update or
   a `Browser-check:` trailer (CLAUDE.md conv #4). Keep the generic "try again" fallback.

## Tests
- **engine/connect.test.js** — extend the fake-HTTP download suite for win32: drive
  `download(onProgress, track, 'win32')` against a fake server serving `platforms['win32-x64']`
  + `/$version/win32-x64/claude.exe`; assert the `.exe` dest name, checksum verify, reuse,
  dir-sweep.
- **engine/platform-gate-download.test.js** — INVERT the win32 arm (was: refuses; now:
  proceeds). Keep `linux` refusing as the "gate still reads the param" proof.
- **engine/platform.test.js** — `canDownloadRunner('win32') === true`.
- Win32-gating convention (memory): drive platform via the injected `platform` param
  (platformKey/download/resolveBin all take it), NOT `process.platform`, so macOS CI stays
  green. A test that truly must run ON win32 skips off-win32.
- **runners.pathext-win32-570.test.js** already pins `.exe` resolution — reference, no change.

## Verification (real box)
On the Thursday clean-box laptop (no claude.exe): first-run Connect must (1) show the ~221MB
confirm, (2) run download progress, (3) leave `%USERPROFILE%\.local\bin\claude.exe` present
(`resolveBin('claude').present` true), (4) go to the honest sign-in-unavailable state, NOT
"We could not download Claude." Also verify a checksum-mismatch (fake base) refuses without
placing a binary.

## Risk / security
Downloads + executes a vendor binary — but sha256 is verified against the manifest BEFORE
execution (connect.js existing rule), https-only, size-capped, same as Mac. Lands under
`%USERPROFILE%\.local\bin` (per-user, no admin/UAC, no Program Files ACL issue). No PATH edit
(Kosmos launches by absolute path via resolveBin).

## As-built corrections (verified against real endpoints/code, not the scoping plan)
1. **Gate split per-runner, NOT a flat flip.** `canDownloadRunner` is shared with CODEX
   (runners.js:635), which is a darwin-only tarball -- naively adding win32 to
   RUNNER_DOWNLOADS would fetch a Mac codex tarball onto Windows. Instead: kept
   `RUNNER_DOWNLOADS=['darwin']` (codex) and added `CLAUDE_DOWNLOADS=['darwin','win32']`
   + `canDownloadClaude`. connect.js (Claude) reads canDownloadClaude; runners.js (codex)
   keeps canDownloadRunner.
2. **`claude.exe install` takes a VERSION, never a directory.** Verified against the real
   vendor install.ps1: `& $binaryPath install $Target` where $Target matches
   `^(stable|latest|\d+\.\d+\.\d+...)$`. So we run `['install']` (no target dir -- the
   scoping plan's `install <dir>` would have broken it) and steer placement with env:
   set USERPROFILE (+ HOME) = installHome on win32, so the sandbox seam holds and prod is
   correct (installHome IS %USERPROFILE% in prod).
3. **No web/index.html change needed.** The board keys on `canInstallClaude`
   (now canDownloadClaude), which flips true on win32 -- so the manual-install note stops
   rendering and the confirm dialog shows the standard install copy automatically. Avoids
   the browser-check burden and keeps the slice tight.
4. Verified live: latest=2.1.273; manifest has win32-x64 (19654006…) + win32-arm64
   (1257608d…); win32-x64/claude.exe = HTTP 200, 221 MB.

## Tests (as-built, all pass on this box where platform is injected)
- platform.test.js (8/8): added canDownloadClaude/CLAUDE_DOWNLOADS coverage; updated the
  source-grep guardrail to the per-runner split (connect→canDownloadClaude, runners→
  canDownloadRunner, both not isSupported).
- platform-gate-download.test.js (4/4): Claude refusal now covers linux/aix; new test
  proves win32 PASSES the gate (reaches the version check via a fake server); codex/runners
  win32-refusal unchanged.
- engine.connect-win32-install-570.test.js (7/7): REWRITTEN to the #3159 contract --
  canInstallClaude is true on win32; guardrail is now "no Mac codex tarball onto Windows"
  + unpublished platforms refuse.
- connect.test.js: added a win32 download test (serves claude.exe, verifies checksum, .exe
  name, no chmod); serveRelease gained a `platform` option.
- Environmental note: the Mac-oriented download/install-flow suites fail identically on
  base and branch ON THIS WIN32 BOX (process.platform=win32 makes darwin-download tests
  misbehave). Verified identical failing sets. The change is darwin-transparent
  (every win32 branch guarded; canDownloadClaude(darwin)===canDownloadRunner(darwin)), so
  macOS CI is the definitive validation.

## Deferred (fast-follow, with the sign-in slice)
- The win32 manual-install note copy (`web/index.html` claudeInstallNote) + the
  server.connect.test.js `win32Stuck(canInstallClaude:false)` fixtures now describe a
  FALLBACK-only path (auto-install failed). They still pass; refresh the copy + those
  fixtures when the fallback/sign-in copy is finalized.
- The win32 auto SIGN-IN (WINDOWS_SIGNIN_HOST_ENABLED) -- separate slice; a fresh win32
  user auto-installs, then signs in via the stuck-card hatch until it lands.

## Process
Plan (this) → tests → /code-review (challenge-loop unavailable this session) → PR. Address
#3159 (do not auto-close; reporter/QA verifies on the box, incl. Thursday's clean laptop).
