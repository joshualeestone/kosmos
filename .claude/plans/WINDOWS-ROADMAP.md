# ⚑ RESUME HERE — Kosmos on Windows

**If you are a new session picking this up, read this block, then §2 and §3. Nothing
else is required to continue.**

    where the work lives   branch win32-streaming-agent-570  (pushed)
    already on main        PR #2537 -- the keep-alive slice (6964ab67)
    this file              .claude/plans/WINDOWS-ROADMAP.md   <- the whole road
    the keep-alive log     .claude/plans/win32-keepalive-570.md  <- that slice only

## The one-line state

Four blockers stood between Windows and a usable Kosmos. **Two are closed** (3:
first run now names the real installer; 4: the board comes back at logon).
**One is guarded but not solved** (2: the updater refuses honestly instead of
lying "Up to date"). **One is the critical path** (1: you cannot message a
Windows agent) and its substrate is built and measured — what remains is wiring.

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

## Do this next (slice 7c-3)

The channel. The supervisor holds `handle.send()`; the BOARD is a different
process and has no way to call it.

1. A local channel per agent -- a named pipe (`\\.\pipe\kosmos-agent-<name>`) is
   the Windows analog of the unix socket, and `win32supervisor.main()` is where it
   is served, because that is the process holding the stdin.
2. Agent-token auth on it, and honest failure when the supervisor is down: the
   `could_not` contract `chat.js` already has, not a silent drop.
3. Then 7c-4 (`chat.js`'s win32 arm on that channel, keeping verify-before-send)
   and 7c-5 (re-run R1–R8, and R3 for the first time). §3 has the sizing.

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
| 3 | board + roster | ✅ MEASURED (state: partial, see §4) |
| 4 | **talk to it** | ❌ **BLOCKER 1** — §3 |
| 5 | stop/restart/remove/restore | ✅ MEASURED |
| 6 | survive a reboot | ✅ AGENTS measured (R8). BOARD: **BLOCKER 4 CLOSED** 2026-09-09 — an at-logon task, proven end to end via /Run; a real logon still owed |
| 7 | **update the app** | ❌ **BLOCKER 2** — §3a. The ANCHOR (not stranding the fleet) is designed and unit-tested; the UPDATER ITSELF cannot run on Windows at all |

🛑 THAT IS FOUR BLOCKERS, NOT ONE. This table said "one blocker" on 2026-09-09
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

⚠️ AND READ THAT LIST FOR WHAT IT IS. R1–R8 measured the AGENT LIFECYCLE, and it
is genuinely solid. What it did not touch is everything either side of it: getting
Kosmos onto a machine at all, getting `claude` onto it, keeping the BOARD alive,
and updating any of it. Those are capabilities 1, 6 and 7, and three of the four
blockers live there. The rehearsal was never wrong — it was narrower than the bar
in §1, and this file read it as broader for a day.

---

## 3. THE BLOCKER, and the plan for it (7c)

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

🔑 AND IT RESUMES, which is what keep-alive rests on. A piped child cannot be
ADOPTED — adoption means holding a stdin somebody else holds — so a supervisor
restart or a reboot must re-open the conversation instead. Measured:

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
| 7c-3 | board → supervisor channel: a local named pipe per agent, agent-token auth, honest failure when the supervisor is down | ~1 session |
| 7c-4 | `chat.js` win32 arm on that channel, keeping verify-before-send and the `could_not` contract | ~½ session |
| 7c-5 | state + transcript from the EVENT STREAM (see §4) | 1–2 sessions |
| 7c-6 | re-run R1–R8, and R3 for the first time | ½ session + a reboot |

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
  a real mechanism instead of a dead end. See §3c.
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
is unchanged, so a hand-started board still dies with its window.

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

📌 STILL OWED: a REAL LOGON. The trigger shape is byte-identical to the one R8
measured firing at a real logon, and `/Run` was proven end to end, but the box was
not rebooted. `KosmosLauncher.cs` is also unchanged, so a hand-started board still
dies with its window.

### Also found (DEGRADED), and it is waiting under BLOCKER 1

Every new agent's instructions are written with `kosmosCliShown()` baked in —
"you can message another agent with `kosmos msg <name> ...`". `engine/clipath.js`
has NO win32 branch (verified: no `win32`, no `.exe`, no `.cmd`,
no `process.platform` in the file), so it falls through to a bare `kosmos`, and
the Windows zip ships no such file. Agents are being told to run a command that
does not exist.

`messages.js` describes the failure mode in its own comment: "an agent whose shell
says 'command not found' never reaches the engine, so its failure leaves no
trace." Masked today only because BLOCKER 1 means no agent can be asked to do
anything — it becomes live the moment delivery lands.

### What is still open

Whether installkosmos.com actually serves the Windows zip today. The publish
script only stages into a separate site checkout, so this repo cannot answer it.

---

## 4. The one thing that degrades, and the upgrade hiding in it

A streaming session's entry in `claude agents --json` carries **no `status`
field** (measured — a real interactive agent shows `status: idle`, the streaming
one showed nothing). `win32capture` reads exactly that, so it would answer UNKNOWN
for every agent. That is the safe direction, and the PRIMARY state reader
(`selfreport` + `reconcileReport`) is untouched — but the coarse working/idle
fallback is lost.

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
- **Update-without-stranding has never been exercised.** The anchor design exists
  precisely for it and is unit-tested, but no real update has been run.
- **A broad Mac-only-assumption sweep is in flight.** A targeted sweep for
  tmux/launchctl found `chat.js` (the blocker) and `runningas.js` (degraded) as
  the only live call sites outside already-ported modules. A wider survey — for
  `~/Library`, `.plist`, `open -a`, `osascript`, POSIX file modes, `.sh` scripts,
  `process.getuid` — is running now and its findings belong in this section.
- **Multi-agent load is unmeasured on this box.** See §7.

---

## 6. Sequencing

    NOW    merge #2537                      (done/in flight)
    THEN   7c-1  streaming child            <- everything downstream depends on it
           7c-2  board -> supervisor channel
           7c-3  chat.js win32 arm
           7c-4  state from the event stream
           7c-5  rehearsal R1-R8 + R3
    THEN   first-run survey + fix           (capability 1, currently unevidenced)
           a real update, end to end        (capability 7)
    THEN   Windows release

⚠️ NO WINDOWS RELEASE UNTIL 7c LANDS. `SUPPORTED` gaining win32 is the same
switch that arms live execution, so the claim and the capability cannot be
separated — merging turns Windows on. Shipping now would give people agents they
cannot talk to.

---

## 7. On parallelising this

📌 THE CRITICAL PATH IS SERIAL, and saying so is more useful than pretending
otherwise. 7c-1 decides the launch shape; 7c-2, 7c-3 and 7c-4 all consume it.
Putting more workers on a dependency chain does not shorten it — it produces
merge conflicts and rework.

🛑 AND KOSMOS AGENTS CANNOT DO THIS WORK ON WINDOWS YET, which is the whole
chicken-and-egg: an agent you cannot send a message to cannot be given a task.
That is capability #4, the thing being built. Until 7c lands, parallelism has to
come from Claude Code subagents (which work fine here and cost API tokens, not
box RAM) rather than from the Kosmos fleet.

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
    7c-2 channel design              designable now   while 7c-1 is built

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
