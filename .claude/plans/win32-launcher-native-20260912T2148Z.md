# win32-launcher-native: the first Windows-native slice of Kosmos.exe

Date: 2026-09-12 (UTC 21:48). Branch: `win32-launcher-native`, off `origin/main` @ `cfaa273e`.

## Why

Josh asked for the Windows install to be "Windows-native, not a straight duplicate of the
Mac installer". The read-only nativeness audit (2026-09-12, against `cfaa273e`) lists 33
findings. This branch is the first slice: the launcher binary and the README inside the
zip. It covers W-04, W-07, W-08, and the README items W-03 (text), W-09, W-23 (README
only), and W-30.

Out of scope, and later slices: the Start menu shortcut (W-20), uninstall and Apps &
features (W-27), moving the install to Programs or detecting a bad location (W-05, W-06),
the board's `web/index.html` wording (it waits for a parity audit), and the website.

## What changes

### 1. W-04: Kosmos.exe run from inside the zip

`tools/windows/KosmosLauncher.cs`. When `runtime\node.exe` is missing, the launcher now
asks where it is running from:

- **Inside the zip.** The exe's own directory is under the temp folder, or any segment of
  its path ends in `.zip`. Explorer's compressed-folder view runs a double-clicked exe
  from `%TEMP%\Temp1_<zip name>.zip\`, and 7-Zip and WinRAR also extract to `%TEMP%`. The
  message is: "Kosmos is still inside the zip file. Close this window, right-click the zip
  in your Downloads folder, choose Extract All..., then open the extracted folder and
  double-click Kosmos.exe."
- **Otherwise a partial extract.** This keeps its own message, reworded from Mac
  "unpack" to Windows "extract".

The temp folder is compared in full-path form. `%TEMP%` can be an 8.3 short name
(`C:\Users\JOSHUA~1\...`) for a profile whose name is long or has a space, and a launch
through a short path gives the exe a short location, so a plain prefix compare would
miss. `%TEMP%`, `%TMP%`, and `GetTempPath()` are all accepted, each in full-path form.
Measured on this box's .NET 4.8, the runtime already handles 8.3 names on both sides:
`GetTempPath()` returns the long form of a short TEMP, and `Assembly.Location` is long
even when the exe was launched by its short path. The first build added
`GetLongPathName`, and its revert control stayed green, so it was removed as dead code.
Removing the full-path step on either side also stayed green. The test still covers both
mixes (a short TEMP with a long exe path; a long TEMP with an exe launched by its short
path) as a behaviour pin. The control that turns that arm red is removing the temp-folder
match.

Detection runs only when the runtime is missing, as scoped. A zip fully extracted into
Temp *with* its runtime would run normally. That is W-06's bad-location case, left for
that slice.

Not measured (audit L-2): exactly what Windows 11 26100 does on a double-click inside the
zip, whether it offers "Extract all" first and which folder it uses. The detection covers
the documented `Temp1_*.zip` shape and any Temp extraction. Running the real exe from a
real zip on this box is ruled out by the safety rule below.

### 2. W-07: a GUI-subsystem exe, no console window

- Built with `/target:winexe`, so the PE subsystem is 2 (GUI), not 3 (console). A
  double-click opens no window, and the browser opening is the feedback.
- **Errors become a message box titled "Kosmos"**: a failure to start, the zip case, a
  browser that could not be opened, and a board that stopped with a non-zero exit. The
  box is WinForms `MessageBox` with visual styles and DPI awareness, so it looks like a
  current Windows dialog. It sits in its own method, so the success path never loads
  WinForms.
- **`--console`** keeps today's behaviour for support. The launcher attaches to the
  parent's console, or allocates its own window when there is none. It prints the same
  lines as before ("Starting Kosmos...") and holds the window on failure exactly as
  before. The server then shares that console, as it did.
- **Output already redirected** (a script capturing it): "redirected" means a valid
  handle for which `GetConsoleMode` fails, so a file, a pipe, and the NUL device all
  count. With `--console`, the launcher still attaches to its parent's console when the
  parent has one, and then puts the redirected handles back. When the attach fails, it
  allocates a console of its own only if stdout and stderr are not both redirected. A
  caller that captured both gets every line and no empty window that `Hold()` could wait
  on. *Corrected in round 1 (CONVENTION 3):* the first version called `AllocConsole`
  whenever the attach failed, and counted only DISK and PIPE, so a NUL stdin was not put
  back and `Hold()` blocked on a new visible console.
- **Never a message box in a non-interactive context.** If `Environment.UserInteractive`
  is false (a service, or a task running "whether the user is logged on or not", which
  gets a non-visible window station), the launcher writes to stderr and exits with the
  same code. It never blocks on a box nobody can see.

**Who calls Kosmos.exe (verified 2026-09-12):** only a person. In the repo, every
reference outside the launcher's own source, build, and verifier is a comment or a test.
The board's logon task runs `conhost.exe --headless <anchored node.exe>
<runtime>\board-boot.js`, and every agent task runs `supervisor-boot.js` the same way.
Measured read-only on this box with `Get-ScheduledTask`: 18 tasks under `\Kosmos\`, none
running Kosmos.exe, and no task anywhere whose action names Kosmos.exe. The only `.ps1`,
`.sh`, or `.cmd` files on the box that mention it are copies of the repo's build script
and verifier. So no caller needs `--console`, and the non-interactive guard is a
belt-and-braces addition.

**The hand-off is unchanged.** It uses the same `ProcessStartInfo` for `open-board.js`
(same args, same working directory, `CreateNoWindow=true` as before) and for
`app\server.js` (same args, same working directory, `UseShellExecute=false`, no stdio
redirection). The launcher still waits for the server and returns its exit code. The one
difference is the point of W-07: in GUI mode the server gets `CreateNoWindow=true`. It
then runs on a hidden console, like the opener today and the logon task's
`conhost --headless`, so it still sees a console and `isTTY` behaves as before. In
`--console` mode `CreateNoWindow` stays false, as today. Stdio is deliberately NOT
redirected to show the server's output in the box. A redirected pipe changes what the
server sees (`isTTY`). And .NET's `WaitForExit()` waits for EOF on redirected streams, so
any grandchild that inherited the write end (schtasks, a supervisor) would hang the
launcher. The box for a non-zero exit therefore says how to see the details: run
`Kosmos.exe --console`.

**Two known behaviour changes, accepted:**

- When the board serves from the launcher instead of its logon task, it runs on a hidden
  console instead of a visible window. That covers no hand-off being due (a `PORT` or
  `AGENT_WORKFORCE_*` override, or a logon task the person switched off), a hand-off that
  was tried and not confirmed, and `ensureInstalled` failing. *Changed in round 1 (BUG
  1):* in GUI mode the launcher stays the person's handle on that board. A board that
  hands off exits 0 within `HANDOFF_WORST_CASE_MS` (`engine/win32handoff.js`: the budget,
  plus a probe in flight, the port-release floor, and its last probe, 18s). If the server
  is still running after that, a box titled "Kosmos" says: "Kosmos couldn't move to the
  background, so it's running from here instead. Keep this box open while you use
  Kosmos. Click OK to stop Kosmos. To see why, run Kosmos.exe --console." OK ends the
  server and its descendants with `taskkill /T /F` and suppresses the crash box. If the
  server ends by itself, a watcher thread closes the box (WM_CLOSE, retried until it has
  returned). With `--console`, or when nobody is at the desktop, there is no box, and the
  launcher waits on the server as before. The C# constant `HandOffWorstCaseMs` is a second
  copy of the JS value, pinned equal by the test, as the port already is. The `/End` spawn
  is not in the value because it is not measured; a board that hands off later than that
  closes the box by exiting.
- A GUI-subsystem exe run from `cmd` or PowerShell does not block the prompt. The exit
  code is still set; `start /wait Kosmos.exe --console` gets it.

**Safety for this box.** The hand-off (registering or claiming `\Kosmos\board`, moving
`engine-path`) happens inside `app\server.js`, which only runs after both `File.Exists`
checks pass. When `runtime\node.exe` is missing, `Main` returns before any
`Process.Start`. That is the only state the tests run the built exe in, and a static test
pins that ordering in the source.

### 3. W-08: icon and version metadata

- `assets/kosmos.ico` (16, 32, 48, 256), generated by `assets/make-kosmos-ico.ps1` from
  `assets/Kosmos-1024-shaped.png`. That is the rounded master the `.icns` and the web
  icons come from, so the Windows icon is the same tile. The script crops it to the
  rounded tile plus its shadow margin, since Windows does not pad icons the way the macOS
  grid does. The 16, 32, and 48 sizes are 32-bit DIB entries, the most widely read form,
  and 256 is PNG, the standard for that size. The script is Windows-only (System.Drawing),
  like `verify-launcher.ps1`.
- Compiled with `/win32icon:assets\kosmos.ico`.
- `[assembly: AssemblyTitle("Kosmos")]` becomes the Win32 FileDescription, which is what
  Task Manager and SmartScreen show. `[assembly: AssemblyProduct("Kosmos")]` becomes the
  ProductName.
- **AssemblyCompany is left out on purpose.** It must match the subject of the Azure
  Trusted Signing certificate once Josh's signing lands. Guessing the legal entity now
  would show a publisher string that disagrees with the signature. **Needs Josh:** the
  exact legal name on the certificate.
- **Its own launcher version, not the app's.** `Kosmos.exe` is a committed prebuilt
  (`tools/windows/README.md`: the release lane runs on a Mac, so it copies the binary and
  never compiles it). It does not change each release, so stamping 0.6.60 into it would be
  wrong by 0.6.61. It carries `LauncherVersion` 2.0.0.0 (1 was the #2086 console launcher)
  as its AssemblyVersion and FileVersion. The product version string says "launcher 2.0",
  so nobody reads it as the Kosmos version. The app's version stays in `manifest.json` and
  the page.

### 4. README in the zip (`tools/build-kosmos-windows.sh`)

Per the audit's proposed text:

- "Extract", not "unpack".
- "sign in", not "log in".
- The inaccurate "This file came from another computer" paragraph becomes "If a box says
  'The publisher could not be verified', click Run."
- Adds the tip to Unblock the zip in Properties before extracting.
- "a certificate we have not bought" becomes "This preview is not signed yet; signed
  builds are coming."
- Suggests `C:\Users\<your name>\AppData\Local\Programs\Kosmos`, not
  `C:\Users\<name>\Kosmos`. The latter already holds `Projects` on this box (W-09).
- "Bookmarks to Kosmos don't stay signed in. Always open Kosmos from Kosmos.exe." No Start
  menu claim yet.
- Spells out the Task Scheduler location: Start, type Task Scheduler, then Task Scheduler
  Library > Kosmos.
- Drops "A window opens for a moment and closes by itself", now that W-07 removes the
  window.
- Keeps the `!` filename.

## Build and provenance

`tools/windows/README.md` documents the build, and `verify-launcher.ps1` holds the one
flag list. Both change together, to `/nologo /target:winexe /optimize+ /platform:anycpu
/win32icon:assets\kosmos.ico`. The verifier resolves the icon path from its own location.
The rebuilt `Kosmos.exe` is committed in the same commit as its source, as #2086 set up,
and `verify-launcher.ps1` must print OK on it.

## Tests

- New `tools.win-launcher-native.test.js`:
  - On every platform, it parses the committed `Kosmos.exe` PE header and resources. The
    subsystem must be 2 (GUI). The resource directory must hold RT_GROUP_ICON and RT_ICON
    entries, and the group must list 16, 32, 48, and 256. The version resource must carry
    FileDescription and ProductName "Kosmos" and no CompanyName.
  - It checks that `assets/kosmos.ico` has those four sizes, and that the verifier's flags
    match the README's documented build.
  - On Windows only, it runs copies of the built exe with `--console` in scratch folders
    with no runtime, and asserts the output and exit code 1: a `Temp1_*.zip` folder under
    a scratch `TEMP` gets the zip message; a `.zip` segment outside TEMP gets the zip
    message; a plain folder gets the partial-extract message; a folder with only a
    placeholder runtime and no `app\server.js` gets the application-missing message.
  - A static test pins that no `Process.Start` precedes the two `File.Exists` checks in
    `Main`. That ordering is what makes the runs above safe.
- `tools.build-windows-570.test.js`: its README pins (`closes by itself`, `came from
  another computer`, `double-click Kosmos.exe again. Typing http`, and the Task Scheduler
  folder line) change honestly to the new wording, and new pins cover the removed phrases
  staying absent.
- Controls, by hand edits undone afterwards or scratch copies, never git
  checkout/restore: a console-subsystem build fails the GUI assertion; a build without
  `/win32icon` fails the icon assertion; breaking the temp or zip detection in a scratch
  build fails the run tests; and reverting a README line fails its pin.

## Results (measured on the Windows box, 2026-09-12)

- **Build.** `csc` 4.8.9232.0, with the documented flags. `Kosmos.exe` is 63488 bytes
  (it was 6656), with no compiler warnings. `verify-launcher.ps1` reports OK on the
  committed binary, with 24 bytes of build metadata masked. The version resource reads
  FileDescription and ProductName "Kosmos", CompanyName empty, FileVersion 2.0.0.0, and
  ProductVersion "launcher 2.0". `make-kosmos-ico.ps1` gives byte-identical output on two
  runs (50133 bytes).
- **Tests** (node 24.19). `tools.win-launcher-native.test.js` passes 14 of 14, and
  `tools.build-windows-570.test.js` passes all its tests.
  `tools.win-open-board-2007.test.js` has two failures, identical on `origin/main`: those
  tests spawn a `#!/bin/bash` stub, which Windows cannot execute (`spawn EFTYPE`). That
  file is not touched here.
- **Controls**, each run against a scratch build via `KOSMOS_LAUNCHER_EXE_UNDER_TEST`:

  | Control | Result |
  |---|---|
  | `/target:exe` build | red on the subsystem test only |
  | build without `/win32icon` | red on the icon test only |
  | zip detection removed | red on the four inside-the-zip run arms |
  | temp-folder match removed | red on the 7-Zip Temp arm and the 8.3 arm (the `Temp1_*.zip` and `.zip`-segment arms stay green, correctly, through the segment rule) |
  | hand edit putting "Unpack" and "came from another computer" back in the README, undone afterwards | red in both test files |

  The `GetLongPathName` and full-path controls stayed green; see section 1 for why that
  code was removed or re-described.
- **Live GUI check, not a committed test.** Copies of the committed exe ran with no
  `--console` in scratch folders with no runtime and no app. Each put up a window titled
  "Kosmos", with an OK button and the exact inside-the-zip or partial-extract text (read
  back through its child windows), and started no child process. Each was then killed.
  The real hand-off path was never run.

## Review log

### Round 1 (opus, at 292d69d8): 1 BUG, 2 CONVENTION, 3 NIT. Not converged.

The coordinator rebased the branch onto `origin/main` 9ceed247 first, cleanly; main
touched none of these files.

- **BUG 1: a hand-off that does not happen served on an invisible console.** Fixed as
  decided: the launcher stays the person's handle (see "Two known behaviour changes"
  above).
  - **Constants:** `HANDOFF_WORST_CASE_MS` is exported from `engine/win32handoff.js` and
    derived from the budget and its floors. `HandOffWorstCaseMs` in the launcher is
    pinned equal to it.
  - **Box text:** exactly the text decided.
  - **Stopping and closing:** OK runs `taskkill /T /F` on the server. A watcher thread
    closes the box if the server ends first.
  - **Where it applies:** no box with `--console` or in a non-interactive run.
  - **Wording:** `server.js`'s stderr line now reads "running from this window instead"
    and is commented as visible only with `--console`.
- **CONVENTION 2: comments describing a launcher window.** Reworded in `win32handoff.js`
  (the header, the budget comment, `overriddenBy`, `skipReason`) and in `server.js` (the
  hand-off comments).
- **CONVENTION 3: an allocated console on a redirected run.** "Redirected" is now "a valid
  handle for which `GetConsoleMode` fails". There is no `AllocConsole` when stdout and
  stderr are both redirected. The plan sentence is corrected.
- **NIT 4:** the exit-code box now says to open the folder in File Explorer (and shows
  its path), click the address bar, type cmd, press Enter, then run
  `start /wait Kosmos.exe --console`.
- **NIT 5:** the README reaches `%LOCALAPPDATA%\Programs\Kosmos` through File Explorer's
  address bar, with a fallback for creating `Programs`, then pastes the copied path into
  Extract All. It no longer spells out a profile path.
- **NIT 6: the TEMP boundary.** New arms: a sibling-prefix TEMP (`...\Temp` with the exe
  under `...\Temp2\Kosmos`) and a drive-root TEMP (`C:\`). Neither may say "inside the
  zip".

**New tests:**
- **Static (BUG 1):** the one derivation, the message text, the boxed wait gated on GUI
  mode, the crash box suppressed after OK, the watcher closing the box, and
  `taskkill /T` as the only extra process start.
- **`--console`, with a copied node and a FAKE `app\server.js`** (a script the test
  writes, never the board, so no hand-off exists to reach):
  - exit code 7 is passed through, with the console launcher's lines;
  - a board still running past the worst case is neither boxed nor stopped (about 19.5s).
- **CONVENTION 3:** a relay with no console (detached) starts `Kosmos.exe --console` with
  both outputs piped and a NUL stdin.
- **NIT 6:** the sibling-prefix and drive-root arms.

**Measured, round 2:**
- **Build:** `Kosmos.exe` rebuilt the documented way, 66048 bytes. `verify-launcher.ps1`
  reports OK.
- **Tests,** run as `node --test <explicit files>` with
  `NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`: 96
  tests, 94 pass across `tools.win-launcher-native`, `tools.build-windows-570`,
  `tools.win-open-board-2007`, `engine/win32handoff`, `server.board-identity-header-570`,
  and `engine.reachable`.
  - The 2 failures are the known `tools.win-open-board-2007` bash-stub EFTYPE ones,
    unchanged from `origin/main`.
  - `tools.win-launcher-native` alone passes 20 of 20.
  - The schtasks guard logged no attempted call.
- **Controls:**

  | Control | Result |
  |---|---|
  | BUG 1 (hand edit removing the boxed wait, undone) | red on the BUG 1 static test only |
  | CONVENTION 3 (scratch build with the type-based check and unconditional `AllocConsole` restored) | red on the CONVENTION 3 arm only |
  | NIT 6, sibling (`root + "\\"` changed to `root`) | red on the sibling-prefix arm only |
  | NIT 6, drive root (the `EndsWith(":")` guard removed) | red on the drive-root arm only |

  On CONVENTION 3, the reviewer expected `Hold()` to block in ReadKey. Measured here, a
  NUL stdin made ReadKey throw instead, so the old code did not hang in that setup. It
  still allocated a console window and printed "Press any key to close this window." into
  the captured output. The first version of the arm asserted only "not killed" and stayed
  green on the reverted build; it now also asserts that the prompt is absent, and that is
  what goes red.
- **Live GUI checks, not committed tests.** Each used the committed exe, a copied node,
  and a FAKE `app\server.js` in scratch; the real server was never run.
  - A board that never ends: the "Kosmos" box appeared at 18.8s with the exact
    running-here text. Clicking OK (BM_CLICK) made the launcher exit (code 1, the
    killed child's), the fake board process was gone, and no second box appeared.
  - A board that exits 0 at 22s: the box appeared at 18.75s and closed by itself, and the
    launcher exited 0 at 22.9s.
- **Known limit, unchanged by this round:** a `--console` run whose parent has no console
  and whose outputs are both captured starts the real server with `CreateNoWindow` false.
  Node then gets a console of its own, and its output does not reach the caller's pipes.
  Nothing calls Kosmos.exe that way today.
