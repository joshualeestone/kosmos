# win32-installer-native: the zip behaves like a per-user Windows install

Branch `win32-installer-native`, cut from `origin/main` @ `0caa1396`. That main carries #2979
(win32-launcher-native), #2984 (win32-board-copy) and #2986 (win32-board-status-2973), so the
Settings UI half of item 5 is in scope.

Source: the Windows install nativeness audit (W-06, W-20, W-21, W-22, W-27, "Bigger native
features" option 1) and the coordinator's brief `kosmos-scripts/brief-win32-installer-option1.md`.
No admin prompt anywhere: everything is per-user (HKCU, the user's Start Menu, `%LOCALAPPDATA%`).

## Decisions

### C# versus node, and why

The launcher stops being "does nothing more than the .cmd did". That reversal is deliberate and is
recorded in `tools/windows/README.md`. The split follows one rule: **C# does only what needs a
Windows shell API or a person; node does everything that is already a fact in the engine.**

| Part | Where | Why |
|---|---|---|
| Start menu shortcut (IShellLink COM) | C# | A COM interface. Node would need a PowerShell or `WScript.Shell` process, which the brief rules out. |
| Apps & features key (HKCU `...\Uninstall\Kosmos`) | C# | `Microsoft.Win32.Registry` is in-box. Node would need `reg.exe`. The launcher both writes it and removes it, so one file owns the key. |
| Known Folder detection (Downloads, Desktop), dialogs, "Keep it here" memory, relaunch | C# | The Known Folder API and message boxes are Windows APIs. The person is talking to the launcher. |
| `--uninstall` confirm questions and the final message | C# | A person at a desktop. Refused without one (see below). |
| Stopping and deleting every `\Kosmos\*` task | node `engine/win32uninstall.js` | Convention 5: `win32job` and `win32board` already own the task names, the schtasks seam, the not-found rule and the test-process refusal. A C# copy would be a second derivation that would drift. |
| Deleting `%LOCALAPPDATA%\Kosmos` and (on yes) `%APPDATA%\Kosmos` | node | The paths are `win32anchor.anchorDir` and `store.dataRootFor`, one derivation each. `projects.projectsRoot()` is the guard that keeps Projects out. |
| Move: the "serving from this folder" check, the target check, the copy | node `engine/win32relocate.js` | The copy list is `win32update.ENTRIES` (the brief says reuse it). The identity probe is `win32handoff.probeBoard`. The engine pointer is `win32anchor.readPointer`. |

The node helpers are CLIs the launcher runs with the bundle's own `runtime\node.exe`. Each is
**dry-run unless `--yes`**, the S2 CLI's shape (`win32update.cliMain`). Only the launcher passes
`--yes`, and only after the person confirmed. `--yes` stands in for `allowLiveExecution()`, which only
server.js's real start may call: the functions take `liveExecutionAllowed` and refuse without it.
Under them, `win32job.run` and `win32board.run` still refuse schtasks from any test process
(`schtasksMayRunInThisProcess`). A helper writes its outcome as plain lines to a `--report` file:
`LEFT <sentence>`, `NOTE <sentence>`, `MOVED <path>`, `SAME <path>`, `REFUSED <sentence>`. The
launcher shows those sentences. The words about a step live with the code that did it, and the
launcher parses no JSON and redirects no stdio (the server-start rule in
tools.win-launcher-native.test.js stays true).

### 1. Start menu shortcut (W-20)

- Every launch of a real Kosmos build writes `<Programs>\Kosmos.lnk`. Programs is
  `Environment.SpecialFolder.Programs`, which is `%APPDATA%\Microsoft\Windows\Start Menu\Programs`.
  The shortcut goes through IShellLinkW and IPersistFile. The target is the running exe, the working
  directory is the bundle root, and the icon is the exe, index 0.
- "A real Kosmos build" means `manifest.json` names `"product": "kosmos"` and `"platform": "win32"` at
  its top level. A scratch or partial folder is never advertised. This rule also keeps every existing
  test that runs the exe (they have no manifest) from touching the real Start Menu.
- The seam is `internal static startMenuProgramsFolder`, which only the scratch-compiled probe
  replaces.
- No desktop shortcut in this slice (follow-up).

### 2. Apps & features entry (W-27b)

- Every launch of a real build writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kosmos`
  with:
  - `DisplayName=Kosmos`, `DisplayIcon="<exe>",0`, `DisplayVersion` (manifest.json's top-level
    `version`), `InstallLocation=<root>`;
  - `UninstallString="<exe>" --uninstall`, `QuietUninstallString` the same;
  - `NoModify=1`, `NoRepair=1` (DWORD), `EstimatedSize` (DWORD, KB, the bundle's files).
- **`Publisher` is omitted.** The named constant is `PublisherLegalName = ""` in `KosmosLauncher.cs`.
  It is written only when non-empty, and a stale value is deleted while it is empty. It waits for
  Josh to give the legal company name on the signing certificate. That is the same name
  `AssemblyCompany` waits for.
- The seam is `internal static uninstallKeyParent`. The probe points it at
  `HKCU\Software\KosmosTest\<guid>`.

### 3. `Kosmos.exe --uninstall` (W-27a)

- It is handled before anything else in Main: before the runtime checks, the move offer and the
  shortcut and key refresh.
- **No person, no uninstall.** With `--console`, or with no interactive desktop, it prints a sentence
  and exits 2 having done nothing. A destructive act never runs without its confirm. So
  `QuietUninstallString` is accepted but still asks.
- The first question is "Remove Kosmos from this PC? Your agents will stop." [Yes] [No], defaulting to
  No. No stops here, having done nothing.
- The second question is "Also delete your agents' chats and settings?" [Yes] [No], defaulting to No.
- Then `node app\engine\win32uninstall.js --uninstall [--delete-data] --root <root> --report <tmp> --yes`
  runs these steps, in order, each with its own result:
  1. It reads every task in Task Scheduler's Kosmos folder from the machine's WHOLE task list
     (`win32job.kosmosFolderTasks` over `win32job.machineTaskPaths`, labelless and so the same in every
     language; an empty list is unknown). Round 1, finding 6: not the folder query, whose empty-folder
     answer is translated.
  2. It switches the board's task off and ends the board first (`win32board.disable`, `end`), so nothing
     can re-register an agent while the agents go.
  3. Each `Kosmos\agent-<key>` task: `win32job.disable`, `end`, `remove`, with `<key>` parsed by
     `launchidentity.parseKey`. That way another Kosmos's agent is reached by its own world, never
     by guessing.
  4. Any other task in the folder is **left in place and named**. Kosmos does not recognise it, so it
     does not guess.
  5. It removes the board's task (`win32board.remove`).
  6. It reads the whole list AGAIN. Gone is what that list shows, never what schtasks printed (which is
     translated). If the list cannot be read, or shows any Kosmos task at all (including one registered
     while the removal ran), both folder deletions below are **skipped and named**.
  7. It deletes `%LOCALAPPDATA%\Kosmos` (the parent of `win32anchor.anchorDir`) only when that is exactly
     the plain `<LOCALAPPDATA>\Kosmos` derivation, is neither the data folder nor overlaps it (compared
     by `realpathSync.native`, case-insensitively), is not a link, is named `Kosmos`, and holds no
     project or working folder and not the bundle root. Otherwise it is kept and named (round 1,
     finding 2: `AGENT_WORKFORCE_DATA` made it the data folder, and a No deleted the chats). The delete
     retries while the ended processes let go of `node.exe`.
  8. With `--delete-data` it empties `%APPDATA%\Kosmos` (`store.dataRootFor`) EXCEPT every Kosmos's
     projects and agents' working folders, which are kept with the folders above them and each named
     ("Your projects for the Kosmos "QA" were kept in ..."). The kept set comes from
     `worlds.envOverridesFor` for every Kosmos the registry names and every world folder on disk it
     no longer names, plus the default Kosmos's `projects.projectsRoot()` and
     `store.workersRootFor` (round 1, finding 1). **Fail closed:** a registry that exists but cannot be
     parsed, has the wrong shape, or names a Kosmos `readRegistry` drops (an unsafe id) leaves the data
     folder untouched and named. Links are removed as links or kept, never followed. Without the flag
     it says the chats were kept.
- The launcher then removes `Kosmos.lnk`, its own `kept-here.txt` and, last, the Uninstall key, but
  only when nothing was left behind (round 1, finding 9).
  - If anything was left behind, all three are **kept**, and the message says so, so the person can run
    the removal again from the Start menu or Settings > Apps.
- The second question says what goes and what stays: "Also delete your agents' chats and settings? Your
  projects and your agents' working folders are kept either way."
- The final message is "Kosmos is removed. You can now delete the folder <root>." followed by "Kosmos
  can't delete the folder it is running from, so that last step is yours."
  - It never schedules a self-delete.
  - On a partial removal it lists every sentence left behind.

### 4. Move out of Downloads, Desktop, OneDrive or Temp (W-06)

- It runs on a launch of a real build, with message boxes, after the runtime and app checks and
  before anything is started.
- The bad places are:
  - Downloads: `FOLDERID_Downloads` and `%USERPROFILE%\Downloads`;
  - Desktop: `FOLDERID_Desktop`, the Known Folder API, so a OneDrive-redirected Desktop is caught
    (this box's is `C:\Users\joshu\OneDrive\Desktop`);
  - OneDrive: `%OneDrive%`, `%OneDriveConsumer%`, `%OneDriveCommercial%`;
  - Temp: the launcher's existing `TempFolders()`.
  - The phrase in the question names the most specific one.
- The question is "Kosmos is running from your <place>. If that folder is cleaned up, Kosmos stops
  working. Move Kosmos to its own folder now?", with [Move Kosmos] [Keep it here] on a small WinForms
  dialog. MessageBox cannot label its buttons.
- **Keep it here** is remembered in `%LOCALAPPDATA%\Kosmos\launcher\kept-here.txt`, one full path per
  line, so there is one prompt per location. Closing the dialog is no answer: nothing is remembered,
  and it asks again next time.
- **Move Kosmos** runs `node app\engine\win32relocate.js --move --from <root> --to <target> --port <port> --report <tmp> --yes`:
  - The target is `FOLDERID_UserProgramFiles\Kosmos`, which is `%LOCALAPPDATA%\Programs\Kosmos`.
  - It refuses while a board from THIS folder is serving: a board answers on the port AND the engine
    pointer is inside this folder, or cannot be read. The identity header says it is a board; the
    pointer says whose.
  - It refuses when the target holds a different Kosmos (manifest version or source_sha differ), holds
    an incomplete one, or holds other files. Each refusal is its own sentence.
  - Same build already there: `SAME`, no copy.
  - Otherwise it copies exactly `win32update.ENTRIES` into a sibling staging folder, then renames it
    into place. A failed copy removes only its own staging folder. `Projects`, and anything else in
    the folder, is never copied.
  - The launcher then starts `<target>\Kosmos.exe` and exits 0. The old copy stays where it is.
  - On a refusal it shows the sentence and carries on launching from here.
- `engine-path` moves to the new folder twice over. The relocate helper anchors it right after a
  successful move (`win32anchor.ensureAnchored` with the moved `runtime\node.exe` and `app\engine`).
  Every boot of a real bundle anchors again through `win32board.anchorBundle`, called from
  `ensureInstalled` whatever state the board's task is in. Round 1, finding 3: before, only
  registering or refreshing the task anchored, so a task switched off, removed or unreadable left every
  agent starting the old copy. Anchoring re-points; it never registers, re-creates or switches on a task.
- Before staging, the helper sweeps sibling `<target>.kosmos-move-<pid>` folders whose process is gone
  (`win32orphan.pidState`, the updater lock's rule, never their age). A link with that name is removed as
  a link, never followed (round 1, finding 10).
- A target missing ANY `win32update.ENTRIES` item is incomplete and refused, naming what is missing. It is
  never "already there" (round 1, finding 5). Our own move never leaves an incomplete target, because
  it renames a whole staging folder into place.
- **The updater gets its canonical location.** `%LOCALAPPDATA%\Programs\Kosmos` is the per-user
  install folder the updater design (roadmap section 3a, option C) lacked. The S3 swap can treat it
  as ROOT. The Start menu shortcut and the Uninstall key follow whichever folder last launched, so a
  swap in place keeps both valid.
- **Known limit, stated.** A board from a bad folder is usually already serving on every later launch,
  because its logon task started it. From then on the move is refused ("running from this folder right
  now"). So in practice the offer works on the first launch of a fresh extract, which is the case W-06
  is about. Moving a running install is the updater's End, swap, Run, not this slice's.
- **A copy in a temporary place when Kosmos is already installed (round 1, finding 4).** Before the offer,
  if `MoveTarget()` holds a `Kosmos.exe`, the launcher asks `win32relocate.js --compare`:
  - `NONE`: no COMPLETE Kosmos there (a missing manifest, another product, or any ENTRIES item missing).
    The ordinary offer applies, and so does Keep it here. A compare that cannot run also falls back to
    the offer.
  - `HANDOFF`: this copy is the same build or OLDER, by `update.newer`, the updater's own comparison. An
    unreadable version is never newer. The launcher starts the installed `Kosmos.exe` and ends. This copy
    re-points nothing (no shortcut, no Apps entry, no anchor, because the server never starts), and Keep
    it here does not apply. That stops Keep, Esc, X or any by-hand run of a stale Downloads copy flipping
    everything back to it.
  - `NEWER`: this copy runs from here and re-points, which is how a v1 by-hand zip update works today
    and is no regression against main. Replacing that is the follow-up "Update Kosmos in Programs from a
    newer downloaded zip".

### 5. Start at sign-in switch (W-21a, W-22)

- The engine has `win32board.setStartAtSignIn(on)`:
  - The live-execution gate applies unless a runner is injected.
  - It reads `status()` first. Unknown refuses: never treated as on or running.
  - Not registered refuses with a sentence. Already in the wanted state is ok.
  - Otherwise `enable()` or `disable()`, then `status()` again. The answer is the state READ BACK from
    `<Settings><Enabled>`, never the one asked for.
- The route is `POST /api/machine/start-at-sign-in {on: boolean}`: 200 `{ok, on}` or 409
  `{error}`. POST inherits the cross-site guard.
- `machine.win32BoardAutostartCheck` puts `startAtSignIn: <enabled>` on the row only when
  `describe()` is known and registered. An unknown row, a missing task, or a source checkout carries
  no switch. The switched-off detail points at the switch instead of Task Scheduler.
- A task switched off is a choice, so its row is a plain OK row, "Kosmos does not start when you sign
  in", not ATTENTION (round 1, finding 12). A missing task is still ATTENTION. The Mac rows are untouched.
- In the page, `machineRows` renders a `.toggle` switch labelled "Start Kosmos when I sign in to
  Windows" (`windowsCopy('startAtSignInLabel')`) when the row carries the field. A click posts,
  then re-reads `/api/machine` and repaints: the position always comes from the engine. A failure
  shows its sentence in `#set-machine-msg`.

## Tests

- **`tools.win-installer-native.test.js`**
  - Static checks: IShellLinkW with its CLSID and IID, and no `WScript.Shell` or powershell. The key
    path and every value name. `PublisherLegalName` is empty and written only when non-empty.
    `--uninstall` is handled first, and both questions come before the helper runs. The helper runs
    with `--yes` only after them. There is no self-delete.
  - A WINDOWS_ONLY scratch-compiled probe (KosmosLauncher.cs plus a probe Main):
    - writes the shortcut into a temp Programs folder, read back by an independent reader
      (`WScript.Shell` in the TEST, never the product);
    - writes the key under `HKCU\Software\KosmosTest\<guid>`, read back with `reg query`, then
      removed;
    - checks detection with fake known folders: Downloads, redirected Desktop, OneDrive, Temp, and a
      control folder elsewhere;
    - checks the real Known Folder Desktop against `[Environment]::GetFolderPath('Desktop')`;
    - checks the kept-here memory in a temp file, and manifest version parsing (nested `node.version`
      is not the app version).
  - The real shortcut and key are checked absent before and after, as a control that the seams held.
  - The real exe: `--uninstall --console` in a scratch folder refuses, exits 2 and runs nothing.
- **`engine/win32uninstall.test.js`**, with stub runners for win32job and win32board, and scratch
  APPDATA, LOCALAPPDATA and projects:
  - every agent task (default and named world) and the board go through disable, end and remove, in
    that order;
  - an unknown task is named and left;
  - an unreadable folder, or a failed remove, keeps both folders and names them;
  - `%APPDATA%\Kosmos` is deleted only with deleteData;
  - Projects is never deleted, even when placed inside a folder being removed (that step refuses);
  - each failure is named;
  - no `liveExecutionAllowed` means a refusal with no calls; the CLI without `--yes` exits 2 and
    touches nothing.
- **`engine/win32relocate.test.js`**:
  - the ENTRIES-only copy, with Projects and a stray file not copied;
  - different, incomplete and foreign targets refuse, and the same build is `SAME`;
  - serving from here (pointer inside, or unreadable) refuses, and serving from elsewhere moves;
  - the gate and the `--yes` CLI.
- **`engine/win32board.start-at-sign-in.test.js`**: unknown and not-registered refuse; the state is
  read back; the gate. It also covers the machine row field, and the route's source shape.
- **`web.win32-start-at-sign-in.test.js`**: the lifted `machineRows` renders the switch only for a
  boolean field; the Mac row is byte-identical.
- **Browser check `docs/browser-checks/render-win32-start-at-sign-in.js`**, with a README row. Chromium
  and WebKit, fetch stubbed as in render-win32-board-copy.js. It covers the switch's rendered state,
  the click's POST body and the re-read repaint, a failure sentence, an unknown row with no switch,
  and the Mac control.
- **Updated**: `tools.win-launcher-native.test.js`. The process-start inventory now names the helper
  runner and the relaunch; the zip-README "no Start menu" pin stays, because this slice does not
  change the README.
- **Controls**: revert each guard by hand edit on a scratch copy and watch the matching test go red.
  - Projects guard.
  - Folder-skip-when-tasks-remain.
  - The `--yes` gate.
  - The unknown-state switch.
  - The manifest gate on registration.
  - The different-Kosmos refusal.
- **Suites** run with the bundle node, the schtasks preload, `KOSMOS_SCHTASKS_BLOCK_LOG`, and
  APPDATA and LOCALAPPDATA in scratch. They are compared by name and first error line against a
  `git archive` of origin/main. One heavy process at a time.
- **Launcher**: rebuilt the documented way; `verify-launcher.ps1` must say OK.

## Live-check runbook (NOT run: it uninstalls and reinstalls Kosmos on a box; needs Josh's go)

Use a Windows account whose Kosmos can be removed. Not the live fleet box, unless Josh says so. Take
a build zip from this branch (`tools/build-kosmos-windows.sh`), cut to staging first per the
release rule.

1. **Fresh extract to Downloads.** Right-click the zip, Extract All with the default folder,
   double-click `Kosmos.exe`.
   Expect: the dialog "Kosmos is running from your Downloads folder..." with [Move Kosmos] [Keep it
   here].
2. **Move.** Click Move Kosmos.
   Expect: `%LOCALAPPDATA%\Programs\Kosmos` holds exactly app, bin, runtime, Kosmos.exe,
   open-board.js, manifest.json, and the READ ME. The browser opens the board, and the Downloads copy
   is still there. `%LOCALAPPDATA%\Kosmos\runtime\engine-path` points into Programs\Kosmos.
   `schtasks /Query /TN Kosmos\board /XML` runs `board-boot.js`.
3. **Start menu.** Open Start and type Kosmos. Expect the Kosmos icon; clicking it opens the board
   (already running). Right-click it, Open file location: the shortcut's target is
   `Programs\Kosmos\Kosmos.exe` and it starts in that folder.
4. **Apps & features.** Settings > Apps > Installed apps: Kosmos, with the version from
   manifest.json, no publisher, and the size. Modify is not offered.
5. **Keep it here.** Extract a second copy to the Desktop and run it, choosing Keep it here. Run it
   again: no dialog.
   Expect: the Start menu shortcut and the Apps entry now point at the Desktop copy (last launch
   wins). Run the Programs copy again to point them back.
6. **Refusals.**
   - Run the Downloads copy again while the board serves from Programs: `SAME` goes straight to
     Programs.
   - Extract an older or newer zip to Downloads and choose Move: the "different Kosmos" sentence, and
     it carries on from Downloads.
7. **Start at sign-in switch.** Settings > This computer:
   - Switch off: Task Scheduler shows Kosmos\board Disabled, and the row re-reads as off.
   - Sign out and in: no board.
   - Switch on and sign out and in: the board is back.
8. **Uninstall keeping chats.** Settings > Apps > Kosmos > Uninstall. Answer Yes, then No.
   - Expect "Kosmos is removed. You can now delete the folder ...Programs\Kosmos."
   - `schtasks /Query /TN Kosmos\` finds nothing. `%LOCALAPPDATA%\Kosmos` is gone, `%APPDATA%\Kosmos`
     is still there, and `%USERPROFILE%\Kosmos\Projects` is untouched.
   - The Start menu entry and the Apps entry are gone, and no `node.exe` from Kosmos is running.
9. **Reinstall.** Extract the zip to `%LOCALAPPDATA%\Programs\Kosmos` (no dialog) and run it.
   Expect: the board opens with the old agents' chats, the tasks are re-registered, and both entries
   are back.
10. **Uninstall deleting chats.** Uninstall and answer Yes, then Yes.
    Expect: `%APPDATA%\Kosmos` is emptied except each Kosmos's `worlds\<id>\projects` and `...\workers`
    (make a second Kosmos first, with a project in it, to see this). The message names each kept
    folder, `%USERPROFILE%\Kosmos\Projects` is untouched, and the message names the folder to delete.
11. **Partial failure (optional).** Make a `\Kosmos\agent-x` task undeletable, for example by
    changing its ACL, then uninstall.
    Expect: the message names the task and the kept folders, and the Apps entry is kept.

Checks 1 to 11 all need Josh's go (steps 8 to 11 destroy data on the box).

## Results (2026-09-13, this box)

- **Launcher:** rebuilt the documented way (LauncherVersion 3.0.0.0). `verify-launcher.ps1` says OK:
  24 metadata bytes vary, and the masked hashes are equal.
- **Comparison.** Both runs used the bundle node `v24.19.0`, the schtasks preload, and APPDATA and
  LOCALAPPDATA in scratch. The baseline is a `git archive` of `origin/main` @ `0caa1396`. Results
  are compared by test name and first error line.
  - Run 1 covered 75 Windows, machine, browser-check and inventory suites. Main: 1110 tests, 93 fail.
    Branch: 1161 tests, 94 fail.
    - Two branch-only reds, both caused by this branch and both fixed in 18ea5d74:
      - The `tools/browser-checks.sh` edit glued `render-sound-master-2436render-build-marker-2066`
        together.
      - `machine.win32-autostart-570` pinned the old "Task Scheduler" sentence.
    - One branch-only pass, `git ls-files`, flaked on the baseline archive, which is not a repo.
    - One reason differed only by an ephemeral port.
  - Run 2 covered 16 source-extraction and route harness suites plus the two fixed ones, 547 tests each
    side, 50 fail each side. It found no differences; one reason differs only by a port.
  - Neither run blocked a schtasks call.
- **Controls:** 19 of 19 revert controls red. The worktree was clean afterwards (restores checked
  by hash). One first-draft control was vacuous and was replaced: "answer the asked state" is
  equivalent after the read-back refusal, so the control now removes the refusal itself.
- **The real system was untouched after every run:** no real `Kosmos.lnk`, no real
  `Uninstall\Kosmos` key, no `KosmosTest` key, no `%LOCALAPPDATA%\Programs\Kosmos`, and
  `Kosmos\board` still running.
- **The browser check was not run here** (no Playwright on this box). CI runs it in Chromium and
  WebKit; it is allowlisted in `.github/workflows/browser-checks.yml`.

## Round 2 review (fixed in round 3)

- **Finding 1 [SAFETY]: `win32board.anchorBundle` guards.** With no injected anchorer it throws in a
  test process (the rule `win32relocate.js` `anchorTo` has). Outside a test it refuses unless live
  execution is armed (`server.js` arms it at 13181, before `ensureInstalled` at 13298).
- **Finding 2 [BUG]: never delete a folder while a Kosmos board answers.**
  - The launcher passes its port (`BoardPort()`, the one derivation it already had, now shared with
    Main) to `win32uninstall.js --port`.
  - Before anything is read or changed, the helper asks that port with `win32handoff.probeBoard`.
  - A Kosmos board that says its logon task did NOT start it, or is too old to say and Task Scheduler
    does not show the task running, stops the removal with nothing changed: "Kosmos is still open.
    Close Kosmos, then remove it again."
  - Something on the port that is not a Kosmos board (no identity header) does not stop it.
  - After the board task is switched off and ended, the helper waits for the board to stop answering,
    for `BOARD_GONE_WAIT_MS`: `FOLDER_DELETE_TRIES x FOLDER_DELETE_WAIT_MS` (10s), the existing budget
    for exactly this process leaving. If it still answers, no agent task is removed and no folder
    deleted.
  - The board task's switch is then put back to the position read before (`win32board.status()`):
    back on only if it was on. That is the honest option, because the removal has changed nothing else,
    and leaving the task silently off would change what happens at the next sign-in for a removal that
    did not happen. If it cannot be switched back, the report names it and says where to turn it on.
  - A board that answers when the folders would go keeps every folder.
  - There is no existing live-gated stop for a board process by pid: `win32stop` ends agent sessions
    and `win32handoff` stops nothing. So the helper refuses rather than inventing a killer.
- **Finding 3 [BUG]: one build verdict.** `win32relocate.buildVerdict(mine, theirs)` is read by both
  `compare` and `relocate`:
  - `same` (version and source_sha): compare hands off; relocate says already there.
  - `installed-newer` (`update.newer`): compare hands off; relocate refuses.
  - `this-newer`: compare says run here; relocate refuses.
  - `rebuilt` (the same readable version from another commit): compare says run here, which staging
    verification of a rebuilt candidate needs; relocate refuses.
  - `unreadable`: compare hands off; relocate refuses.
  - **Prerelease:** `update.newer` reads only `x.y.z`, so `0.6.62-rc.1` against `0.6.61` is
    `unreadable`. A prerelease copy hands off to an installed Kosmos and never re-points over it.
    Kosmos releases carry plain `x.y.z` versions today.
- **Finding 4 [BUG]: from any folder.** `KosmosLauncher.cs` `CompareWithInstalledCopy` runs the
  verdict wherever the running copy is, when `MoveTarget()` holds a `Kosmos.exe` and this copy is not
  inside it. So an old copy at `D:\Kosmos-0.6.50` hands off and re-points nothing.
  `OfferToMoveFromTemporaryPlace` (the move question) is still asked only from a temporary place.
- **Finding 5 [NIT]:** the data folder, and the runtime folder, are kept and named when a kept
  project or working folder IS that folder or holds it, compared by real path, case-insensitively,
  with separators normalised.
- **Finding 6 [NIT]:** a plain file in `<data>\worlds` (`desktop.ini`) is skipped. A stray folder
  with an unsafe name still fails closed. `worlds.js` writes no temporary folder there (its only
  temporary file is the registry's own, in the data folder), so there is no pattern to share.
- **Finding 7 [NIT]:** the data-folder walk collects EVERY path that would not delete, keeps tidying
  the folders after the first failure, and names them up to `MAX_NAMED_LEFTOVERS` (10), then
  "and N more".
- **Finding 8 [NIT]: the merge with S3.** `win32-update-apply` merges first, and this branch rebases
  after it, not pre-merged. Two conflict hunks are expected in `engine/win32board.js`: next to
  `bundleRoot`, where this branch adds `isKosmosBuildRoot` and `anchorBundle`, and in `module.exports`.

- **Round 3 results (this box).**
  - Engine suites 154/154 and launcher/installer/web suites 49/49, with APPDATA, LOCALAPPDATA and
    USERPROFILE in scratch and the schtasks preload on.
  - `verify-launcher.ps1`: OK.
  - Revert controls: 52 of 52 red (14 new for round 3, and the earlier 38 restated), with the worktree
    clean afterwards.
  - The comparison against an archive of `feb30b80` (101 suites; name and first error line):
    - base 1774 tests, 154 fail; branch 1863 tests, 153 fail;
    - 0 new failures;
    - the one base-only failure is `git ls-files` in an archive;
    - 2 tests differ only by an ephemeral port;
    - `tools.win-staging-verify` "never over an existing record" differed under load. Run alone it
      fails the same way on both sides (`spawnSync bash ENOENT`).
  - No schtasks calls were blocked.
  - The anchor's test-process guard asks `win32job.schtasksMayRunInThisProcess()`, not
    `liveExec.inTestProcess()`: `win32board.test.js` (#2973) forbids a second copy of that rule in the
    board, and the shared answer also covers a board a test spawned.

## Follow-ups (not this slice)

- **Once S3 (`win32-update-apply`) has merged:** the uninstall refuses while an update journal is
  unfinished, so it cannot delete a runtime or a folder that a half-applied swap still needs.

- **Update Kosmos in Programs from a newer downloaded zip.** Today a NEWER copy running from a temporary
  place runs from there and re-points (round 1, finding 4). The follow-up reuses S3's
  `engine/win32apply.js` (stop, swap, restart, roll back; branch `win32-update-apply`) with that copy as
  the staged source, instead of building a second swap. No swap is built in this PR.

- A desktop shortcut offer (W-20, the once-only question).
- A Settings > This computer "Remove Kosmos from this PC..." button (W-27a).
- A progress window while the uninstall and the move run (today: no window for a few seconds).
- `Publisher` and `AssemblyCompany` once Josh names the certificate's legal entity.
- Moving a running install, which is the updater's End, swap, Run.
- The zip README and the board's interim copy (S7, Settings "Opening Kosmos", not signed in) can
  now say "open Kosmos from the Start menu" and "remove it from Settings > Apps". That copy pass is
  held until this ships to users.
- Uninstall key: `InstallDate`, and an AppUserModelID if a tray icon lands.
