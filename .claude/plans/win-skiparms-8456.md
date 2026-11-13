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

## Verified
Each changed file on this box with and without the preload, stdin closed, and with TEMP/TMP set to an 8.3 short
path. Negative controls: skipped look-again, no-op disable, no-op enable, no taskkill on restart, no boot shim written,
project block written after the start, and a task line naming another file: each failed its arm.
