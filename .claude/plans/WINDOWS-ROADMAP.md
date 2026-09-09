# ⚑ KOSMOS ON WINDOWS — the master plan

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
| 1 | install + first run | ❌ **BLOCKER 3** — §3c. No in-product way to get `claude` onto a clean box |
| 2 | make an agent | ✅ MEASURED |
| 3 | board + roster | ✅ MEASURED (state: partial, see §4) |
| 4 | **talk to it** | ❌ **BLOCKER 1** — §3 |
| 5 | stop/restart/remove/restore | ✅ MEASURED |
| 6 | survive a reboot | ⚠️ **HALF** — the AGENTS come back (R8, measured). The BOARD does not: **BLOCKER 4**, §3c |
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
| 7c-1 | agent runs as a STREAMING CHILD: `-p --input-format stream-json` with pipes, held by the supervisor. Create starts the SUPERVISOR rather than the agent, which collapses today's two launch paths into one | 1–2 sessions |
| 7c-2 | board → supervisor channel: a local named pipe per agent, agent-token auth, honest failure when the supervisor is down | ~1 session |
| 7c-3 | `chat.js` win32 arm on that channel, keeping verify-before-send and the `could_not` contract | ~½ session |
| 7c-4 | state + transcript from the EVENT STREAM (see §4) | 1–2 sessions |
| 7c-5 | re-run R1–R8, and R3 for the first time | ½ session + a reboot |

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

📌 OPEN QUESTION, and it decides how bad this is: whether `lastAttempt.because`
("the installer could not be started: spawn /bin/sh ENOENT") actually reaches the
Settings update card. If it does, this fails HONESTLY and a Windows user is told
to update by hand. If it does not, the button does nothing and says nothing —
which is the silent failure this codebase exists to refuse. **Settle this before
sizing the fix.**

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

- `engine/boardrestart.js` — no win32 arm anywhere; switching a world always
  falls back to "restart it by hand". Fails honestly. Needs a Windows
  equivalent of the launchctl/CLI restart, and there may not be a `bin\kosmos`
  wrapper to build one on — that is an open question.
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
