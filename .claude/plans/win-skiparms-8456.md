# kosmos#8456: Windows arms for the 14 tests that skipped on how they set up

**Posture:** production

## Done looks like
Each of the 14 tests whose `skipOnWin32` reason named kosmos#8456 runs on a Windows host and passes, checking the
same thing its Mac arm checks through the Windows mechanics (Task Scheduler, the agent process, taskkill), and no
`skipOnWin32` reason names #8456 any more. The three files are already selected by `tools/windows-tests.js`
(`discover.adopt.test.js` in `ALSO`; `server.test.js` and `server.disconnect-stop-2570.test.js` in `ALSO_ROOT`), so
the Windows CI job runs them with no list change.

## Shared fixture changes (test-support/jobfixture.js)
- `watchScheduler(fn)`: sees every schtasks call at the stand-in Task Scheduler before it answers, and may answer it
  itself (`{ ok:false, out:'ERROR: Access is denied.' }` makes an /End fail). Module-level, so it survives the fresh
  stand-in each `jobPath` installs; returns its own undo.
- `win32Step(file, args)`: answers what a Windows act YIELDS to engine/remove.js's runner (win32job's step forms,
  win32stop.endSteps): `schtasks.exe` from the stand-in, `taskkill.exe` from the process table; null otherwise.
- `win32Processes()`: a stand-in process table behind win32stop's three seams (setLive through the real
  win32live.byName join, setRunner for taskkill, setAlive for the look-again). `start(name)`, a stand-in `/Run` while
  installed, `taskkill`, `survive(name)` (a kill that answers SUCCESS and does not take), `clearSurvivors()`, `pidOf`,
  `calls`, `stop()`. A per-turn agent (codex, gemini, grok, antigravity) is answered from the codex live list in
  win32codexlive's row shape, never from the `claude agents --json` stand-in (review round 1).

## The 14

| Test | What it checks | Windows arm |
|---|---|---|
| 2570: really stopped, account disconnected | job disabled then unloaded, session killed, looked at again | `/Change /DISABLE` before `/End` at the stand-in; `taskkill /PID <pid> /T /F`; `alive <pid>` after the kill |
| 2570: stopped agent is on the removed list | the record the answer promises | same running agent (process table); removed.json read |
| 2570: DELETE door honours stopAgents | stop + delete, no restore promise | same |
| 2570: OpenAI route stops its own agents | same on the openai door | same, codex runner |
| server: create route answers a real creation | outcome, steps, job step, job loaded, files | job step is "start again at every login"; `/Create` then `/Run` for the agent's task; the supervisor is the real anchored boot shim (real win32anchor into the sandbox, no node copy), on disk and named on the task line (real-path compare) |
| server: removal routes ask, remove, put back | question, removal, off the board, removed list, restore re-enables | agent started by the stand-in `/Run`; ended via the table; re-enable is `/Change /ENABLE` at the stand-in |
| server: #2615 gone account folder | accountFolderGone false then true | agent running in the table; removal REMOVED |
| server: removed list gives only what it draws | allowlist of fields | control as on Linux: label is the task name, plist null |
| server: card name differs from session | removed agent leaves board, counts agree | the roster's session runs in the table under its roster name |
| server: model route writes AND restarts | model written, window closed, job relaunched | taskkill of the agent's pid and the task's `/Run`, through remove.js's runner via win32Step; the stand-in /Run writes the supervisor state file the restart's "came up" check reads |
| server: #2019 restart cause | cause threaded, bodyless default | same restart path |
| server: disabled but will not unload | partial, "still running", on removed list | stand-in refuses the task's `/End` (watchScheduler); asserts `/Change /DISABLE` came before that `/End` |
| adopt: #1349 project block before start | file read at the moment of start | read when the stand-in is asked to `/Run` the task |
| adopt: #1363 rules and connector words | same | same |
| server: a half-removed agent stays on the board (15th, review round 1) | partial, recorded not stopped, card kept | it never skipped, but passed on Windows only because the live list could not be read: now the agent runs in the process table and the stand-in refuses the task's `/End`, so a removal that went on past it would end the process and answer REMOVED |

## Decisions
- Watch the stand-in rather than create.setRunner on Windows for the adopt tests: Windows never calls that runner to
  start an agent. Rejected: reading at `/Create` (stricter, but the card asks for the start). Would change my mind: a
  Windows start that registers and runs in one call.
- The anchored supervisor: use the real `win32anchor.ensureAnchored` with node pointed at the anchor's own path (its
  copy-onto-itself guard skips the 92 MB copy). Rejected: changing the stand-in's anchorer for every test (too broad).
- `/End` at the stand-in does not end the agent's process: remove.js ends that separately with taskkill, which is the
  act the Mac's kill-session pairs with.

## Weakest part
The process table's supervisor state file names the TEST process's pid, because the restart's "did it come up" check
(`win32orphan.pidAlive`) has no seam on that path. So the restart arms prove the state file was rewritten with a new
session, not that a separate process came up. The codex list is stood in at win32live's `codexLive` seam, so how
`win32codexlive` decides a codex agent is live is not exercised, and a mutation of only that seam's DEFAULT passes
(measured); a byName that drops the codex list fails the OpenAI arm (measured).

## Review round 2
- The stand-in Task Scheduler tracks which tasks are running: a task runs from its `/Run` to its `/End` or `/Delete`,
  and a `/Run` on a running task starts nothing (IgnoreNew, as win32job.taskXml registers every task). A restart that
  skipped its `/End` now gets no new agent and answers PARTIAL. `/End` on a task that is not running answers "is not
  running", which win32job.end reads as done.
- Negative control for the restart's "did it come up" check, inside the #2019 test: `procs.neverComesUp(name)` makes
  the task run with no supervisor (no ownership row, no state file) and the restart must answer `partial`. A
  `loaded` that always answers true fails it. The model-route arm alone does not catch that; the control does.
- Every Windows removal arm asserts the agent's process is gone from the table afterwards.
- The round-trip test's first, engine-direct removal is a dry run on a Mac (no runner). remove.js's dry run does not
  reach win32job or win32stop (documented in its header), so on Windows the stand-ins make it a dry run: the task's
  acts answer SUCCESS without acting and the kill does not take. Without that the agent was stopped before the DELETE.

## Verified
Each changed file on this box with and without the preload, stdin closed, and with TEMP/TMP set to an 8.3 short
path. Negative controls: skipped look-again, no-op disable, no-op enable, no taskkill on restart, no boot shim written,
project block written after the start, and a task line naming another file: each failed its arm.

## Review round 3
- Restore on Windows: after the task's `/ENABLE`, a `/Run` for it and the agent running again (`procs.pidOf`).
- Removal arms with a task (round trip, #2615, allowlist) assert at the stand-in that the task is switched off and
  ended (`jobfix.win32Task`). `win32Processes().start` marks the agent's task running, as a `/Run` does. The card-name
  arm is left out: its agent is a legacy `-discord` session whose only job is a Mac plist, so on Windows it has no task
  to switch off, and a no-op disable or `/End` cannot change it.
- `reset()` on the process table (live entries, state files, survivors, never-comes-up marks, running tasks), called
  per arm in the 2570 file; `stop()` does it too. agentOn now refuses an agent already running from an earlier arm.
- Create and adopt arms assert exactly one `/Run` for the task.

## Review round 4
- The card-name arm has a real Windows branch: a Kosmos task for `two-named`, the agent running in the process table,
  the roster a Windows board uses (`win32roster.make` over the table's live list), and CLAUDE.md naming it
  Bartholomew. It asserts the task switched off and ended, the process gone and its ownership row forgotten, and the
  agent off the board. The Mac and Linux arm is unchanged.
- Ownership rows: chose to ASSERT the row is gone after each stop and restart (`procs.rowsOf`), not to build the live
  list from win32sessions. The real `claude agents --json` lists running processes, so a row left after its process
  ended never appears in it; a stand-in that listed record rows would call a killed agent running, which no real
  machine does. The stale row matters through the record itself, so the record is what is checked.
- `jobfix.resetScheduler()` clears the stand-in's running tasks; the create and adopt arms call it when done.
- The 2570 and adopt files remove their sandboxes in `test.after`.

## Review round 5
- Card-name arm on Windows: the roster is read once with the agent running and that snapshot is served after the
  removal, as the Mac's fixed pane line is, so only the board's removed-record filter can take the card off.
- `neverComesUp(name, { stale: true })`: the kill leaves the dying supervisor's state file. The #2019 control now also
  restarts in that mode and must answer `partial`; an `idAccepts` that ignores `before` fails it. The model-route arm
  alone does not catch that mutation; the control does.
- The allowlist and half-removed arms write the real task definition on Windows (`jobfix.jobFor`), not `<plist/>`.
- Acts are matched by verb, value and flags in any order (`jobfix.argsMatch`), not exact strings.
- The wont-unload arm resets the scheduler; the 2570 file undoes its module-level scheduler watch in `test.after`.
