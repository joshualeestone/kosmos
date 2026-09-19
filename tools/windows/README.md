# The Windows launcher

`Kosmos.exe` is the file a Windows user double-clicks. It is committed here as a
binary, next to the source it was built from and a script that proves the two
match.

## Why a binary is in the tree at all

The shipped entry point used to be `Kosmos.cmd`, and **a `.cmd` file cannot carry
an Authenticode signature** — measured, not assumed: `Get-AuthenticodeSignature`
on a `.cmd` returns `UnknownError`, because a batch file has nowhere to put one.

So the certificate we are buying would have signed nothing a user ever sees: the
only file they double-click was the one file in the package that is structurally
unsignable. A PE binary can be signed. The entry point had to become one before a
certificate bought anything.

`KosmosLauncher.cs` therefore starts the same two things `Kosmos.cmd` did, with
the same arguments — the browser-open helper, then the board — and propagates the
board's exit code. It does no thinking of its own about the board. A launcher that
does is a second place for Windows-only bugs to live, and the whole point of this
file is to remove a Windows-only problem.

What it adds is how a Windows program presents itself (win32-launcher-native):

- **No console window.** It is a GUI-subsystem exe (`/target:winexe`), so a
  double-click opens nothing but Kosmos. The board runs on a hidden console,
  as the logon task's board does. A board that could not move to its logon task
  keeps serving from there. From `HANDOFF_CHECK_FOR_SERVING_AFTER_MS` (in
  `engine/win32handoff.js`) on, the launcher waits for POSITIVE proof that the board
  is serving from here -- it is listening on a TCP port, or it wrote the serve-here
  signal the launcher named in `KOSMOS_SERVE_HERE_SIGNAL` (#2983) -- both of which
  the board reaches only once it has decided to serve here rather than hand off. When
  either is proven, a box titled "Kosmos" says so and stays up as the person's handle
  on it. The signal carries a locked-down box where Windows will not let the launcher
  read its TCP table at all; it replaced a time-derived fallback that boxed a
  slow-but-successful boot, because the board runs `ensureInstalled` and its roster
  syncs before the hand-off, past any fixed time. OK stops that board and everything
  still descended from it (`taskkill /T`), and the box closes by itself if the board
  ends first.
- **Problems are a message box titled "Kosmos"**, never console text a person
  cannot see. That includes the most common mistake: double-clicking `Kosmos.exe`
  inside the zip in Explorer, which runs it from a temp folder with no
  `runtime\node.exe` beside it. That case gets its own message, telling them to
  use Extract All.
- **`Kosmos.exe --console`** is the old console behaviour, for support: the same
  status lines, the board's own output, and a window held open on failure. From
  Command Prompt, run `start /wait Kosmos.exe --console`. A GUI exe does not
  otherwise hold the prompt.
- **Never a box nobody can see.** In a non-interactive context (a service, or a
  task that runs whether or not the user is signed in), it writes to stderr
  instead. Nothing calls it that way today: the board's logon task runs `node.exe`
  directly, not this exe.
- **An icon and version information.** The icon is `assets/kosmos.ico`, generated
  by `assets/make-kosmos-ico.ps1`. FileDescription and ProductName are "Kosmos".
  CompanyName is left out until it can match the code-signing certificate's
  subject. The version is the **launcher's** own (`LauncherVersion`, currently
  5.0.0.0), not the app's. This binary is copied unchanged into every release, so
  an app version stamped into it would be wrong from the next release on.

## Kosmos's own window (#1118)

A double-click opens the board in a window of its own: titled Kosmos, with the Kosmos icon, its
own taskbar entry, and no address bar or tabs. It is the Windows twin of the Mac app
(`native-app/main.swift`, a WKWebView): a plain window hosting the system's Microsoft Edge
WebView2 Runtime, pointed at the same local board.

- **It is its own process, `Kosmos.exe --window`.** The launcher starts it where it used to start
  the browser opener, then starts the board and exits after the hand-off, as before. Closing the
  window ends only the window. The board and the agents run under their own tasks, as on the Mac.
- **Signing in** is `open-board.js`'s job, as it is for the browser (#2007). With `--print-url`
  it hands the signed-in address (a single-use boot nonce) to the window over a private pipe
  instead of opening a browser. The board answers with its persistent cookie, which the window
  keeps in its own web profile, `%LOCALAPPDATA%\Kosmos\WebView2`.
- **One window per board.** A second double-click brings the open window forward (restoring it if
  minimised) instead of opening another, and signs it in again with a fresh address from the same
  `--print-url` path, so "double-click Kosmos.exe again" (the zip's READ ME) also rescues a window
  that came up signed out. Like the Mac app's Reload, that returns the page to the board's front.
- **Boxes come after the window lets go.** Every box the window process shows, and the browser
  fallback, happen after its single-instance lock is released, so a double-click while one is up
  opens a new window rather than asking a closed one to come forward.
- **Links to other sites open in the person's browser**, whether they open a new window
  (`target="_blank"`, as the Mac app handles them, #1416) or navigate the whole window: this
  window has no Back button to return by. Only http and https are opened; anything else
  (`mailto:`, `ms-settings:`, `file:`), in a new window or this one, is refused with a box that
  says so.
- **A page that crashes is loaded again.** If WebView2 itself stops, the window closes and says
  your agents are still running.
- **`--uninstall` closes the window first**, after the person said yes, because the removal
  deletes the web profile the window holds open.
- **When this PC cannot host the window** (no WebView2 Runtime, which Windows 10 may lack; a
  partly extracted folder; a Runtime that will not start), it does what a double-click did before:
  the board opens in the default browser, and a box says why. With nobody at the desktop the
  launcher starts the opener, as it always did.

**How it reaches WebView2.** Through WebView2's COM interfaces, declared at the bottom of
`KosmosLauncher.cs`, rather than Microsoft's managed wrapper DLLs. The wrappers would need
compile-time references, which would change the build flags this README, `verify-launcher.ps1`
and `tools.win-launcher-native.test.js` pin, and every probe the tests compile beside the source.
Declared here, the source still builds with nothing but the in-box compiler. The cost is that a
declaration out of order calls the wrong method without any compile error, so
`tools.win-launcher-native.test.js` pins every declared interface's id and slot order to
`WebView2.h`.

**What ships.** Only Microsoft's native loader, `runtime\WebView2Loader.dll`, with its licence
beside it. `tools/build-kosmos-windows.sh` takes it from the `Microsoft.Web.WebView2` NuGet
package, pinned by version and sha256. `runtime\` is a folder the updater and the move already
carry whole. The WebView2 Runtime itself is part of Windows 11 and is kept up to date by Windows;
Kosmos never ships it. An open window does not block an update: Windows lets the updater rename
a running exe and a folder holding a loaded DLL (measured on the box).

## What it does as an installer (win32-installer-native)

The zip has no installer, so the launcher does an installer's job. That is a
deliberate reversal of "it does nothing more than the `.cmd` did". The line it
still holds is **one copy of every fact**. The launcher does only what needs a
Windows shell API or a person. Anything already derived in the engine is asked
of the engine's own helpers, run with the bundle's node:

- **A Start menu entry.** Every launch of a real build refreshes
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Kosmos.lnk` through IShellLink
  (in-process COM, no PowerShell). It points at this exe, starts in the Kosmos
  folder, and uses the exe's icon. "A real build" means `manifest.json` names
  `"product": "kosmos"` and `"platform": "win32"`. A scratch or partial folder is
  never advertised.
- **An entry in Settings > Apps.** The same launch writes
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kosmos`. It is per user,
  so there is no admin prompt. It carries DisplayName, DisplayIcon, DisplayVersion
  (from manifest.json), InstallLocation, UninstallString and QuietUninstallString
  (`"<exe>" --uninstall`), NoModify, NoRepair and EstimatedSize. **Publisher is
  left out** (`PublisherLegalName` is empty) until it can be the legal company
  name on the signing certificate, like AssemblyCompany.
- **`Kosmos.exe --uninstall`.**
  - It asks "Remove Kosmos from this PC? Your agents will stop." and then "Also
    delete your agents' chats and settings? Your projects and your agents'
    working folders are kept either way.". Both default to No.
  - With no person to ask (`--console`, or a non-interactive run) it does nothing
    and exits 2.
  - The removing is `app\engine\win32uninstall.js --uninstall --yes`. It switches
    off and ends the board, removes every `\Kosmos\*` task through win32job and
    win32board, then reads the task list again: a folder goes only if no Kosmos
    task is left.
  - It deletes `%LOCALAPPDATA%\Kosmos` only when that is the plain folder and not
    also the data folder.
  - On a yes it empties `%APPDATA%\Kosmos` except every Kosmos's projects and
    agents' working folders, which it names. It leaves the data folder whole if
    the list of Kosmoses can't be read.
  - It never deletes the folder it runs from, and it names everything it left.
  - The launcher then removes the shortcut, its kept-here memory and the Apps
    entry, only once nothing was left behind.
  - It ends with "Kosmos is removed. You can now delete the folder ...". It never
    schedules deleting its own folder.
- **It installs itself, like Windows software does, and asks nothing (#3286).**
  Kosmos goes where Chrome, VS Code and Slack put a per-user install,
  `%LOCALAPPDATA%\Programs\Kosmos` (the Known Folder `UserProgramFiles`), with no
  administrator prompt.
  - **First run from a folder that gets cleaned up** (Downloads, the Desktop, OneDrive,
    a temporary or zip-extract folder; the Known Folder API catches a Desktop OneDrive
    redirected), with nothing installed: a small window titled Kosmos says "Installing
    Kosmos on this computer" while `app\engine\win32relocate.js --move --end-board
    --yes` copies exactly the updater's ENTRIES there, staged beside it and renamed into
    place, and points the engine pointer at it. The launcher then starts the installed
    exe and exits. The installed copy's own launch writes the Start menu entry and the
    Settings > Apps entry, and opens the board window. The downloaded folder is left
    exactly as it was.
  - **A board already serving from that folder** (anyone who ran Kosmos from Downloads
    before this build) is ended first (`--end-board`), but only one its logon task
    started, the hand-off's own rule. It comes back from the new folder when the
    installed exe starts, because the logon task boots through the pointer. Without this
    the board would keep reading its pages from the folder about to be abandoned: a
    board's identity is its build and world, never its folder, so the new copy's hand-off
    would find "this build" already answering and leave it there.
  - **A newer copy, from anywhere, with Kosmos installed**, updates the installed copy
    instead of becoming a second install: `app\engine\win32update.js --apply --from
    <this folder> --wait`, the in-app updater's own swap with a local folder in place of
    the download. The board stops, the installed build is kept as
    `.kosmos-update\previous-<version>`, the new one is swapped in, the board must answer
    as the new build, and anything that goes wrong puts the old build back. Then the
    installed exe starts.
  - **When the updater refuses** (it swaps only the copy the engine pointer names, whose
    board its logon task started), an installed copy that is *not* the one Kosmos starts
    from is an idle leftover, and `win32relocate.js --move --end-board --replace-older`
    installs over it, keeping it whole as `.kosmos-update\previous-<version>`, where the
    in-app roll back finds it. If that refuses too, the newer copy runs from where it is
    and a note says so. That is the behaviour before #3286, it is stable (the installed
    copy hands off only to a newer copy the pointer names), and the next launch of that
    download finds the installed copy idle and replaces it.
  - **Review of #3299.** A second launch while "Installing" or "Updating" is up waits
    for it (a per-session lock, `Local\Kosmos.InstallOrUpdate`) instead of racing it,
    then hands off to the fresh install. An update whose report came back late or
    refused, but whose swap happened, is read as done: the move then finds the build
    already there (SAME). Any path that ended the board ends with one running again: if
    the installed copy will not start (antivirus, say), this copy starts the board from
    where it is. A copy Kosmos could not be pointed at is not installed (`UNANCHORED`),
    so it is the plain note and a run from here. Only a provably newer version updates or
    replaces an install: the same version from another commit has no order, so it runs
    from where it is rather than risk a downgrade. A replaced install is set aside beside
    the target under a name the sweep of interrupted moves never touches, and only that
    one previous build is kept, as the updater keeps one.
  - **The same build or an older one** starts the installed Kosmos and re-points nothing.
    The installed copy itself does nothing new. A folder somebody chose on purpose (not a
    cleaned-up one), with nothing installed, runs where it is.
  - **When Kosmos cannot install itself** it says so in a plain note, never a question,
    and runs from where it is; it tries again the next time. The old Move Kosmos / Keep
    it here question and its per-folder memory are gone; the uninstall still deletes a
    `%LOCALAPPDATA%\Kosmos\launcher\kept-here.txt` an older launcher left.
  - **The download mark travels with the copy.** Windows marks files extracted from a
    downloaded zip (the `Zone.Identifier` stream), and the copy keeps it, as copying any
    file on Windows does. It is left in place: the person already passed SmartScreen for
    that download. Unblocking the zip before extracting (the READ ME's tip) leaves no mark
    at all.
Every helper is a dry run without `--yes`, which only the launcher passes: for the
uninstall, after the person confirmed; for the install and the update, because opening
Kosmos from a folder that gets cleaned up, or a newer download, is the request. The seams tests use are `internal static` fields that only a
probe compiled beside the source in a scratch folder replaces, never environment
variables the shipped exe reads. `tools.win-installer-native.test.js` covers them:
the Start menu goes to a temp folder, the key goes under
`HKCU\Software\KosmosTest\<guid>`, and the known folders are fakes.

It targets .NET Framework 4.x, which ships in-box on every Windows 10 and 11
machine: no runtime to install, and no bundled runtime to sign.

## Why it is committed rather than built during the release

The release lane runs on a Mac. Compiling this during a cut would make a Windows
machine a dependency of every release, and the Windows box is kept stopped. So the
binary is committed and `tools/build-kosmos-windows.sh` copies it in.

That trade is only acceptable because the binary's provenance is **checkable**. A
committed binary nobody can regenerate is an opaque blob; one anybody can
regenerate from the source beside it is not.

## Verifying it

On a Windows machine, from the repo root:

```
powershell -File tools/windows/verify-launcher.ps1
```

Exit 0 means the committed `Kosmos.exe` reproduces from the committed
`KosmosLauncher.cs`.

### Why the comparison is masked

**This binary is not byte-reproducible, and that is a property of the compiler,
not a defect.** The only C# compiler on a stock Windows box is the pre-Roslyn one
shipped with .NET Framework, which has no deterministic switch. Two builds of
identical source, seconds apart, differ — measured, in three fields:

| field | why it varies |
|---|---|
| PE COFF `TimeDateStamp` | wall-clock time of the build |
| optional header `CheckSum` | derived, so it follows the timestamp |
| MVID (16 bytes) | a fresh GUID minted per compile |

Everything else — all the code — is identical. So the check builds twice, lets
those two builds say which bytes this compiler varies, and compares the committed
binary against a fresh one everywhere else.

**The mask is derived on the spot, never hardcoded.** A hardcoded offset list
would be a second copy of a fact about a compiler we do not control: a compiler
update that moved or widened those fields would leave the list masking the wrong
bytes, which is a check that hides the very difference it exists to find. The
script also refuses outright if more than 64 bytes vary between two builds, since
at that point masking would be concealing rather than normalising.

Two details in that script were bugs worth recording, because both produced a
confident wrong answer:

- **Both rebuilds must be named `Kosmos.exe`.** The output file name becomes the
  assembly's module name and is written into the metadata, so building to
  `one.exe` shifts every heap offset after it. That reported ~2300 differing
  bytes for a binary that was in fact correct, and briefly convinced me the
  committed exe did not match its source.
- **The mask is widened to whole 32-bit fields.** Two builds seconds apart
  usually differ only in the *low byte* of each timestamp. The committed binary
  was built at an arbitrary earlier time, so its copy of that field can differ in
  bytes the two reference builds agreed on. If any byte of a 32-bit field varies,
  the field varies.

The check is sensitive: changing `DefaultPort` by one in the source makes it fail
with 2 differing bytes.

## Rebuilding it

If you change `KosmosLauncher.cs`, rebuild the binary **in the same commit**:

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe ^
  /nologo /target:winexe /optimize+ /platform:anycpu ^
  /win32icon:assets\kosmos.ico ^
  /out:tools\windows\Kosmos.exe tools\windows\KosmosLauncher.cs
```

Those flags are the ones `verify-launcher.ps1` uses. If they change, they must
change in both places, and the binary must be rebuilt.
`tools.win-launcher-native.test.js` compares the two.

If you change the icon master, regenerate the icon first
(`powershell -ExecutionPolicy Bypass -File assets/make-kosmos-ico.ps1`), then
rebuild the binary: the icon is compiled into it.

## The port

`DefaultPort` in the source is a **third copy** of the board's default port — the
board owns it, the build script reads it out of `server.js`, and this is the copy
nobody can see because it is compiled in. `tools/build-kosmos-windows.sh` compares
the two and refuses the build on a mismatch, rather than shipping a binary that
opens a browser on a dead port while the board sits there working.

`PORT` in the environment still overrides it at runtime, and a malformed value is
ignored rather than fatal: the board reads `PORT` itself and applies its own
default, so refusing to start here would turn a stray environment variable into
"Kosmos is broken" on a machine where the board would have come up fine.

## Signing

Signing is a **downstream release step**, not something this directory does. The
point of the `.exe` is that a signature becomes *possible*; applying one is a
separate action with its own certificate and its own timing. Unsigned-but-signable
is the current, intended state.

Until it is signed, Windows shows "Windows protected your PC" on first run, and
the package's `! READ ME FIRST` file is what walks a person past it.
