# win32 create-side record-write (#570 / #253)

The create-side sibling of the win32 roster provider (`win32-roster-570.md`,
shipped as PR #2171). The roster reads Kosmos-owned sessions out of
`engine/win32sessions` and emits them fail-closed; it ships EMPTY until something
records sessions. This is that something.

## Problem

On a Mac, "this session is Kosmos's" is stamped by the startup script running
`tmux set-option @kosmos_agent <name>` at every session start (create.js writes
the launchd plist; bin/agent-supervisor.sh does the stamp). Windows has no tmux
and no launchd, so the ownership mark is a row in `engine/win32sessions` keyed on
the session's UUID.

But that UUID is Claude's, not ours: `claude agents --json` reports whatever id a
session runs under. To record a session we must KNOW its id, and the only way to
know it before the session exists is to PIN it.

## Decision: pin the id (Design A)

`prepareSession({name, runner})` in `engine/win32create.js`:

1. mints a canonical v4 UUID (`crypto.randomUUID()`),
2. writes the ownership record via `win32sessions.record(uuid, {name, runner})`,
3. returns `{ ok, sessionId, launchArgs: ['--session-id', sessionId] }`.

The interactive win32 spawn then starts `claude --session-id <sessionId>`, so the
session runs under the id we recorded, and the roster emits it.

### Why the id round-trips (MEASURED, not assumed) — 2026-09-04, this Mac

An interactive `claude --session-id <uuid>` came back from `claude agents --json`
as `{ sessionId: <uuid>, kind: "interactive" }` — the exact id passed in. Two
constraints fell out of that measurement and both bind the spawn:

- **The spawn MUST be interactive.** `claude --bg` prints
  `--bg manages the session id; ignoring --session-id` and mints its own, so a
  backgrounded session would never carry the recorded id and the roster
  (fail-closed) would never emit it.
- **The spawn MUST start top-level.** A `CLAUDE_CODE_CHILD_SESSION` environment
  marker (inherited when claude is spawned as a child of another claude session)
  suppresses registration in `claude agents --json` and turns transcript saving
  off. The spawn must start claude as its own top-level process.

### One mint point

The id goes to two places — the record AND the `--session-id` flag — and they
MUST be the same value, or the board records one session while Claude runs
another and the live session stays unrecorded (invisible, fail-closed) forever.
Minting inside `prepareSession` and returning both the id and the launchArgs that
carry it makes them equal BY CONSTRUCTION. This is the "two copies of one fact"
defect this codebase keeps paying for; a caller that minted its own id and
recorded separately would reintroduce it. The caller never mints.

### Rejected: discover the id (Design B)

Launch claude, then diff `claude agents --json` before/after to find the new
session. Rejected: racy (a concurrent creation or an operator session starting in
the same window is indistinguishable from ours) and it needs a live-session poll
with a timeout, where the pin is deterministic and needs neither.

## Scope

This module is the RECORD + ARG producer, unit-tested on a Mac through the real
`win32sessions` store (7 tests, including an end-to-end run of a prepared session
through the real `win32roster` + `status.js`: what create WRITES is exactly what
the board READS). `abandon()` drops a session whose spawn never started.

It is DELIBERATELY NOT wired into `create.js` yet. `create.js` launches only via
launchctl/plist (Mac); recording a session that no spawn will start would file
ownership of a session that never goes live. The record is written at the moment
a real spawn is about to happen, which is where the win32 launch branch will call
`prepareSession()` and, on a failed spawn, `abandon()`.

## Port order (this lane)

roster (#2171, DONE) -> **create.js record-write (this PR)** -> win32 interactive
spawn (consumes launchArgs; Windows-runtime plumbing, built+measured on a real
box) -> setPaneCapture win32 state -> LAST: flip platform.js SUPPORTED to include
win32.

## Known limitation to carry into the wiring arm

`win32sessions.record()` is a non-atomic read-modify-write (read the whole record,
set one key, write it back atomically via temp+rename). The write is atomic; the
read-modify-write is not. `prepareSession` is the first per-agent-creation call
site, so if the win32 spawn path ever creates two agents concurrently across
separate OS processes, a lost update could silently drop one recorded session even
though both `record()` calls return ok:true. This is pre-existing in
`win32sessions.js` (on main, converged through 9 blind reviews for #2171) and is
out of scope here — there is no live trigger until this module is wired. When the
win32 create path is built, either serialize win32 agent creations or make
`record()` a locked read-modify-write. Flagged so the wiring arm decides it
deliberately rather than rediscovering it.
