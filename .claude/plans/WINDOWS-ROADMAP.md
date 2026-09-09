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
| 1 | install + first run | **UNSURVEYED** — see §5 |
| 2 | make an agent | ✅ MEASURED |
| 3 | board + roster | ✅ MEASURED (state: partial, see §4) |
| 4 | **talk to it** | ❌ **THE BLOCKER** |
| 5 | stop/restart/remove/restore | ✅ MEASURED |
| 6 | survive a reboot | ✅ MEASURED |
| 7 | update without stranding | ✅ designed + unit-tested; NOT yet exercised by a real update |

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

So six of the seven capabilities are real. The missing one is the one the other
six exist to serve.

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
