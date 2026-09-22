# Angel handoff — BUILD #3410 (agent self-heal) — LAUNCH-PRIORITY

_Written 2026-09-22 ~14:57 CDT. Fresh session: this is a BUILD directive from Splinter, elevated to launch-priority ("build it, don't wait to plan-first"). Worktree + investigation are DONE; execute the build. Start immediately._

## The task (Splinter, launch-priority — he's holding the public launch for it)
Josh (testing 0.6.88): "I don't want to run Claude Doctor. I want Kosmos to solve this for me." Card **#3410** (claimed:angel). When an agent's Claude Code hits a transient network/API error, it wedges and never recovers; the app shows opaque "Can't tell" and there's no non-terminal way back.

**Two failure states to detect + auto-recover (Splinter's read of Josh's 7 screenshots):**
1. **WEDGED (alive but stuck):** pane shows `API Error: Can't reach the API server (ENOTFOUND)` OR `Your computer went to sleep mid-response`. Process is UP, so the supervisor's alive-check leaves it. Never retries out.
2. **NOT RUNNING (fully down):** "No window to show," only Open Terminal / Trust & Restart / Remove.

**Required:** detect BOTH states and **auto-restart/reconnect when the Mac wakes or the network returns — NO terminal, NO claude-doctor.** Also: handle the Claude Code "auto-update failed / run claude doctor" so it never surfaces raw.

## Worktree (ALREADY CREATED)
`~/work/kosmos-agent-self-heal`, branch `agent-self-heal-3410`, off origin/main. Build there. (Bootstrap envrc: `bash ~/.claude/scripts/bootstrap-worktree-envrc.sh`.)

## Investigation done — build on these exact findings

### A. DETECTION — `engine/status.js` (the pane classifier)
- The `STATE` enum is ~line 250-290: has `AUTH_FAILED`, `IDLE`, `STOPPED`, `RESTARTING` (#2019 — "in transition on purpose, by us," self-heals when the pane returns), `BLOCKED`, `UNKNOWN`, plus RATE_LIMITED/WORKING/NEEDS_YOU above. **Add `CONNECTION_LOST: 'connection_lost'`.**
- The precedent to MIRROR: auth-error detection. `AUTH_FRIENDLY_MESSAGE` regex (~line 1983) + `friendlyAuthLine(rows)` (~line 2870) match a pane row and `classify()` (~line 3284) returns `AUTH_FAILED` with a capped one-line evidence string. **Add a sibling** `NETWORK_LOST_MESSAGE = /Can't reach the API server|ENOTFOUND|check your internet or DNS|(?:computer|Mac|machine) went to sleep mid-response/i` and a `networkLostLine(rows)`, and in `classify()` return `CONNECTION_LOST` (with the matched line as evidence) — placed at the SAME precedence tier as the auth check (before the working/idle chrome checks, because a wedged pane still draws working-like chrome — that's the whole bug the auth case documents).
- **Do NOT key recovery on UNKNOWN generally** — key on the precise `CONNECTION_LOST` classification. That is what guarantees a legitimately-thinking/idle/working agent is NEVER false-restarted. This is the load-bearing correctness invariant.
- `reconcileReport()` (~line 5637) merges scraped verdict + self-report + disruption records; it's where RESTARTING/self-heal lives. Route CONNECTION_LOST through it so a restart shows RESTARTING (not "gone") and self-heals when the pane comes back.

### B. RECOVERY / RESTART machinery
- The relaunch path (what "Trust & Restart" calls) is `engine/ensure-launch-trust.js` (my #3406 proof touched it as "C-2 Mac relaunch"). This is the restart primitive to invoke for recovery. Read it first.
- The supervisor `bin/agent-supervisor.sh` alive-check (~line 147-168) sees a wedged claude's process UP → `alive=1` → won't touch it. Leave the supervisor as-is (it owns crash-recovery); the recovery orchestration lives on the BOARD where classification runs.

### C. STILL TO INVESTIGATE (do this first in the fresh session)
1. **Where the board periodically evaluates agent status** (the caller of `classify()` / a status-poll loop / `reconcileReport` at ~5673) — that's where the auto-recovery check hooks in: "if state==CONNECTION_LOST or (not-running) AND a network probe succeeds → restart via ensure-launch-trust, recording a disruption so it shows RESTARTING."
2. **The "network returns / Mac wakes" trigger.** Simplest robust design: on each status poll, if an agent is CONNECTION_LOST/not-running, run a cheap network reachability probe (e.g. a DNS/HTTPS check to the API host); only restart when it succeeds (so we don't restart into a still-dead network). Investigate whether a macOS wake hook already exists; a poll-based network probe is sufficient and simpler.
3. **Bounded retries + backoff** so a persistently-down network doesn't restart-loop. Record attempts per agent.
4. **Auto-update handling** ("run claude doctor" / "auto-update failed"): scope where that surfaces and suppress/handle it. Lower priority than the recover-on-connection-loss core.

## Boundary with Mona (#3410 UI side — she's building it)
I emit, per agent: `state: "connection_lost"` + a plain `detail` string ("Lost its connection, reconnecting…") + `recovering: true` while a retry is in flight. Her UI reads that to show plain language + a Reconnect affordance, and a "Start this agent" button for the not-running case. (I proposed this shape to her; confirm/rename if she needs — do NOT block the build on it.) Homer owns the win32launch equivalent of #3410 — coordinate the platform boundary with him.

## Tests (required before PR)
- `status.js` classification test: a pane holding the ENOTFOUND line → CONNECTION_LOST; a pane holding "went to sleep mid-response" → CONNECTION_LOST; **control: a normal working/idle/thinking pane is NOT CONNECTION_LOST** (the load-bearing control — proves we won't false-restart).
- Auto-restart test: fires ONLY on CONNECTION_LOST/not-running + network-probe-up; NEVER on working/idle/thinking; respects the retry bound.
- Run `tools/run-tests.sh` (full node suite) AND `yarn test:shell` — the "multiple indices" gotcha bites (a new STATE enum value may be pinned in status.test.js and elsewhere). Plan file + challenge-loop + proof named EXACTLY `agent-self-heal-3410-pre-challenge.md`.

## Status of coordination (all done, no action needed)
- Splinter: ACKed, building now (I replied "on it, building now, launch-priority").
- Trust fix: DONE + validated on Josh's laptop; awaiting only his promote go (Splinter). Safety valve clear (no trust prompts in any of the 7 screenshots).
- Durability-hardening (pin config vs future Claude-CLI path change) — separate follow-up, waits on Homer's Windows baseline.
