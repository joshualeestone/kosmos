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
  inside it. So an old copy carrying this launcher (3.0) or later, at `D:\Kosmos-0.6.50` say, hands off
  and re-points nothing. Copies from zips already published (launcher 2.0) have no such check and still
  take the pointer when they are started (round 3, finding 7).
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

## Round 3 review (fixed in round 4)

- **Finding 1 [SAFETY]: a slow board is not a board that is gone.**
  - `win32handoff.probeBoard` now also says why: `outcome` is `answered`, `refused` (ECONNREFUSED),
    `timed-out` (the 2s `PROBE_TIMEOUT_MS` passed) or `error`. `answering` is unchanged, so no existing
    caller reads it differently.
  - One reading for the callers that take away what a running board needs: `win32handoff.boardMayBeOpen`.
    Only a refused connection is no board. A timeout, a failed look, or no answer at all may be a busy
    Kosmos board.
  - Every caller of `probeBoard`, and what a timeout does now:
    - `win32handoff.handOffToTask` (the boot hand-off, through its default probe): a timeout still
      reads as nobody answering, so it runs the task or serves here, as before. **For #2983:** the
      hand-off still reads a timeout as offline.
    - `win32board.restartHelperMain` (the detached restart helper): it waits for `answering` and an
      identity; a timeout reads as "not back yet" and it keeps polling to its own budget. Unchanged.
    - `win32relocate.relocate` (the move): a timeout, a failed look or no reason refuses: "Kosmos was not
      moved, because Kosmos may be running and did not answer in time." A board that answered keeps the
      pointer check.
    - `win32uninstall.boardOnPort`, for each of the uninstall's four looks:
      1. the first look stops with nothing read or changed ("Kosmos is still open");
      2. `waitForBoardToGo` waits through timeouts until its budget, counted both in tries and by the
         clock (a timed-out probe spends its own 2s), then counts as still open and puts the switch back;
      3. the look before the folders keeps every folder;
      4. the look after the settle wait (finding 3) names it and the result is not ok.
- **Finding 2 [BUG]: an unreadable switch is never switched off.**
  - Before anything changes, `win32board.status()` must read known and registered. Unknown, or a read
    that throws, stops with nothing changed: "Kosmos could not check whether it starts when you sign in.
    Nothing was removed. Try again in a minute."
  - `win32board.disable()` is checked. If it fails, nothing else is changed and the sentence names what
    Windows said.
  - When a switch that was on cannot be put back (the removal stopped, or the board task itself stayed
    behind), the report says it is switched off now and to turn "Start Kosmos when I sign in to Windows"
    back on in Settings. When it can be put back, a note says so.
- **Finding 3 [BUG, low]: a board still starting can register again.**
  - Once every task and folder went, the uninstall waits `REREGISTER_SETTLE_MS` (3s, from the hand-off's
    measured ~2s from boot to hand-off, where a board registers or refreshes its task). It then reads the
    whole task list again and probes once more with finding 1's rule.
  - A Kosmos task found then, or a board that may be open, is named. The result is not ok, so the launcher
    keeps the Start menu and Apps entries for removing Kosmos again.
  - **The board's registration claim** (`win32board` `CLAIM_NAME`, `board-task-claimed`) lives in
    `anchorDirFor`, `%LOCALAPPDATA%\Kosmos\runtime`. That is inside the runtime folder the uninstall
    deletes, and `win32board.remove` unlinks it first.
- **Finding 4 [TEST-GAP]: a real locked file.** `tools.win-installer-native.test.js` holds a file in a
  scratch runtime folder open with `FileShare.None` from a PowerShell child (started with the account's
  real profile, since PowerShell does not start from a scratch one). The REAL `removeFolderWithRetries`
  runs against it. The leftover is named, and the launcher probe fed that report keeps the Start menu
  entry, the Apps entry and its memory. It skips with a reason if PowerShell cannot hold the file.
  - **What it found:** `fs.rmSync`'s own `maxRetries` did not retry. With the file held, it gave up after
    4ms with EPERM on the folder (Node 26, this box), so "the delete retries while the ended processes
    let go of `node.exe`" was not true.
  - `removeFolderWithRetries` now tries again itself: one plain `rmSync` per try, on EBUSY, EPERM,
    EACCES or ENOTEMPTY, `FOLDER_DELETE_TRIES` x `FOLDER_DELETE_WAIT_MS`.
  - The held arm checks that it waited that long. A second arm lets go of the file after 1.5s, and the
    folder is deleted cleanly.
- **Finding 5 [NIT]: the compare has a time limit.** `RunEngineHelper` takes a `timeoutMs`. The two
  compares pass `compareTimeoutMs` (10s); on timeout the helper is ended and the launcher carries on as
  with no installed copy. The uninstall and the move pass `NoHelperTimeout` (0), because a delete or a
  copy cut off midway leaves half a folder. Their progress window is a follow-up, with the worst case
  below.
- **Finding 6 [NIT]: the installed copy never downgrades the pointer.** When the running copy IS
  `Programs\Kosmos`, the launcher asks `win32relocate.js --compare --from <here> --pointer`.
  `compareWithPointer` reads the pointer (`win32anchor.readPointer`) and judges with `buildVerdict`:
  - the pointed-at copy is complete and newer, or the same version from another commit: `HANDOFF <it>`.
    The launcher starts it and re-points nothing.
  - missing, incomplete, unreadable, not newer, no pointer, or the pointer names this copy: `NONE`. It
    runs here and re-points, as before.
  - The launcher never hands off to itself or to a folder without a `Kosmos.exe`, and a compare that
    cannot run or passes its limit runs here.
- **Finding 7 [NIT]:** the comment at `CompareWithInstalledCopy` and round 2's finding 4 above now say
  that only copies carrying this launcher or later hand off.

- **Round 4 results (this box).**
  - Before the rebase, with APPDATA, LOCALAPPDATA and USERPROFILE in scratch and the schtasks preload on:
    - the engine suites (uninstall, relocate, hand-off, board, re-anchor, sign-in switch): 172 of 172;
    - the launcher, installer and web suites: 59 of 59;
    - the uninstall and installer suites again after the delete-retry fix: 64 of 64.
  - `verify-launcher.ps1`: OK, after each rebuild and again after the rebase.
  - Revert controls: 73 of 73 red (21 new for round 4, and the earlier 52 restated, three with their
    find text updated), with the worktree clean afterwards and no schtasks call blocked.
  - The locked-file arm, measured: held, the removal gave up after 9.7s and named the folder; let go of
    after 1.5s, it was deleted after 1.5s.
  - `origin/main` moved twice (#2994, then #2995), so the branch was rebased once, onto `b20d495c`,
    after #2995 merged. `docs/browser-checks/README.md` and the `tools/browser-checks.sh` loop line
    conflicted, and both sides were kept: main's `render-win32-board-copy` row with #2995's sign-in
    card, this branch's `render-win32-start-at-sign-in` row, and every check name from both sides.
    `web/index.html` merged cleanly with #2995's sign-in hatch (`frPaintConnect`) and this branch's
    `machineRows` switch both present.
  - Source-extraction harnesses that read a changed file: `server.board-identity-header-570` passes.
    `tools.win-open-board-2007` has 2 failures (`spawn EFTYPE` from the opener stand-in), and an archive
    of the base fails the same 2 the same way.
  - The comparison against an archive of `b20d495c` (101 suites, full sandbox; name and first error line):
    - base 1782 tests, 154 fail; branch 1887 tests, 153 fail;
    - 0 new failures;
    - the one base-only failure is `git ls-files` in an archive;
    - 2 tests differ only by an ephemeral port (`absolute-form naming this server is routed`, and
      `tools.win-open-board-2007`'s end-to-end, which fails the same `spawn EFTYPE` way on both sides);
    - 151 shared failures;
    - no schtasks call was blocked on either side.
  - The real system was untouched afterwards: no real `Kosmos.lnk`, no real `Uninstall\Kosmos` key, no
    `KosmosTest` key, no `%LOCALAPPDATA%\Programs\Kosmos`, and `Kosmos\board` still running.

## Round 4 review (fixed in round 5)

- **Finding 1 [SAFETY]: the probes look where the board can be.**
  - `bindHost()` moved from `server.js` into `engine/bindhost.js`, the ONE reading of
    `KOSMOS_BIND_HOST`. `server.js` requires it and listens on it exactly as before; its #1112 docblock
    moved with it.
  - `win32handoff.probeBoardOnEveryAddress(port, env)` probes `127.0.0.1`, `::1`, and `bindHost(env)`
    when it names somewhere the loopbacks do not cover (not loopback, `localhost` or a wildcard). The
    probes run at once. (Round 6 corrected which bind hosts are looked on: see round 5, findings 1 and 3.)
  - The most open answer wins: a Kosmos board's answer, then a timeout, then a failed look, then a page
    that is not Kosmos, then refused. So a web page on one address never hides a board on another.
  - ~~An address nothing can listen on at all (`EADDRNOTAVAIL`, `ENETUNREACH`, `EAFNOSUPPORT`) reads as
    refused.~~ Dropped in round 6 (round 5, finding 4): it rested on "a PC with IPv6 switched off", but
    `::1` cannot be switched off on Windows (KB 929852). Only ECONNREFUSED is proof again.
  - The uninstall's every look and the move use it. **The launcher's hand-off is unchanged:** it still
    asks `127.0.0.1` alone. Noted for #2983.
  - **Known limit:** a board bound to a specific non-loopback address set only in ANOTHER process's
    environment cannot be seen from the uninstall's process. The board task's state (finding 3) is the
    backstop, and the removal still switches the task off, ends it and reads the task list back.
- **Finding 2 [BUG]: the switch is put back when the list cannot be read again.** When the board job's
  delete was not ok and the second list cannot be read, the report names the board job ("which Windows
  would not remove") and its switch goes back as it was read, with the words for either result.
  - A delete that Windows reported ok is not switched back on, because there is then no job to switch on.
- **Finding 3 [BUG]: something else on the port.** At the first look, a timeout or a failed look reads
  the board task:
  - running: the usual busy board its task started. The removal switches it off, ends it and waits,
    still fail-closed (if it does not go, nothing more is removed and the switch goes back);
  - unreadable: round 3's stop, "Kosmos is still open";
  - not proven running, timed out: "Kosmos is still open";
  - not proven running, failed look: "Another program is using port N, so Kosmos cannot tell whether it
    is still open. Restart your computer, then remove Kosmos again." A reset connection is not taken as
    "not Kosmos", because a board mid-restart resets connections too. (Round 5, finding 5, corrected this
    in round 6: `status()` never says a registered task is not running, so "another program" is said
    only when no board task is registered; a registered one gets "Kosmos could not tell whether it is
    still open".)
  - The move: a timeout still says "did not answer in time". A failed look with the task not proven
    running says the same port sentence, ending "Restart your computer, then open Kosmos again." Running
    or unreadable: "Kosmos may be running and it could not tell from which folder."
- **Finding 4 [NIT]:** the `REREGISTER_SETTLE_MS` comment now says what the code does: one more look
  catches a board that registers its task, or comes up, within 3s of the folders going.
  - **Known limit:** a slow hand-started board that reaches `ensureInstalled` after that last look can
    register its task again. Its registration claim was in the runtime folder, which is already gone, so
    nothing stops it. The person sees Kosmos at the next sign-in, and the Start menu and Apps entries may
    already be removed; running `Kosmos.exe --uninstall` from the folder removes it again.

- **Round 5 results (this box).**
  - The affected suites (uninstall, relocate, hand-off, board, re-anchor, sign-in switch,
    `server.remote-bind-1112`, `engine.reachable`), with APPDATA, LOCALAPPDATA and USERPROFILE in scratch
    and the schtasks preload on: 195 of 196.
    - The one failure, `server.remote-bind-1112` "a DECLARED reachable Host reaches a route" (500, not
      200), fails the same way on an archive of `c897c057`, before this round.
  - The real-listener arms all ran: a board on `::1` only, on `127.0.0.1` only, and on `127.0.0.2` named by
    `KOSMOS_BIND_HOST` (with the control: unnamed, it is not looked for), a non-HTTP listener and a hung
    one.
  - Revert controls: 90 of 90 red (17 new for round 5, and the earlier 73 restated, four with their find
    text updated), with the worktree clean afterwards and no schtasks call blocked.
    - The first run found one vacuous test: `probeBoard(9, '0.0.0.0')` is plain ECONNREFUSED on this box, so
      it never reached the new codes. Measured instead: port 0 gives EADDRNOTAVAIL and `0.0.0.1` gives
      ENETUNREACH. The test now uses both, and its control is red.
  - The launcher (`KosmosLauncher.cs`) did not change, so it was not rebuilt.
  - `origin/main` was still `b20d495c`, so no rebase.
  - The comparison against an archive of `b20d495c` (101 suites, full sandbox; name and first error line):
    - base 1782 tests, 154 fail; branch 1896 tests, 153 fail;
    - 0 new failures;
    - the one base-only failure is `git ls-files` in an archive;
    - 2 tests differ only by an ephemeral port (`absolute-form naming this server is routed`, and
      `tools.win-open-board-2007`'s end-to-end);
    - 151 shared failures;
    - no schtasks call was blocked on either side.
  - The real system was untouched afterwards: no real `Kosmos.lnk`, no real `Uninstall\Kosmos` key, no
    `KosmosTest` key, no `%LOCALAPPDATA%\Programs\Kosmos`, and `Kosmos\board` still running.

## Round 5 review (fixed in round 6)

- **Findings 1 [SAFETY] and 3 [BUG]: which bind hosts are looked on.**
  - One function decides: `win32handoff.bindHostProbeAddresses(env, lookup)`, read by
    `boardProbeAddresses`, read by `probeBoardOnEveryAddress`, read by the uninstall's every look and by
    the move.
  - `127.0.0.1` and `::1` are always probed. A bind host that is loopback, a wildcard or empty adds nothing.
  - An IP literal is itself, zone kept. A name is resolved with `dns.lookup(name, { all: true })`, bounded
    by `BIND_HOST_LOOKUP_TIMEOUT_MS` (5s; an unknown name answered ENOTFOUND in 67 ms here).
  - Each address is kept only when it is this machine's own (`isThisMachinesAddress`): 127/8 and `::1`;
    otherwise an interface address, compared without its zone and canonically, and a zone must name that
    interface by scope id or name. So a zoned link-local bind host is looked on with its zone (case E),
    and the same address on another adapter is not.
  - A name that does not resolve, resolves only to other machines, or whose lookup fails or times out
    adds nothing: a board could not have bound it either (`server.listen` fails). No probe crosses the
    network to another machine any more.
  - **Known limits.** A name whose lookup fails for the uninstall but succeeded for the board (a DNS
    hiccup between the two) is not looked on; the board task's state is the backstop, as for a bind
    address set only in another process's environment. Measured: this box's Tailscale adapter does not
    answer its own link-local address, so a board bound only there reads as "timed out", which stops the
    removal ("Kosmos is still open").
- **Finding 2 [BUG]: the task's board no longer hides a hand-started one.** Among Kosmos boards' answers,
  one whose `startedByTask` is not `true` (said false, or too old to say) outranks the task's board. A
  hand-started board on `::1` beside the task's board on `127.0.0.1` stops the removal before any
  schtasks call (case C).
- **Finding 4 [NIT]: the refused reading is ECONNREFUSED alone again.** EADDRNOTAVAIL and ENETUNREACH (both
  measured here, for `255.255.255.255` and `0.0.0.1`) read as failed looks: fail closed.
  - Round 5's test used port 0 for EADDRNOTAVAIL. That holds for `net.connect`, but `http.get` takes port 0
    as "no port" and asks port 80, which refused. So that arm never reached the code; only its `0.0.0.1`
    arm did. The new test found it.
- **Finding 5 [NIT]: "another program" only for a task known not registered.**
  `win32handoff.cannotTellIfOpenSentence(port, boardTask)` is the one source for both modules: "Another
  program is using port N, so Kosmos cannot tell whether it is still open." only when the board task reads
  known and not registered; otherwise "Kosmos could not tell whether it is still open." Each module adds
  its own next step (remove Kosmos again, or open Kosmos again).
- **Finding 6 [NIT]:** the uninstall's header names the every-address probe, and `boardOnPort`'s comment
  describes `unanswered` and the running-task path.
- **The controls harness.** Round 5's "the looks run one after another" control left its brackets
  unbalanced, so it went red from a syntax error, not from its test. It is replaced, and the harness now
  runs `node --check` on every JavaScript control and reports one that breaks the file as INVALID.

- **Round 6 results (this box).**
  - The affected engine suites (uninstall, relocate, hand-off, board, re-anchor, sign-in switch,
    `engine.reachable`, `server.remote-bind-1112`), full sandbox: every round 6 test passes, and the one
    failure is `server.remote-bind-1112`'s, which fails the same way on `b20d495c`.
    - The real-listener arms all ran: case C (the task's board on `127.0.0.1` and a hand-started board on
      `::1`, one port) and C2; case E on a zoned link-local address of this machine that takes its own
      connections, and E2 unzoned; case F with real DNS; `localhost` with a board on `::1`.
  - The first run of the fail-closed test found that `http.get` takes port 0 as port 80 (see finding 4);
    the test now uses `255.255.255.255`, and the hand-off suite is 58 of 58.
  - Revert controls: 100 of 100 red, none INVALID (12 new for round 6; the earlier ones restated, with
    the two tied to the dropped mapping and the old bind-host check removed), worktree clean afterwards,
    no schtasks call blocked.
  - `origin/main` moved to `aa30db6c` (#2996, the Styles tab removed). The branch was rebased onto it after
    the controls, with no conflict: `web/index.html` has neither the Styles tab nor its markers, and still
    has this branch's sign-in switch in `machineRows`.
  - After the rebase:
    - `web.win32-start-at-sign-in`, `machine.win32-autostart-570`, `web.settings-nav`, `web.url-state` and
      `web.layout-picker`: 37 of 37;
    - the browser-check gate (`tools/lib/browser-check-gate.sh`) against `aa30db6c`: exit 0 (the branch
      adds `render-win32-start-at-sign-in.js` with its `web/index.html` change);
    - `tools.browser-checks-wired`, `browser-checks-indexed`, `browser-checks-selectors` and
      `browser-checks-reason-grep`: 17 of 18. The one failure ("could not run the real grep") fails the
      same way on an archive of `aa30db6c`.
  - The launcher (`KosmosLauncher.cs`) did not change, so it was not rebuilt.
  - The comparison against an archive of `aa30db6c` (101 suites, full sandbox; name and first error line):
    - the first run was stopped by the system for low memory (other sessions on the box), before any test
      ran; it was rerun one test file at a time (`--test-concurrency=1`);
    - base 1782 tests, 154 fail; branch 1901 tests, 153 fail;
    - 0 new failures;
    - the one base-only failure is `git ls-files` in an archive;
    - 2 tests differ only by an ephemeral port (`absolute-form naming this server is routed`, and
      `tools.win-open-board-2007`'s end-to-end);
    - 151 shared failures;
    - no schtasks call was blocked on either side.
  - The real system was untouched afterwards: no real `Kosmos.lnk`, no real `Uninstall\Kosmos` key, no
    `KosmosTest` key, no `%LOCALAPPDATA%\Programs\Kosmos`, and `Kosmos\board` still running.

## Round 6 review (fixed in round 7)

- **The [BUG]: this PC's own non-loopback bind host always read as "still open".**
  - Measured (the reviewer, and again here): a closed port on this PC's own non-loopback addresses (LAN,
    Tailscale, link-local) is refused only after 2.0-2.07 s, because Windows retries the SYN after a reset;
    loopback refuses in 1-2 ms. One 2 s limit on the connect and the answer together read every such refusal
    as `timed-out`: the uninstall with nothing running stopped (A), the task's board that went on `/End`
    kept reading open for the whole wait (B), and the move always refused (C).
  - `win32handoff.probeBoard(port, host, options)`: with `options.connectTimeoutMs` the connection gets that
    long to be made, and `PROBE_TIMEOUT_MS` (2 s) starts only once it is. The new constant
    `CONNECT_TIMEOUT_MS` is 5 s. Only `probeBoardOnEveryAddress` passes it.
  - **The launcher's hand-off is unchanged.** It and the board restart call `probeBoard` with no options:
    one 2 s limit for the connect and the answer, and the same kept-alive agent, exactly as before. A test
    pins it: a hung listener still takes 2 s, and this PC's own closed port still reads `timed-out` at 2 s
    there, while the every-address look waits for the refusal. Noted for #2983.
  - **The outcomes:** `answered`; `refused` (the connection was refused, the only proof); `timed-out`
    (nothing came back in 2 s; with a connect limit, after the connection was made); `connect-timed-out`
    (new: with a connect limit, the connection was not made in 5 s); `error` (anything else). The comment on
    `PROBE_OUTCOMES` says which means what, with and without a connect limit.
  - `connect-timed-out` is a board that may be open (`boardMayBeOpen`), counts as unanswered at the first
    look like `timed-out` ("Kosmos is still open" unless the task reads running), says "did not answer in
    time" for the move, and ranks with `timed-out`.
  - **Found while testing, and fixed:**
    - a look made right after a board went away reused the kept-alive socket of the look before and failed
      at once (`error` in 0 ms) instead of being refused. A look with a connect limit now makes its own
      connection (`agent: false`);
    - this PC's host name resolves to its link-local address without a zone, which cannot be reached on its
      own; it is now probed with its interface's zone.
    - the test's socket seam was first ignored (Node's `agent: false` builds a fresh Agent that skips
      `createConnection`), so that test's look went to port 16180 and got the live board's answer to a plain
      `GET /`. Nothing was changed on the board. The seam is fixed, the test uses port 9, and it asserts its
      socket was used.
  - **The budget.** One every-address look can take `EVERY_ADDRESS_LOOK_WORST_MS` = the bind host lookup
    (5 s) + the connect (5 s) + the answer (2 s) = 12 s. The wait for an ended board was bounded at 10 s by
    the clock, which would have allowed a single slow look. Its clock bound is now `BOARD_GONE_CLOCK_MS` =
    max(10 s, 2 x (12 s + 0.5 s)) = 25 s, derived from the probe limits, so it always allows at least two
    whole looks. Looks that come back at once still end on the count bound, after about 10 s. The first
    look is one look, up to 12 s.
  - **Known limit.** This PC's Tailscale adapter does not answer its own link-local address: a board there
    reads `timed-out` after 5 s. A bind host of that address stops the removal ("Kosmos is still open"):
    fail closed.

- **Round 7 results (this box).** Every heavy step ran alone: the suites one file at a time behind a free
  memory check, then (on the coordinator's word) inside the shared `heavy-run-mutex.ps1` lock, which waits for
  free commit memory above 1.2 GB and for the other builder's step.
  - `win32handoff.test.js` 61 of 61, `win32uninstall.test.js` 49 of 49, `win32relocate.test.js` 22 of 22, full
    sandbox, no schtasks call blocked.
    - The own-address arms ran on `100.75.98.125`, where a closed port was refused after 2036 ms: A (nothing
      listening, the removal runs), A by this PC's host name, B (the task's board gone on `/End`, the removal
      runs), the hung listener (still stops it), and C (Kosmos moves).
    - The hand-off pin ran on this PC's own IPv4 address: the hand-off look still reads `timed-out` at 2 s
      there, while the every-address look waits for the refusal.
  - The test helpers choose their address with their own looks (an explicit 5 s connect limit, a port closed
    without being probed), so a control on the every-address look makes the test go red instead of skip.
  - Revert controls: 110 of 110 red, none invalid (10 new for round 7; the earlier ones restated), tree clean
    afterwards, no schtasks call blocked, every baseline green.
    - The first run was stopped by the system for low commit memory (another builder's controls were running
      too). It left one control's edit in `KosmosLauncher.cs`, which was put back by hand and checked against
      the committed blob before anything else ran.
    - Rounds 7 and 6 then ran one round per process (10 of 10, 12 of 12). Rounds 5, 4, 3, 1 and 0 ran one
      control per process inside the lock (27 baselines, then 88 of 88): `controls.cjs` saves each file's
      bytes and a restore record before editing it, and the driver restores a step the system kills, by
      hash, before the next one. None needed it.
  - The launcher (`KosmosLauncher.cs`) did not change, so it was not rebuilt.
  - The comparison against an archive of `aa30db6c` (101 suites; name and first error line), one test file
    per locked step, each in its own full sandbox:
    - base 1782 tests, 154 fail; branch 1908 tests, 153 fail;
    - 0 new failures;
    - the one base-only failure is `git ls-files` in an archive;
    - 2 tests differ only by an ephemeral port (`absolute-form naming this server is routed`, and
      `tools.win-open-board-2007`'s end-to-end);
    - 151 shared failures;
    - no schtasks call was blocked on either side.
  - The real system was untouched afterwards: no real `Kosmos.lnk`, no real `Uninstall\Kosmos` key, no
    `KosmosTest` key, no `%LOCALAPPDATA%\Programs\Kosmos`, and `Kosmos\board` still running.

## Round 7 review (fixed in round 8)

- **Finding 1 [SAFETY, present since round 5]: the real board read as "not Kosmos" on a bind host address.**
  - The real board sends its identity header only on its routed `GET /` 200 (`server.js`). A look through this
    PC's own non-loopback address is answered BEFORE routing: a 400 from `pathOf` (a Host it does not route, or a
    zoned Host `new URL` cannot parse) or a 403 from `remoteWriteGuard`, neither with the header. The
    every-address look took that for "not Kosmos", and the uninstall deleted the runtime folder and the chats
    under a live board.
  - Fixed in the engine, not `server.js` (its early 400 and 403 are the security path). In
    `probeBoardOnEveryAddress`, an HTTP answer without a Kosmos identity from any bind host address (anything
    but the two fixed loopback probes, `127.0.0.1` and `::1`) is a new outcome, `unidentified`: `answering`
    false, a board that may be open, ranked with `timed-out`. On the two loopback probes a board always routes
    the look and names itself, so a web page there is still not Kosmos.
  - It reads like a failed look: at the uninstall's first look, a board task that reads running goes on to be
    switched off, ended and waited for; otherwise `cannotTellIfOpenSentence` ("Kosmos could not tell whether it
    is still open", or "Another program" when no board task is registered). The move refuses with the same
    sentence.
  - **Known limit, fail closed:** a web service that is not Kosmos on the same port of a bind host address
    stops the removal and the move.
- **Finding 2 [NIT]: the wait for an ended board.** It stops once `BOARD_GONE_WAIT_MS` (10 s) has passed by
  the clock AND at least `BOARD_GONE_MIN_LOOKS` (2) looks were made, or on the count bound, and never later than
  `BOARD_GONE_CLOCK_MS` (25 s). Quick looks end it near 10 s again (0 s looks: 10 s; 2 s looks: 12 s), and the
  slowest looks (12 s) still get two whole looks within 25 s.
- **Finding 3 [NIT]: the look's worst case is enforced.** The answer limit is an idle timeout, so a listener
  that sent a byte every 1.5 s kept one look alive for 16.6 s. A look with a connect limit now also ends, as
  `timed-out`, by connect + answer in all, and an answer cut off before its end is not an answer.
  `EVERY_ADDRESS_LOOK_WORST_MS` is true. The launcher's hand-off look is untouched.
- **Finding 4 [NIT]: port 16180 in the tests.** The helpers default to port 9 (discard). Each of the four
  suites that probe (`win32handoff`, `win32uninstall`, `win32relocate`, `win32uninstall.realboard`) wraps
  `net.Socket.prototype.connect` so a connection to 16180 throws, and a self-test checks the refusal function
  directly and that the wrapper is installed, without ever opening a socket.
- **Finding 5 [NIT]: link-local edges.** Link-local is all of `fe80::/10` (a first group of `fe80` to `febf`);
  an unzoned link-local address is looked on through EVERY interface that has it, all at once with the same
  ranking; a scope id of 0 is no zone. `probeBoardOnEveryAddress` takes an `interfaces` seam for the tests.
- **The tests.** `engine/win32uninstall.realboard.test.js` requires the REAL `server.js` (its roots sandboxed
  first) and listens on this PC's own non-loopback address: a hand-started board stops the removal with
  nothing changed and refuses the move; with the board task running the removal switches it off, ends it and
  runs once the board goes. It skips in words when the PC has no usable address.
- ROUND-8-RESULTS-PENDING

## Follow-ups (not this slice)

- **A progress window while the uninstall runs (round 3, finding 5).** The uninstall helper has no time
  limit, by design. Its worst case, with every schtasks call using its whole 20s timeout, N agent tasks
  and k data-folder paths that will not delete:
  - a look 12s (round 7: a bind host name's lookup 5s, a connect 5s, an answer 2s); task list 20s; board
    status 20s (one shared deadline); board disable and end 40s;
  - the wait for a board that answered to go: its 25s clock bound, plus one more 12s look and a 0.5s wait;
  - each agent task's disable, end and remove: 60s;
  - board remove 20s; task list again 20s; a look 12s;
  - the runtime folder's delete retries (20 x 500ms) about 10s, and about 10s for each held data path;
  - the settle wait 3s, a last task list 20s, and a last look 12s.
  - That is about 226s + 60s x N + 10s x k: under 4 minutes with no agents, about 9 minutes with five.
    Measured schtasks calls take 0.1-0.7s, so a usual removal takes a few seconds plus the 3s settle wait.

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
