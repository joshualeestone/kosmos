# ⚑ RESUME HERE — Kosmos on Windows

**If you are a new session picking this up, read this block, then §2 and §3. Nothing
else is required to continue.**

    where the work lives   one slice per branch off main (repo CLAUDE.md)
    already on main        7c-1..7c-6 (#2601, #2661, #2672, #2756), headless tasks
                           (#2714), the supervisor fixes #2722, #2728, #2731,
                           #2737, the launcher hand-off #2752, the agent's
                           kosmos command #2754, the zip text #2759, R8b's
                           record #2823, the anchor swap #2825, and the
                           multi-Kosmos set for agents (#1704: #2845, #2852,
                           #2874, #2877, #2879, #2886, #2892).
                           Windows v1 is SERVED as 0.6.55 (below)
    this file              .claude/plans/WINDOWS-ROADMAP.md   <- the whole road
    the keep-alive log     .claude/plans/win32-keepalive-570.md  <- that slice only

## The one-line state (2026-09-12, ~16:00 UTC)

**MAIN NOW RUNS AGENTS IN A SECOND KOSMOS, MEASURED LIVE ON THE BOX: 18/18 on
main `5aa75512` (0.6.59), 2026-09-12 (§5).** The #1704 set gives each Kosmos's
agents that Kosmos's board token, task and pipe. It also lets a switch pause or
keep the old Kosmos's agents, holds a kept agent's sends until its Kosmos opens,
and imports agents from one Kosmos into another. The anchor swap (#2825) is on
main too. Neither has reached Windows users yet: installkosmos.com still serves
0.6.55 (`latest-win.json`, fetched 2026-09-12), and the next Windows cut goes to
STAGING first (the handshake under "Do this next").

**WINDOWS v1 SHIPPED 2026-09-11. installkosmos.com serves 0.6.55**, built from main
`fbe246e0`. `latest-win.json`, the `kosmos-win-x64.zip` alias,
`kosmos-0.6.55-win-x64.zip` and the served `.sha256` all name, and hash to,
`062e836ee0df9a919c1563a623417bed182b9afd6aac312d8ef9043928ec796c`. How it got
there:
- Baron built it on mortals.
- The Windows box checked it file by file against its own build of the same sha
  (132/132 identical).
- The box then ran it live, installed as a download (Mark of the Web set): Z0-Z6,
  the two-line answer, and agent-to-agent messaging all passed.
- It shipped on Josh's go.

The fixes it needed are all merged: #2752 (the launcher hand-off), #2754 (the
agent's `kosmos` command, BLOCKER 5) and #2759 (the README and manifest). #2756
recorded the 7c-6 rehearsal in this file.

**R8b PASSED 2026-09-11: a real reboot on the SHIPPING zip install**, not the
source checkout (§2). The board and all 5 enabled agents came back unattended, and
an agent started at logon ANSWERED on the board.

BLOCKER 2 stays off the v1 path: Josh approved 2026-09-10 that v1 updates by hand,
with a real updater as a fast-follow. What is still open:
- a clean-box first run (capability 1, §5). It waits on Josh, because Windows
  Sandbox needs admin and a reboot;
- the real updater (capability 7, a fast-follow);
- the `.ps1` execution-policy dependency (§3c);
- a live Mac import-and-start, queued for a Mac tester (§5);
- no way to delete a Kosmos, on any platform (§5).

✅ Closed since 2026-09-11: a zip that changes the Node runtime can now be handed
off (#2825, §5), and a named world's agents get that world's board token (the
#1704 set, §5).

## ✅ 7c-2 IS DONE (2026-09-10), AND MEASURED ON THE BOX.

    createAgent('winstream-1') ......... created, 849ms, all four steps ok
    task ............................... Kosmos\agent-winstream-1, Status RUNNING,
                                         At logon time, Run As User joshu
    task command line .................. ...\Kosmos\runtime\node.exe
                                         ...\Kosmos\runtime\supervisor-boot.js
                                         "winstream-1" "...\workers\winstream-1"
                                         "-" "-" "claude"
                                         "C:\Users\joshu\.local\bin\claude"   <- arg six
    supervisor ......................... pid 2300, run FROM THE ANCHOR
    agent .............................. pid 16268, claude.exe,
                                         PARENT 2300 (the supervisor holds it)
    agent command line ................. --dangerously-skip-permissions -p
                                         --input-format stream-json
                                         --output-format stream-json --verbose
                                         --session-id bb8b7cd2-...
    claude agents --json ............... lists it, kind "interactive", under the
                                         session id Kosmos recorded

🔑 THAT IS THE SLICE, PROVEN RATHER THAN ARGUED. A person pressing the button now
gets a STREAMING agent whose stdin is held by a supervisor — the shape that can be
typed to. What is missing is only the road from the board to that supervisor.

📌 AND ONE FIXTURE FACT WORTH NOT REDISCOVERING: `createAgent` on win32 refuses
outside the board with "we could not check which agents are already running". That
is a FOURTH tmux gate (`status.paneRoster()` throws when tmux cannot be asked), and
it is not a defect — `server.js` installs `win32roster.make()` behind
`status.setPaneSource` at boot, which is what makes the roster readable. Any
harness driving create by hand has to install that seam and `win32capture` too, or
it dead-ends before reaching any of the win32 code it meant to test.

## What 7c-2 changed

    engine/win32supervisor.js  main() -> superviseStreaming()   the task runs THIS
    engine/create.js           win32StartViaJob()               the ONLY launch path

What changed, and the four things worth not re-deriving:

1. **The task supervises the streaming agent.** `main()` called `supervise()`,
   which watches a DETACHED agent nobody holds the stdin of -- structurally the
   one shape that can never be messaged. It now calls `superviseStreaming`, whose
   child is ours and whose `handle.send()` is what 7c-3 will reach.
2. **`create.js` no longer spawns an agent at all.** It registers the job and
   RUNS it (`win32StartViaJob`), so what starts now and what starts at logon are
   one command line and cannot drift. Two launch paths became one.
3. **A failed registration is now a failed start**, and that trade is deliberate:
   the old fallback produced the unmessageable detached agent. Refusing with the
   reason beats shipping a healthy-looking row that answers nobody.
4. **A start is verified, because `schtasks /Run` lies.** It reports SUCCESS for a
   run that started nothing (measured, §3c). The evidence is the ownership record
   the supervisor writes BEFORE it spawns -- `win32create.awaitSession`, watching
   for a row that was not there before. The roster would be the same answer ~5s
   later, which would make every create feel broken.

⚠️ AND TWO GUARDS WENT IN WITH IT, both for the duplicate-agent hazard:
`superviseStreaming` now asks who is already live under this name before it starts
anything (an unheld session, or its own id still listed, makes it WAIT -- it does
not kill and it does not resume on top of itself); and the resolved runner path
now rides on the task's command line as argument six, because the task path had
silently been falling back to a bare `claude` on whatever PATH the logon had.

📌 AND A TEST SUITE WAS REGISTERING REAL SCHEDULED TASKS ON THIS BOX.
`engine/create.test.js` never states its platform, so on Windows every
`createAgent` in it took the win32 arm for real -- `Kosmos\agent-ct-*` were found
registered on the developer's machine. Harmless while the arm only wrote a task;
with 7c-2 the same path would have `/Run` them and start real agents. The win32
seams are now stubbed at the top of that file. `remove.test.js` had the same hole
in two calls and now states `platform: MAC`, which is what the file already
claimed to do.

## ✅ 7c-3 PART 1 IS DONE (2026-09-10) — the channel exists, unit-proven

    engine/win32channel.js     serve() in the supervisor, say() for the board
    engine/win32supervisor.js  main() serves the channel; handle.stop closes it;
                               handle.send(text, done) answers AFTER the flush

What it is: `\\.\pipe\kosmos-agent-<safeKey>`, served by the supervisor (the only
process holding the agent's stdin). One JSON line each way: token + text in,
`{ok}` or `{ok:false, because, down?}` out. Per-agent secret under
`store.ROOT/win32-channel/`, created `wx` by whichever side is first, compared in
constant time. Supervisor down = ENOENT at once = `down:true`, "nothing typed".
No spool. `say()` is SYNCHRONOUS (chat.js is) and runs the client in a CHILD
under `execFileSync`'s timeout, because Node has no deadline-able sync pipe read.

📌 FIXTURE FACT: `say()` cannot be tested against a server in the same process —
`execFileSync` stops the event loop, so the in-process server never accepts. The
test's stand-in supervisor is a separate process (`servingElsewhere`), which is
the production topology anyway.

Win32 suite after this + a merge of main: **279/279**. `create.test.js` still at
its known 61/100.

## ✅ 7c-3 PART 2 AND 7c-4 ARE DONE (2026-09-10), MEASURED ON THE BOX

    the channel, through the real task   winstream-1 restarted via its task; the
                                         pipe appeared 546ms later; say() -> ok in
                                         57ms; the agent answered "PELICAN-7"
    chat.deliver, the product path       real snapshot, real win32roster card
                                         (reachedByChannel true) -> placed in 60ms;
                                         the agent answered "HERON-3" 1.3s later
    a card with no channel               winreh-2 -> could_not "not running, nothing
                                         typed" in 60ms, no tmux touched

What 7c-4 is (branch win32-chat-arm-570): `status.js` puts `reachedByChannel` on
every card (true exactly for win32roster's `WIN32_COMMAND` rows); `chat.deliver`
sends such a card through `win32channel.say()` after every shared gate and
instead of `verifyAtSend` + `send-keys`. `win32channel` marks outcomes where the
request was already written `unsure`, which `deliver` reports as `unconfirmed`,
never `could_not`. `chat.setChannel` is the seam, with setRunner's interlock.

📌 FOUR THINGS FOUND ON THE WAY, so they are not re-found:
- **A reboot gives the agent a FRESH conversation, and that is Mac parity, not a
  defect.** Neither `bin/agent-supervisor.sh` nor create.js passes `--resume` or
  `--continue` anywhere. `--resume` is used only INSIDE one supervisor's life (a
  crash restart). §3 used to say a reboot would resume; it does not, on either
  platform. A fresh boot files a new ownership row; stale rows are harmless
  (nothing live matches them), and since #2737 a fresh start prunes the agent's
  other rows, so they no longer accumulate.
- ✅ **FIXED by #2722. It was: a crash-restarted agent resumed with an EMPTY
  `KOSMOS_AGENT_TOKEN`** (`launchStreaming` passes `s.token || ''` on resume and
  the supervisor never has one), so its self-reports are refused by /api/report
  on win32. Fix: mint a fresh token on resume and retire the dead run's.
- **`winreh-2`-shaped agents say "not running" while running.** A pre-7c-2
  detached agent has no pipe, so the honest verdict is right and the WORDING is
  wrong. No released user can have one; noted, not fixed.
- **Test sandboxes leak.** ~138 `win32-sessions/record.json` copies were left
  under `%TEMP%` by the win32 suites. Harmless, untidy.
- **NOBODY READS THE AGENT'S STDOUT, AND IT DOES NOT HANG IT (measured).** The
  supervisor holds stdout/stderr pipes and never drains them, which looked like a
  freeze waiting for a full pipe buffer. Measured on winstream-1: an 18,892-char
  answer completed, and a follow-up was answered 2s later, agent alive. So Claude
  Code buffers or the pipe is roomy at this size. ✅ RETIRED by 7c-5: the
  supervisor now reads stdout (state comes from it) and drains stderr, keeping
  its tail for the `died` line.

📌 SPLINTER'S ANSWERS 2026-09-10: v1 ships with by-hand update (Josh approved);
installkosmos.com serves a STALE Windows zip (0.6.37; superseded: 0.6.55 is
served since 2026-09-11); #2604 is merged and win32
changes route through this lane; **Baron Draxum owns the Mac-side delivery
contract** (could_not / verify-before-send) -- sync the 7c-4 mapping with him.
The Mac Kosmos builders now share this box's installkosmos account, so watch
shared usage before fanning out subagents.

## Do this next

1. ✅ win32-chat-arm-570 merged as #2661.
2. ✅ **7c-5 DONE 2026-09-10** (branch win32-stream-state-570): state from the
   event stream (§4). The supervisor reads the agent's stdout and keeps its
   working/idle in `win32-state/<key>.json`, stamped with session id and pid;
   `win32capture` falls back to it for a status-less row. Measured live through
   the supervisor's real `main()`, a real claude.exe and the real snapshot:
   card absent -> idle -> working (0.8s after the message) -> idle.
3. ✅ **7c-6 DONE 2026-09-11:** R1–R8 all pass, with R3 passing for the first
   time and R8 a real reboot (§2).
4. ✅ The crash-restart token defect: #2722. Also fixed along the way: #2728
   (`/clear` rekey), #2731 (a resume with no conversation starts fresh), #2737
   (ownership rows pruned).
5. ✅ **A current Windows build and publish: DONE 2026-09-11.** #2752, #2754 and
   #2759 merged. 0.6.55 (main `fbe246e0`) is served, after Baron's bytes passed
   the handshake below on this box (see the one-line state). The anchor swap
   that followed merged as #2825 (§5). What remains is in §6. The history
   follows.
   - A zip built from main 6182640d (0.6.55) passed every agent step on the box,
     unpacked through Explorer's shell with the Mark of the Web set, as a download
     would be: sign-in via the #2007 nonce, create, talk (delivery and card state),
     restart, remove, restore, talk again.
   - It found one launcher defect. `Kosmos.exe` ran the board in the foreground of
     its own window: closing the window stopped the board, and every relaunch
     after the first logon said "port in use ... Kosmos stopped". Fixed by #2752
     (`win32-launch-handoff-570`, merged): a hand-started board hands itself to its
     headless logon task and exits. `win32-package-text-570` (merged as #2759)
     then brought the zip's README and manifest up to date.
   - It also found BLOCKER 5 (§3c): an agent's `kosmos reply` did not exist on the
     zip, so its answer never reached the board. The fix was `win32-kosmos-cli-570`
     (merged as #2754). A candidate built from all three branches passed with the
     answers on the board.
   - They merged in that order: the hand-off, then the kosmos command, then the
     README (its text describes both).
   - The handshake, agreed with Baron (2026-09-11):
     1. Baron builds on the Mac release box from a sha this box has verified.
     2. This box verifies those exact bytes.
     3. A deploy serves it, on Josh's explicit go.
   - 🛑 SINCE 2026-09-12, EVERY CUT GOES TO STAGING FIRST, WINDOWS INCLUDED.
     This is Josh's fleetwide rule: a cut is served on STAGING and verified
     there, and only then goes to PROD. So step 3 serves staging first, and prod
     follows once staging is verified. ⚠️ The channel tooling covers only the Mac
     tarball: `tools/promote-channel.sh` promotes `dist/latest-staging.json` to
     `dist/latest.json` (`docs/staging-channel.md`).
     `tools/publish-kosmos-windows.sh` writes only `dist/latest-win.json`, and
     nothing in `tools/` writes a Windows staging pointer. So a Windows cut has
     no staging pointer of its own yet.
6. Still unmeasured:
   - the named pipe's default DACL;
   - a first run on a CLEAN Windows box (capability 1). This box is not admin,
     and Windows Sandbox needs enabling plus a reboot.

⚠️ DO NOT re-derive the three measurements in §3 — a streaming session stays
alive across turns, is still listed by `claude agents --json` as
kind:"interactive", and RESUMES under the same session id; and killing a holder
leaves NO ORPHAN (~800ms, both clean and broken-pipe). They were run on this box
and they are what the design rests on.

## Running the tests on this box

🛑 THERE IS NO node OR bun ON PATH. The only interpreter is inside an extracted
build:

    C:\Users\joshu\build-out\extract\runtime\node.exe --test engine/win32anchor.test.js engine/win32job.test.js engine/win32supervisor.test.js engine/win32launch.test.js engine/win32roster.test.js engine/win32capture.test.js engine/win32create.test.js engine/win32live.test.js engine/win32stop.test.js engine/win32board.test.js engine/boardrestart.win32-570.test.js engine/jobexists.win32-570.test.js engine/create.win32-launch-570.test.js engine/remove.win32-job-570.test.js engine/remove.test.js engine/platform.test.js engine/platform-gate-wiring.test.js engine.reachable.test.js

Expect all green — 266 as of 2026-09-10. Suites with KNOWN pre-existing Windows
failures, which are NOT regressions — check the count (pass/fail) before blaming a
change. Every one re-measured on this box 2026-09-10, unchanged by 7c-2:

    create.test.js 61/100   register 13/9   delete-leftover 8/1   status 187/1
    discover 17/1   connect 51/12   machine 41/25   server.connect 38/9

(`server.connect.test.js` is at the REPO ROOT, not under `engine/`.)

## The working rules this lane earned the hard way

1. **Measure on the box; a green unit suite has repeatedly meant nothing here.**
   Every defect of consequence was found by running the real thing: three
   separate tmux gates, `createAgent` with no win32 branch, `/SC ONLOGON`
   needing admin, a rollback killing a launcher pid, agents launched with no
   permission flag into a hidden console.
2. **An unsurveyed row is not a passing row.** Capability 1 sat unlooked-at and
   was hiding two blockers.
3. **Platform is INJECTED, never a bare `process.platform` read** — the fleet's
   CI is a Mac, and an arm it cannot drive is an arm nothing tests.
4. **Finish a step -> update this file -> commit.** A green step that is not
   committed does not exist.

---

# KOSMOS ON WINDOWS — the master plan

The one document that answers "how far are we, and what is left". Written
2026-09-09. `win32-keepalive-570.md` is the working log for the keep-alive slice
and stays authoritative on that; THIS file is the whole road.

🔑 EVERY "MEASURED" LINE BELOW WAS RUN ON A REAL WINDOWS BOX. Everything else is
marked as an estimate. That distinction is the point of this file: this lane has
repeatedly had a fully green unit suite while the product could not do the thing
the suite was about, so a claim with no measurement behind it is not a status.

---

## 1. What "done" means

A person on Windows can:

    1. install Kosmos and get through first run
    2. make an agent
    3. see it on the board, with its real state
    4. TALK TO IT, and get work back
    5. stop / restart / remove / restore it
    6. reboot, and find the fleet back
    7. update the app without stranding the fleet

That is the bar. Not "the tests pass".

---

## 2. Where we are

| # | Capability | State |
|---|---|---|
| 1 | install + first run | ⚠️ **BLOCKER 3 CLOSED** 2026-09-09 — the card now names the real installer. Kosmos still cannot install Claude Code FOR you; see §3c |
| 2 | make an agent | ✅ MEASURED |
| 3 | board + roster | ✅ MEASURED — working/idle from the event stream since 7c-5 (§4); needs_you/blocked still come only from self-reports, as on the Mac |
| 4 | **talk to it** | ✅ **BLOCKER 1 CLOSED** 2026-09-10 (7c-4) — the board's `chat.deliver` reaches the agent through its supervisor's pipe and it answers; measured live. Its card reads working/idle since 7c-5. **R3 PASSED** in the 7c-6 rehearsal: 3 of 3 agents `placed`, card working -> idle, and the reply is in each agent's transcript. ⚠️ **The answer did NOT reach the board**: R3 read the transcript, and an agent on the Windows zip had no `kosmos reply` (BLOCKER 5, §3c). ✅ Fixed by #2754 (merged 2026-09-11), verified live with the answer on the board, and again on the shipped 0.6.55 bytes and after a real logon (R8b). A crash-resumed agent reports again (#2722), and `/clear` keeps it on the board (#2728) |
| 5 | stop/restart/remove/restore | ✅ MEASURED |
| 6 | survive a reboot | ✅ **MEASURED AT A REAL LOGON, TWICE.** R8 (2026-09-11, the source checkout): the board and all 5 enabled agents came back unattended, with one `conhost --headless` supervisor each, no windows, every card idle, and one ownership row per agent (#2737). **R8b (2026-09-11, 13:01 UTC, the SHIPPING zip install, fbe246e0):** the same came back, and an agent started at logon ANSWERED. reh-a's two-line reply landed on the board intact, which proves the logon-started supervisor put the zip's `bin\` on the agent's PATH, and reh-a -> reh-b messaging worked |
| 7 | **update the app** | ⚠️ **BLOCKER 2, OFF THE v1 PATH.** Josh approved 2026-09-10: v1 updates by hand, a real updater is a fast-follow. §3a. The ANCHOR (not stranding the fleet) is designed and unit-tested; the UPDATER ITSELF cannot run on Windows at all. An update by hand has run twice (§5). ✅ Since #2825, an update whose zip changes the NODE RUNTIME can replace the anchored node.exe while the fleet runs on it. That is on main, not yet in a served zip (§5) |

🛑 THAT IS FOUR BLOCKERS, NOT ONE (FIVE since 2026-09-11, §3c). This table said "one blocker" on 2026-09-09
because capability 1 had never been looked at. It has now been traced end to end,
and the capability with no evidence was hiding two more. 📌 THE LESSON IS THE
FILE'S OWN RULE: an unsurveyed row is not a passing row, and should never again be
read as one.

Measured 2026-09-08/09 through the real product path (board up, real HTTP routes,
every result checked against Windows rather than against a return value):

    R1 create 3 agents .......... PASS
    R2 board roster ............. PASS   all three under their RECORDED names
    R3 each reports ............. FAIL   cannot be typed to at all
    R4 stop ..................... PASS   task Disabled, process gone
    R5 restart .................. PASS   old pid gone, new session, task Running
    R6 remove ................... PASS   five steps, Restore offered
    R7 restore .................. PASS   task Enabled + Running, agent back
    R8 reboot ................... PASS   back at logon in 7s, unattended

✅ **7c-6, RE-RUN 2026-09-10/11 on the streaming agent**, through the real board's
HTTP API on port 16180 (script `kosmos-rehearsal-7c6.js` on the box). Every
verdict reads `/api/status`, `claude agents --json` and `schtasks`, never a
route's own answer:

    R1 create 3 agents .......... PASS   reh-a, reh-b, reh-c via POST /api/agents
    R2 board roster ............. PASS   all three cards, idle
    R3 each reports ............. PASS   FIRST TIME: delivery=placed, card working
                                         -> idle, PONG in each agent's transcript
                                         (the transcript, not the board's thread:
                                         BLOCKER 5)
    R4/R6 stop = remove ......... PASS   5 steps ok, task Disabled, process and
                                         card gone, listed under /api/removed
    R5 restart .................. PASS   new pid, a NEW session (a fresh
                                         conversation, as on a Mac), one row
    R7 restore .................. PASS   task Running, card idle
    R8 reboot ................... PASS   2026-09-11, Josh's reboot of the box on
                                         main 6182640d: \Kosmos\board and 5 agent
                                         tasks Running from logon, one headless
                                         supervisor each, no windows, all 5 cards
                                         idle, board HTTP 200, one ownership row
                                         per agent. The BOARD at a real logon for
                                         the first time.
    R8b reboot .................. PASS   2026-09-11 13:01 UTC, on the SHIPPING
                                         zip install (fbe246e0), not the source
                                         checkout: the same came back, and an
                                         agent started at logon ANSWERED on the
                                         board (two lines intact; reh-a -> reh-b
                                         messaging worked)

⚠️ AND READ THAT LIST FOR WHAT IT IS. R1–R8 measured the AGENT LIFECYCLE, and it
is genuinely solid. What it did not touch is everything either side of it: getting
Kosmos onto a machine at all, getting `claude` onto it, keeping the BOARD alive,
and updating any of it. Those are capabilities 1, 6 and 7, and three of the four
blockers live there. The rehearsal was never wrong — it was narrower than the bar
in §1, and this file read it as broader for a day. (2026-09-11: the 7c-6 R8
above now covers the BOARD at a real logon, R8b repeats it on the shipping zip
install, and an update by hand has been run twice, zip over zip (§5). Getting
Kosmos and `claude` onto a CLEAN machine is still unmeasured.)

---

## 3. THE BLOCKER, and the plan for it (7c)

📌 HISTORICAL: closed by 7c-4 (#2661). What follows is the state it was written in.

`engine/chat.js` has no win32 arm. Delivery is `tmux send-keys` end to end,
addressed at a pane Windows does not have. It refuses honestly — nothing is typed
and nobody is told a message landed — so it is a gap, not a defect, and it is
pre-existing rather than something this branch introduced.

**The board can make a Windows agent, show it, stop it, restart it, remove it and
restore it — and cannot say a word to it.**

### The substrate, and why this one

Three candidates were spiked. Two are out:

- **Console keystroke injection** (`AttachConsole` + `WriteConsoleInput`) — the
  literal `send-keys` analog. Refused by policy on this machine, and it is the
  wrong dependency anyway: simulating a human at a keyboard to reach a program
  that has a real message channel.
- **A stdin pipe Kosmos already holds** — ruled out by the current launch design.
  `win32launch` uses `cmd /c start` with `stdio: 'ignore'` precisely so the agent
  outlives its starter; nobody holds the child's stdin.

The one that wins, MEASURED:

    claude -p --input-format stream-json --output-format stream-json

    turn 1 -> "FIRST"    same process, same session_id
    turn 2 -> "SECOND"   answered after turn 1 completed

A `-p` session with streaming input does NOT run one turn and exit. It stays open
and answers messages as they arrive on stdin — one JSON line each. Documented and
supported, which the alternative is not.

🔑 AND IT KEEPS EVERYTHING #570 BUILT. Measured while such a session was alive:

    {"pid":15576, "kind":"interactive", "sessionId":"e6569836-...", "name":"..."}

`claude agents --json` still lists it, as `kind: "interactive"`, with a pid and a
session id. So `win32roster`, `win32live`, `win32stop`, `win32job` and
`win32anchor` all keep working unchanged.

🔑 AND IT RESUMES, which is what a CRASH RESTART rests on. A piped child cannot
be ADOPTED — adoption means holding a stdin somebody else holds — so when the
agent dies under a live supervisor, the supervisor re-opens the conversation
instead. ⚠️ CORRECTED 2026-09-10: this used to say "a supervisor restart or a
reboot" resumes too. It does not: a FRESH supervisor (reboot, task `/End` +
`/Run`, Restore) has no session id to resume and starts a new conversation --
which is exactly what the Mac does, since nothing Mac-side passes `--resume` or
`--continue` either. Measured:

    turn 1 (new session)           -> "STORED"      session c502cba1-...
    turn 2 (NEW PROCESS, --resume) -> "PELICAN-42"
    same conversation: YES     same session id: YES

The same id is the part that matters beyond memory: the ownership record, the
roster join, the state read and the stop path are all keyed on it, so a resumed
agent is the SAME agent to every part of this branch. Adopt-not-replace becomes
resume-not-replace, and the property it protected is preserved rather than traded.

### The slices

| Slice | Work | Estimate |
|---|---|---|
| 7c-1 | ✅ **DONE** — the substrate: `win32launch.launchStreaming()` spawns `-p --input-format stream-json` WITH PIPES; `win32supervisor.superviseStreaming()` holds them and has `send()`. Built and tested unwired first, deliberately | — |
| 7c-2 | ✅ **DONE 2026-09-10** — WIRED LIVE. The task's `main()` supervises the streaming agent, and `create.js` starts the agent by RUNNING ITS JOB rather than spawning one, collapsing two launch paths into one. See the RESUME block for the four facts | — |
| 7c-3 | ✅ **DONE 2026-09-10** — board → supervisor channel: a local named pipe per agent, per-agent secret, honest `down` when the supervisor is gone. Measured through the real task | — |
| 7c-4 | ✅ **DONE 2026-09-10** — `chat.js` win32 arm on that channel, keeping the `could_not` contract; `verifyAtSend`'s hazards (a shell, copy-mode) do not exist on a stdin pipe, and the supervisor re-checks at the write. Measured live | — |
| 7c-5 | ✅ **DONE 2026-09-10** — working/idle from the EVENT STREAM (see §4), crossing to the board as a per-agent file joined on session id AND pid. Measured live. The transcript needed no work: Claude Code writes the session's jsonl under `~/.claude/projects` in streaming mode too (7c-4 read replies from it) | — |
| 7c-6 | ✅ **DONE 2026-09-11** — R1–R8 re-run through the real board API, R3 passing for the first time, R8 a real reboot with the board included. See §2 | — |

**Estimate: 4–6 working sessions**, plus the near-certainty of 2–4 new defects
that only a real box surfaces. That rate is not pessimism, it is the record:
three separate tmux gates, `createAgent` having no win32 branch at all,
`/SC ONLOGON` requiring administrator, an empty `<UserId>`, the ownership record
outliving its session, and a rollback killing a launcher pid — every one of them
found by running the real thing, none by the unit suite.

---

## 3a. BLOCKER 2 — the in-app updater cannot run on Windows

Found by survey 2026-09-09, then confirmed directly. `engine/update.js` contains
**zero** references to `win32` or `process.platform`, and `beginInstall()` does:

    engine/update.js:662
    spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh; ...'], ...)

There is no `/bin/sh` on Windows. So "Install update" spawns nothing, the ENOENT
is caught by the child error handler, and the board keeps running the old version.

⚠️ `platform.js`'s `RUNNER_DOWNLOADS` GATE DOES NOT COVER THIS. That gate was
split out in `e3870c49` so win32 refuses a RUNNER-binary download while still
being allowed to run agents. The SELF-updater is a different path and is not
gated by it at all — so this is genuinely unguarded rather than deliberately
refused.

### SETTLED 2026-09-09, and the answer is worse than the question assumed

🛑 THE SPAWN IS UNREACHABLE, AND THE PERSON IS TOLD THE OPPOSITE OF THE TRUTH.

    update.js installedRoot()   requires  <home>/runtime/bin/node
    the Windows bundle stages             runtime/node.exe   (no runtime/bin)

So `installedRoot()` is null on every Windows install; `server.js` sends no offer;
the Install button is never drawn; `maybeAutoInstall()` returns early — and the
card falls through to **"Up to date."** A Windows box with a newer release
published says it is current. That is a silent lie rather than a failed button,
which makes it worse than the ENOENT this section was originally about.

Two more on the same trace:
- the overlay prints `attempt.code` and `attempt.log` and **never
  `attempt.because`**, so the ENOENT sentence would be dropped by the page even if
  the spawn ran;
- forcing `POST /api/update` today answers *"this Kosmos runs from its source
  code, so it updates from git"* — false for a portable-zip install, and it points
  at git.

**GUARDED** (`6d9e9a0b`): `platform.js` gains `SELF_INSTALL`/`canSelfInstall` in
the shape `RUNNER_DOWNLOADS` already uses, `beginInstall` refuses before the spawn
with a sentence somebody can act on, and the route answers 409 with the true
reason. That is the guard, not the updater.

⚠️ THE ORDERING CONSTRAINT IS THE SHARP EDGE. `installedRoot()` must NOT learn the
Windows layout until a swap exists — that single line is what turns the button on,
and live execution IS armed on win32, so the spawn would be real. The guard is
what stands there if somebody does it anyway.

📌 STILL OWED: rendering the "Up to date." lie honestly (`/api/update/check`
already returns `source`; the page throws it away).

### What a real Windows updater costs

More exists than assumed: `tools/publish-kosmos-windows.sh` ALREADY publishes the
fetch-and-verify half (versioned zip, `.sha256` sidecars, a `latest-win.json`
manifest), and `win32anchor` already provides the updater's most important tool —
a durable `node.exe` OUTSIDE the extract tree, so the swapper never runs on the
interpreter it is replacing.

What is genuinely hard: ~~there is nothing to restart the board with~~ — **that
half landed 2026-09-09 with BLOCKER 4.** `engine/win32board.js` gives the updater
the stop-and-start it needs (`restart()`, end → wait → run, driven from a detached
helper), and the anchor's shared `engine-path` pointer means a swap moves the
board and every agent onto the new app with ONE write rather than N
re-registrations. What remains: a running image cannot be overwritten, though it
CAN be renamed, which is the whole trick; and there is no canonical install
location, because the bundle is a portable zip extracted into a versioned folder
wherever the person chose.

    A  refuse honestly                         DONE. Windows updates by hand, forever
    B  sidecar swap driven from the anchor      ~3-4 slices  <- recommended next
    C  a real install step (setup.sh's analog)  ~6-8 slices, deletes the problem
                                                rather than routing around it; B is
                                                a strict subset of it
    D  MSIX + App Installer                     large, needs signing; probably right
                                                eventually, wrong for the next slice

A Windows updater also has to answer what the Mac's `curl | sh` answers: fetch,
verify, replace a RUNNING install, and restart the board. The anchor already
solves the hard half (a task must not be stranded by a moved app); what is
missing is the act of updating itself.

---

## 3b. The pattern the survey actually found

🛑 SEVERAL MODULES ASK "DOES THIS AGENT HAVE A STARTUP JOB?" BY LOOKING FOR A
`.plist`. Windows never writes one — it registers a Scheduled Task — so these do
not refuse, they answer **false, confidently, and wrongly**. This is the same
shape as the three tmux gates: one question, asked in several places, each one
needing to be found separately.

| Where | What it gets wrong on Windows |
|---|---|
| `engine/register.js:245` | `job: fs.existsSync(create.plistPath(name))` — feeds the very screen that exists to answer "will this agent be here after I restart?", and tells a Windows user NO for every agent. R8 measured the opposite. |
| `engine/delete-leftover.js:184` | cannot see a leftover Scheduled Task, so "free the name" can free a name while a task stays registered |
| `engine/status.js:4166` | a fresh Windows agent gets "made before Kosmos recorded this" — false, Kosmos just made it |

🔑 AND `create.js` ALREADY KNOWS BETTER. `disabledJobs()`/`runningJobs()` fail
soft to an EMPTY SET, on the stated grounds that "could not look" is not a claim.
`register.js` makes the claim anyway. The fix is the one `remove.js` already
took: ask `jobOps`/`win32job.status`, not the filesystem.

⚠️ REGISTER.JS IS THE ONE TO FIX FIRST, and not because it is the biggest. It is
the screen whose whole purpose is the property #570 exists to prove, and it
currently tells Windows users that property is absent. We would ship the feature
and a screen calling it broken.

### Also degraded, lower priority

- ~~`engine/boardrestart.js` — no win32 arm anywhere~~ **DONE 2026-09-09.** It has
  one, built on the board's own logon task rather than on a CLI. The open
  question is answered and the answer is no: the Windows bundle ships no
  `bin\kosmos` of any spelling, so `installedKosmosCli()` is null there BY
  CONSTRUCTION — a true negative, now documented in `clipath.js`, that routes to
  a real mechanism instead of a dead end. See §3c. (Since `win32-kosmos-cli-570`
  merged as #2754, the zip ships `bin\kosmos` as the AGENT's command, with no board
  verbs. So `installedKosmosCli()` is no longer null on a Windows bundle.
  `boardrestart.js` still never asks it on win32, because `canSelfRestart` returns
  at its win32 check first: `engine/boardrestart.js:33-36`, :208.)
- `engine/terminal.js` — "open the agent's terminal" shells `osascript`. Fails
  honestly with a raw ENOENT sentence. Consistent with 7c: there is no pty to
  attach to, so this may simply not exist on Windows.
- `engine/github.js`, `engine/vercel.js` — resolve `gh`/`vercel` only from
  hardcoded POSIX paths, no PATH lookup, no `.exe`. A Windows user with them
  installed is told they are not. `runners.js` already does PATHEXT properly, so
  the technique exists in-repo.
- `engine/delete-leftover.js` — no `~/.Trash`, so every Windows delete is
  permanent-with-confirmation. Degrades SAFELY and honestly; noted, not a defect.

📌 NOTHING IN THE SURVEY CAUSES DATA LOSS. The worst outcomes are a dead update
button and a screen that is backwards about reboot survival.

---

## 3c. BLOCKERS 3 and 4 — first run, and the board itself

Traced end to end 2026-09-09, then the two headline claims verified directly.
This was the row with NO evidence, and it was hiding two blockers.

### BLOCKER 3 — a clean Windows box has no way to get `claude`

`platform.js` sets `RUNNER_DOWNLOADS = ['darwin']`, so `connect.download()` refuses
on win32 — correctly, and BEFORE any bytes move, because the Claude Code binary it
would fetch is a macOS build. The refusal is honest and it genuinely reaches the
screen (`web/index.html` renders the platform sentence verbatim).

🛑 AND THEN THE PRODUCT HAS NOTHING FURTHER TO OFFER. Nowhere in the engine, the
web assets, the README or docs is a Windows user told HOW to install Claude Code —
no command, no link. `platform.js`'s own design note assumes "a Windows user
installs Claude Code themselves", and that half was never built.

⚠️ AND THE ONE ESCAPE HATCH IS HIDDEN FROM EXACTLY THE PERSON WHO NEEDS IT. The
"already use Terminal? just type `claude`" path is gated on
`claudeHatchAvailable()`, which resolves the binary — so it appears only for
somebody who already has it, and is invisible on the clean machine it would help.
The remaining buttons are "Try again" (repeats the same doomed download) and
"Continue anyway" (into a board that cannot make a working agent).

So: fails HONESTLY, and is still a blocker. The fix is small and mostly copy —
tell a Windows user how to install Claude Code, and stop hiding the hatch on the
machine that needs it — but it has to exist.

#### ✅ CLOSED 2026-09-09. What was built, and what was deliberately not.

`publicView` now serves two machine facts (`platform`, `canInstallClaude`, the
latter being `platformGate.canDownloadRunner`), and the stuck card's note has a
win32 arm on them: **Kosmos cannot install Claude Code on Windows, you install
it, here is the command, then press Try again.** The command is MEASURED, not
composed — `https://claude.ai/install.ps1` answered 200 with a real PowerShell
installer that reads the same `downloads.claude.ai` manifest `connect.js`'s own
downloader reads, verifies a SHA256, and runs `claude install`. It is carried
beside `code.claude.com/docs/en/quickstart` rather than instead of it, because a
command in shipped source ages and a vendor page does not.

🔑 AND THE OTHER HALF WAS ALREADY DONE, WHICH IS WHY THIS SLICE WAS SMALL. The
installer lands `claude.exe` under `%USERPROFILE%\.local\bin\` — the exact rung
`runners.resolveBin('claude')` resolves, through the PATHEXT candidates #570
added. MEASURED on this box, live: `resolveBin('claude').present` → **true**,
`subscription.check()` → **connected**, `checkLive()` → **connected**. So once
Claude Code is installed and signed in, `start()` takes the CONNECTED
short-circuit and the person is past the screen. There was nothing to fix there;
it needed measuring, and it measured good.

⚠️ THE HATCH WAS NOT UNGATED, AND THE GATE TURNS OUT TO BE RIGHT. On a Mac,
three of the five stuck causes mean Claude Code was never installed AND Kosmos
is the thing that installs it, so offering "type `claude`" there is a wall with
a sign on it (#205/#996). The Windows problem is not that the hatch is gated —
it is that Windows needed a DIFFERENT affordance, because the hatch answers "how
do I sign in" and the missing question was "how do I get it at all". Both notes
now render together on a Windows box that has `claude.exe` but is stuck for some
other reason: they answer different questions and neither replaces the other.

📌 THE REFUSAL WAS NOT WEAKENED, and it now has a test of its own —
`connect.download(…, 'win32')` had NO guard before this, only
`platform.canDownloadRunner` did, so the gate could have stayed intact while the
call site quietly stopped consulting it.

📌 LEFT ALONE, ON PURPOSE, AND NAMED SO IT IS NOT LOST:
- **`frClaudeConfirmSentence` still says "we need to install Claude Code first"
  on Windows**, before the doomed press. It is FALSE there — Kosmos will not.
  Not touched here because it is a different screen with its own copy history
  (#1556/#996) and its own three guard files, and the person meets the true
  sentence one click later. Worth a small follow-up.
- **`downloads.claude.ai` DOES publish `win32-x64` and `win32-arm64` builds** —
  read out of `install.ps1` directly. So `RUNNER_DOWNLOADS = ['darwin']` is a
  statement about `platformKey()` hard-coding `darwin-${arch}` and about the
  `<binary> install` step, not about the artifact's existence. A real
  click-to-connect on Windows is therefore POSSIBLE and is a proper slice, not a
  copy change. Refusing remains correct until somebody builds it.
- **`installVendor`'s `findElsewhere` probe is POSIX-only** (`/opt/homebrew`,
  `/usr/local`, `/usr/bin/which`), so a Windows user who installs Claude Code by
  `npm` or `winget` — landing it somewhere other than `~/.local/bin` — is still
  invisible to Kosmos. Dead code on win32 today (`install()` refuses at the
  download gate first), which is why it was not widened; the instruction the
  card gives is deliberately the one whose landing spot Kosmos already resolves.

### BLOCKER 4 — the BOARD does not come back after a reboot

⚠️ THIS CORRECTS SOMETHING THIS FILE PREVIOUSLY REPORTED AS DONE. R8 measured
AGENTS returning at logon, and that stands. But the board is a separate process,
and nothing brings it back.

    Mac    install/setup.sh writes com.kosmos.board.plist with RunAtLoad,
           so launchd relaunches the BOARD at login
    win32  nothing. Verified: no Startup entry, no Registry Run key, no
           Scheduled Task for the board anywhere in tools/windows/ or
           tools/build-kosmos-windows.sh

`win32job.js`'s Scheduled Tasks are strictly PER-AGENT. So after a reboot the
fleet is running and the thing you look at it through is gone, with nothing on
screen saying so — `machine.js`'s label check returns null off-darwin and the row
is filtered out entirely, so Settings never raises the subject.

📌 AND THE BOARD RUNS IN THE FOREGROUND OF ITS LAUNCHER. `KosmosLauncher.cs` runs
`node app\server.js` sharing its own console and waits on it, so closing that
window kills the board. Together: the board is easy to lose and does not come
back on its own.

FAILS SILENTLY, which is what makes it a blocker rather than an annoyance.

#### CLOSED 2026-09-09 — `engine/win32board.js`, and it closes half of BLOCKER 2

The board now has the thing the agents already had: an at-logon Scheduled Task,
`Kosmos\board`, registered from XML naming the current user. Same folder as the
agent tasks so one place in Task Scheduler shows everything Kosmos registered;
a different prefix, so nothing that lists `Kosmos\agent-` can mistake the board
for a nineteenth agent. Registered by the board's own first run (`server.js`'s
run-directly block) because a portable zip has no install step — the Mac gets
this from `setup.sh`, which Windows does not have.

🔑 THE THREE THINGS THAT WERE MEASURED, because two of them were surprises.

    module.runMain shim   process.argv[1] rewritten, runMain() called; the target
                          sees require.main === module, its own __filename and the
                          argv tail. So server.js boots as ITSELF, in ONE process
    StopExisting          🛑 REFUTED. The obvious one-call restart policy left NO
                          BOARD AT ALL: the new instance starts while the old one
                          still holds the port, dies on EADDRINUSE, and the old one
                          is stopped anyway. Two boards was the expected hazard;
                          zero boards is what it actually produced
    IgnoreNew             correct, and `/Run` against a running task starts nothing
                          — while still reporting SUCCESS, so no caller may read
                          that exit code as proof a board started

⚠️ SO THE RESTART IS END → WAIT → RUN, AND THE WAIT IS LOAD-BEARING. After
`/End` the port stayed bound about a second. The sequence cannot run in the board
(its first step kills it), so `win32board.restart()` spawns a detached helper —
the shape `boardrestart.kosmosRestart` already uses for #2454's installed Mac
board. Proven end to end on this box against the real scheduler with a stand-in
payload: register, run, board up with the marker stamped, restart at 2.15s, new
pid, exactly one listener, task deleted. The single-instance guarantee is
server.js's own port bind, which this respects rather than duplicates.

🔑 AND THE BOARD KNOWS WHETHER IT IS THE TASK'S BOARD. The shim stamps
`KOSMOS_WIN32_BOARD_TASK`; that is the win32 analog of the Mac asking launchd
whether the running pid IS `com.kosmos.board`. Without it, `/End` would stop
nothing and `/Run` would start a second board that dies on the port — a restart
that reported success and did nothing. `engine/boardrestart.js` now has a win32
arm gated on exactly that, and `canSelfRestart(platform)` / `selfRestart(platform)`
take the platform as a parameter.

📌 IT REFRESHES, IT DOES NOT RE-IMPOSE. Five states, two of which write. A task
the person switched off or deleted is LEFT that way and reported — the posture
`machine.js` already takes toward a disabled login item. A claim file records
that Kosmos registered once, so a deletion is respected rather than undone at the
next boot. A from-source checkout registers nothing at all.

📌 AND SETTINGS NOW RAISES THE SUBJECT. `machine.boardAutostartCheck` returned
null off-darwin, so `check()` filtered the row away and no Windows board ever
mentioned that it would not come back. It has a win32 arm: missing / switched off
/ in place, each naming the task and how to remove it.

STILL OWED HERE: the console window. A task-launched board has no visible window
(measured: `MainWindowHandle` 0), which is right for a logon — but it also means
the board's stdout goes nowhere, so the registration sentence printed at boot is
seen only by somebody who started Kosmos from a console. And `KosmosLauncher.cs`
runs a hand-started board in its own window, so it dies with that window; the fix
is #2752, merged (the board hands itself to this task).

### BLOCKER 4 CLOSED (2026-09-09) — `engine/win32board.js`

An at-logon Scheduled Task `Kosmos\board`, registered from XML naming the current
user — reusing `win32job`'s `taskUser`/`xmlEscape` so the measured
"`/SC ONLOGON` needs administrator" fact has ONE copy, not two. Same `Kosmos`
folder as the agent tasks (one place a person looks), different prefix, so nothing
listing `Kosmos\agent-` picks it up. Registered by the board's own first run,
because a portable zip has no install step. The task runs a durable `board-boot.js`
in the anchor which reads the SHARED `engine-path` pointer, so one write moves the
board and every agent onto a new install together.

`boardrestart.js` gained a win32 arm, with `canSelfRestart(platform)` /
`selfRestart(platform)` as parameters rather than `process.platform` reads. Two
boards are prevented by `server.js`'s existing port bind — respected, not
duplicated.

🔑 MEASURED, INCLUDING ONE HYPOTHESIS REFUTED. The tempting one-call restart
policy, `StopExisting`, leaves **NO BOARD AT ALL**: the new instance starts while
the old still holds the port, dies on EADDRINUSE, and the old is stopped anyway.
Zero boards, not two. `IgnoreNew` is correct — and `/Run` against an
already-running task starts nothing WHILE STILL REPORTING SUCCESS, so no caller
may read that exit code as proof. The port also stays bound ~1s after `/End`,
which is why the restart is End → wait → Run from a detached helper.

`machine.boardAutostartCheck` returned null off-darwin, so Windows Settings never
raised the subject while the answer was NO for every Windows board ever run. It
now has a win32 arm — missing / switched off / in place — each naming the task and
the removal command.

✅ A REAL LOGON, MEASURED 2026-09-11 (R8 of 7c-6): the board came back from this
task at Josh's reboot, headless. Since #2752 a hand-started board hands itself to
this task instead of dying with its window.

### BLOCKER 5 — an agent's answer never reached the board (found 2026-09-11; ✅ FIXED by #2754, merged as `fd8a0504`, shipped in 0.6.55)

Every new agent's instructions are written with `kosmosCliShown()` baked in —
"you can message another agent with `kosmos msg <name> ...`". `engine/clipath.js`
has NO win32 branch (verified: no `process.platform` read and no `.exe`/`.cmd`
candidate in its code; `win32` appears only in comments), so it falls through to a
bare `kosmos`, and
the Windows zip ships no such file. Agents are being told to run a command that
does not exist.

It is not only `kosmos msg`. Every operator message the board delivers ends `to
answer, run: kosmos reply`, and that is the only command that reaches the person.
Measured 2026-09-11: an agent on a zip built from main answered with `kosmos reply
"OSPREY"` in PowerShell and got `The term 'kosmos' is not recognized`. So on the
zip a person could message an agent and never see its answer. The 7c-6 R3 check
read the answer from the transcript, which is why it passed. `msg`, `post` and
`react` were also pane-only on the server, and a Windows agent has no pane.

✅ **Fixed by #2754 (branch `win32-kosmos-cli-570`, merged 2026-09-11):**
- a Node `kosmos` for agents in the zip's `bin\`, with a `kosmos.ps1` shim for
  PowerShell (the arguments go as JSON in a private temp file the CLI deletes on
  read, never on a command line, at any length) and a `kosmos` shim for Git Bash;
- that folder put first on every agent's PATH by its supervisor;
- /api/msg, /api/post and /api/react resolving the agent's per-run token.

Verified live with candidate zips built from all three branches:
- the agent's `kosmos reply` answers landed in its board thread, before and after
  a restore, with the first (`.cmd`) shim and again with the `.ps1`;
- its `kosmos msg reh-a` reached reh-a labelled as that colleague;
- through the `.ps1`, a TWO-LINE answer holding `"quoted" &` reached the board
  exactly (`ALPHA-570\nBRAVO-570 "quoted" & done.`).
- that check ran the FIRST `.ps1`, which passed its arguments in an environment
  variable. The temp-file version that ships (CLI review rounds 2-3) was then run
  live too, on candidate `0.6.55+ee61accaae70` (this PR's head plus the README
  branch, on main with #2752): Z0-Z6 passed with the answers on the board, the
  two-line answer arrived exactly, `kosmos msg reh-b` reached reh-b as that
  colleague, and no argument file was left in %TEMP% (recorded on PR #2754).

⚠️ **Talk ✅ was true for reply, msg, post and react only** (parity audit 2026-09-12,
rows #43-#46). The same zip lacked `kosmos task message` (in every task
notification), `kosmos feedback write`/`show` (taught to the Project Manager role
daily) and `kosmos room reopen`, and `kosmos reply --help` SENT "--help". Branch
`win32-cli-verbs` ports all three plus the #1674 `--help` guard, makes the task
message route resolve the agent token, and adds
`tools.windows-kosmos-cli-verbs-parity.test.js`, which holds the Windows command to
install/kosmos and to every `kosmos <verb>` the tree teaches. Its live check (the
answers seen in the board thread) is in `.claude/plans/win32-cli-verbs-20260912T2150.md`
and is owed on the first Windows build that carries it.

Known limit: the PowerShell shim is a `.ps1`, so it runs only where the execution
policy allows scripts. Claude Code's PowerShell runs with a process-scope Bypass
(measured), and a person's default Restricted PowerShell would refuse it. The
follow-up is a replacement that keeps the arguments off the PowerShell-to-native
hop. A PE shim alone would not do that; see "What is still open" below. (A first
`.cmd` shim was dropped: it kept one line of a
multi-line answer and ran the tail of a `"...&..."` message as a command.)

### What is still open

✅ Answered 2026-09-10: installkosmos.com serves a Windows zip, 0.6.37 (`/dist/latest-win.json`).
✅ Since 2026-09-11 (~13:30 UTC) it serves **0.6.55**, built from main `fbe246e0`,
sha256 `062e836ee0df9a919c1563a623417bed182b9afd6aac312d8ef9043928ec796c`. The
alias, the versioned zip and the `.sha256` were each downloaded and hashed.

Still open here: the `.ps1` execution-policy dependency above. ⚠️ A PE `kosmos.exe`
alone would NOT carry an agent's words intact. PowerShell 5.1 drops embedded
double quotes on ANY native command line (the reason `kosmos.ps1` exists; see its
header), so a native shim receives an already-mangled argv. Whatever replaces the
`.ps1` has to keep the arguments off the PowerShell-to-native hop, or only take
over where scripts are refused.

---

## 4. The one thing that degrades, and the upgrade hiding in it

A streaming session's entry in `claude agents --json` carries **no `status`
field** (measured — a real interactive agent shows `status: idle`, the streaming
one showed nothing). `win32capture` reads exactly that, so it would answer UNKNOWN
for every agent. That is the safe direction, and the PRIMARY state reader
(`selfreport` + `reconcileReport`) is untouched — but the coarse working/idle
fallback is lost.

✅ DONE in 7c-5 (2026-09-10), and the measurements it rests on are in
`.claude/plans/win32-stream-state-570-20260910T1620.md`: one message is one turn
(init .. result, never batched), nothing arrives before a message on a fresh or
resumed session, and `claude agents --json`'s pid is the spawned child's.

🔑 THE FIX IS BETTER THAN WHAT IT REPLACES. Under 7c-1 the supervisor holds the
agent's stdout, so it sees EVERY event: assistant messages, tool calls, results.
The Mac scrapes a terminal pane and guesses; Windows would have the real stream.
Slice 7c-4 is where Windows stops imitating the Mac's worst mechanism and gets a
better one — and it is the slice most likely to surprise, which is why it is
sized at 1–2 sessions rather than half of one.

---

## 5. What is NOT yet known

Honest gaps in this document:

- **First run / install on Windows is unsurveyed.** Nobody has walked a clean
  Windows box from download to a working board. This is capability #1 and it is
  the only one with no evidence at all.
- **An update by hand has been run twice (2026-09-11), not yet from a real old
  release.** Each time a zip was unpacked over a running install, then Kosmos.exe
  was run:
  - candidate zips: the board was replaced in 8.8-9.6s over three runs, and all
    agents kept running (idle);
  - the shipped 0.6.55 bytes over the same build: they were unpacked as a
    download (Mark of the Web on every file), Kosmos.exe exited 0 in 3.2s and
    handed off to the running board, and Z0-Z6 passed after.

  The in-app updater (capability 7) is still unbuilt.
- ✅ **RESOLVED ON MAIN by #2825 (03b99146, 2026-09-11): an update that changes
  the NODE RUNTIME can be handed off.** The anchored
  `%LOCALAPPDATA%\Kosmos\runtime\node.exe` is the running interpreter of the task
  board and every supervisor. Before #2825, `win32anchor.ensureAnchored` copied
  over it when the size differed, and Windows refused that copy with EBUSY. So
  `ensureInstalled` failed, the hand-off was skipped, and the person got "port in
  use" until the next logon. Creating an agent failed the same way. The served
  0.6.55 still behaves that way.
  - Measured 2026-09-11: a running node.exe cannot be overwritten, but it CAN be
    renamed, and a new file can take its name while it keeps running.
  - The fix: `replaceInterpreter` (`engine/win32anchor.js:259`) stages the new
    copy beside the old, renames the old one aside and renames the new one in.
    `retireLeftoverInterpreters` (:303) sweeps the retired copies once nothing
    runs on them.
  - ⚠️ Proven by `engine/win32anchor.test.js` against a real running copy of
    node.exe (all 16 win32 engine suites, 341/341 on the box, per #2825). The
    live swap on the box's REAL anchor was not run (#2825, "Not done here"), and
    no served Windows zip carries the fix yet.
- ✅ **RESOLVED ON MAIN (2026-09-11/12, the #1704 set): a named world's agents
  get that world's board token.** History: only the board applied a world's
  `AGENT_WORKFORCE_DATA`. So a named world's supervisor, `kosmos` CLI and report
  hook read the DEFAULT world's `board.token`, sender tokens and Windows session
  records, and were refused. It was reachable from the v1 switcher on every
  platform. What closed it:
  - #2845 (a677a0b5): Windows agents learn their Kosmos, with per-Kosmos task and
    pipe names. The world rides on the task line, and the anchored boot shim
    applies it (`worlds.applyAgentWorldEnv`) before the supervisor loads
    (`engine/win32anchor.js:175-180`);
  - #2852 (fd19bb6e): a board can boot into a named world;
  - #2874 (1b3b81b0): the same on the Mac. `bin/agent-supervisor.sh:318-324`
    applies the world, and each pane gets `KOSMOS_WORLD` (:450);
  - #2877 (e1e91030): a switch asks whether to pause this Kosmos's agents or keep
    them running;
  - #2879 (136172a7): a board serving another Kosmos answers a kept-running
    agent's send with 421 `wrongWorld` (`server.js:1401-1437`). The send is kept
    in the agent's own Kosmos's outbox (`engine/outbox.js`), and that Kosmos's
    board drains the outbox when it opens;
  - #2886 (e07ec774): lifts #2849's named-world spawn guard (718c72b8), so a named
    Kosmos starts and pauses its own agents;
  - #2892 (5aa75512): import at New Kosmos and from a settings cog (below).

  ✅ **MEASURED LIVE 2026-09-12: 18/18** on main `5aa75512` (0.6.59), run from a
  worktree against the box's real board, tasks and agents. The script is
  `C:\Users\joshu\kosmos-scripts\live-1704-check.js`, and its log is
  `live-1704-log.txt` beside it. Every verdict read `schtasks`, the disk or a GET
  route, never the route's own answer:

      1      the board runs the new build on Kosmos 1
      2a-2d  a Kosmos "Live1704" made with reh-a imported: it is not open,
             reh-a waits for it, the copy is in its store, and Kosmos 1's reh-a
             is untouched
      3a-3c  a PAUSE switch into it: the board reboots there, Kosmos 1's tasks
             are Disabled and stopped, and the imported reh-a starts under its
             world-keyed task (Kosmos\agent-reh-a+live1704)
      4      an agent created there runs under a world-keyed task, and no
             Kosmos 1 task is made
      5      reh-b, imported from the cog into the open Kosmos, starts at once
      6a-6c  a KEEP switch back: Kosmos 1's paused tasks are re-enabled and
             Running, and Live1704's agents are still the same processes
      7a-7c  the outbox: Kosmos 1's board answers reh-a's reply with 421, the
             reply is kept in Live1704's outbox, and the switch back delivers it
             into reh-a's thread
      8a-8b  a clean restore: the run's agents are removed, and the box is as
             it was

  Left on the box: the Live1704 Kosmos itself, because nothing can delete a
  Kosmos (see "Nothing can delete a Kosmos" below).

  📌 IMPORT (#1704 PR4, `world-import-agents-1704`). Agents can be copied from one
  Kosmos into another, at New Kosmos or from any Kosmos's settings cog
  (`engine/worldimport.js`). Each copy is complete (profile, avatar, brief), gets
  its own folder and a world-keyed task name, and starts through
  `engine/worldstarts.js` when its Kosmos opens. On Windows the source's model and
  account are read back from its task's argument line (`win32job.taskSpec`).
  An import into the Kosmos that is open starts at once, unless something holds it
  (live execution, a failed setup, or a removal landing in between), and the page
  says why. One into a Kosmos that is not open is recorded there and starts when
  that Kosmos next opens, and that Kosmos's settings pane shows what is waiting to
  start in it.

  ⚠️ STILL UNEXERCISED: a live Mac import-and-start. #2892 proves the Mac start
  path (folder trust, `installJob`, launchctl) only through the runner seam. A
  live run is queued for a Mac tester (#2892, "Needs Angel (live Mac)").
- **Nothing can delete a Kosmos, on any platform.** `engine/worlds.js` creates a
  Kosmos (`createWorld`, :340), switches to it (`setActiveWorld`, :370) and
  renames it (`renameWorld`, :410), and exports no delete. No `/api/worlds*`
  route in `server.js` deletes one either. The routes are list (:3083, :3116),
  create (:3125), switch (:3176), import (:3308) and rename (:3356). So a test
  or unwanted Kosmos stays in the switcher for good. This is not
  Windows-specific. The live check's Live1704 stays on this box because of it,
  along with its removed agents' disabled tasks (the log's "left behind" line).
- **A broad Mac-only-assumption sweep is in flight.** A targeted sweep for
  tmux/launchctl found `chat.js` (the blocker) and `runningas.js` (degraded) as
  the only live call sites outside already-ported modules. A wider survey — for
  `~/Library`, `.plist`, `open -a`, `osascript`, POSIX file modes, `.sh` scripts,
  `process.getuid` — is running now and its findings belong in this section.
- **Multi-agent load is unmeasured on this box.** See §7.

---

## 6. Sequencing

    DONE   #2537, 7c-1..7c-6 (the table in §3), the supervisor fixes #2722-#2737,
           the launcher hand-off #2752, the agent's kosmos command #2754
           (BLOCKER 5), the README and manifest #2759, R8b (a real logon on
           the zip install), and THE WINDOWS v1 RELEASE: 0.6.55 served
           2026-09-11 (Baron built it on mortals, this box verified the
           bytes and ran them live, and it shipped on Josh's go)
           a new Node runtime can update: #2825 (§5; on main, not yet served)
           a named world's agents get its board token: the #1704 set #2845,
           #2852, #2874, #2877, #2879, #2886, #2892, live 18/18 on
           5aa75512 (§5)
    FOLLOW-UP  deleting a Kosmos            (§5: no route and no engine
                                             function; cross-platform)
               a live Mac import-and-start  (§5: queued for a Mac tester)
    THEN   first-run survey + fix           (capability 1, a clean box:
                                            Windows Sandbox needs admin and a
                                            reboot, so it waits on Josh)
    LATER  a real updater                   (capability 7, a fast-follow)
           the .ps1 execution-policy dependency (§3c: a PE shim alone would
           mangle quotes)

    Every cut that ships any of this goes to STAGING first, then PROD (see
    the handshake under "Do this next").

✅ THE OLD RULE, "NO WINDOWS RELEASE UNTIL 7c LANDS", IS MET: 7c landed and R3
passed. The gate now is the list above.

---

## 7. On parallelising this

📌 THE CRITICAL PATH IS SERIAL, and saying so is more useful than pretending
otherwise. 7c-1 decides the launch shape; 7c-2, 7c-3 and 7c-4 all consume it.
Putting more workers on a dependency chain does not shorten it — it produces
merge conflicts and rework.

📌 (Superseded 2026-09-11: 7c landed, so a Windows Kosmos agent CAN now be given a
task. This paragraph used to say the fleet could not do this work on Windows yet,
because an agent you cannot message cannot be given a task.)

⚠️ AND THE BOX'S MEASURED CAPACITY IS 3–4 AGENTS, NOT 8–12. The plan records
"3-4 now, 6+ with [a second DIMM]" — 8–12 was the TARGET the second DIMM was
meant to unlock, never a measured figure. The DIMM is not installed. Separately,
the 2026-09-04 `0x124` was a CPU machine check that a passing memory diagnostic
does NOT clear, and sustained multi-agent load is exactly the workload the plan
said not to discover bad hardware under.

WHAT ACTUALLY PARALLELISES, and is running or queued:

    remove.test.js fixture port      independent      unblocks the removal suite on Windows
    runningas.js win32 arm           independent      capability 3, the account/model read
    Mac-only assumption survey       independent      fills §5
    first-run survey                 independent      capability 1

That is roughly four or five real streams alongside the critical path — which is
what this work actually has, and it is worth more than a number chosen in advance.

---

## 8. Decisions taken, so they are not re-litigated

- **Streaming session over the messaging socket.** Claude Code's own local session
  messaging DOES reach a Kosmos agent (proven: a message delivered and acted on in
  ~5s, against an agent whose messaging env was deliberately stripped). It needs
  no relaunch and is far less work. It is NOT the choice, because the pipe and its
  token are undocumented, the board is not a Claude session so it holds neither,
  and `claude --help` exposes no send verb for a local session. It stays on record
  as the fallback if 7c-1 costs more than it looks.
- **Merge #2537 rather than hold it.** Complete, rehearsed, and drift has already
  bitten twice (74 commits once, 36 again). Merging turns Windows on; the rule
  that no Windows release is cut until 7c lands is what makes that safe.
- **`SUPPORTED` stays as it is.** It cannot be half-landed — it is the switch that
  arms live execution — so the honesty lives in the release rule, not in the flag.
