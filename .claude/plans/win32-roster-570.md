# Plan: #570 win32 roster provider (the Windows agent port, roster-first)

## Problem
The build behind card #253: a paneless (Windows) agent listed on the board without tmux.
Today win32 create dead-ends BEFORE the macOS gate: it refuses "couldn't check which agents
are running", because the roster's source is `tmux list-panes` and Windows has no tmux.

## Change (this PR = the roster slice only)
`claude agents --json` is the server-invokable roster source (windows-orchestrator proved it
on the box: fields pid/cwd/kind/startedAt/sessionId/name/status, all kind:"interactive").
- `engine/win32roster.js` turns that JSON into the exact PANE_COLUMNS tab-separated text
  `status.parsePanes` already reads, wired behind `status.setPaneSource` (server.js, on win32).
  The engine ownership + classification path is reused UNCHANGED behind the seam.
- `engine/win32sessions.js` is the Kosmos-created-sessions record (keyed on the session UUID),
  the win32 analog of the Mac tmux `@kosmos_agent` option.

## The fail-closed ruling (safety-critical; I own it)
`claude agents --json` lists EVERY Claude session including the operator's own. Two independent
fail-closed properties keep the board managing ONLY Kosmos's:
1. `command = "claude.exe"`. `status.isClaudeCommand("claude.exe")` is true (an emitted row
   classifies as a real agent, typeable/restartable), but `status.isNativeClaude` matches ONLY a
   3-segment version string (`^[0-9]+\.[0-9]+\.[0-9]+$`), so the "ours" PROCESS arm (`isNamedOurs ||
   isNativeClaude(command)`) does NOT fire on a synthesized row. Ownership on win32 is decided
   SOLELY by the claim column (isNamedOurs, claim===name). This is the load-bearing trick.
2. Emit ONLY sessions in the record. An unrecorded session (the operator's own) is never emitted.
A failed `claude agents --json` returns null (honest refusal via listPanes), never "" (which would
read as an empty machine off a look that never happened).

## Rejected
- command = a version string or "claude": isNativeClaude fires → EVERY session (operator's too)
  becomes ours via the process arm. "claude.exe" is the one value that classifies as an agent
  WITHOUT triggering it.
- name-keyed record: a stranger opening a session with a Kosmos agent's name would match. sessionId
  (a UUID, minted per session, never reused) gives the "dies with the session" property.
- emit-all-with-empty-claim (mark not-ours): safe too (command=claude.exe → not process-arm-ours),
  but emit-only-recorded is more defensive (operator sessions never reach any board code path). It
  is the future option if we ever want to SHOW non-ours sessions.

## Weakest premise
That the record is populated. This PR does NOT include the create.js record-write, so the roster is
readable but EMPTY until that lands (agents appear only once create records them) — which is exactly
the unblock this slice targets (create's roster refusal), not the full working roster. The record
write + the win32 create path is the next PR. Also: the win32 STATE (from a pane capture) is a later
seam (setPaneCapture); listed agents read "unknown state" until then — honest, not a break.

## Tests
engine/win32roster.test.js — 9, driven through the REAL status.js (parsePanes/isNamedOurs/
isAgentSession): recorded→ours+agent; unrecorded (operator's own)→never emitted; claude.exe+empty-
claim→not-ours (belt-and-suspenders on the process arm); run-null→null; readable-empty; runner rides
through; record round-trip + no-name/bad-id refused + corrupt-file→empty.

## Scope guard
This PR does NOT flip `engine/platform.js` SUPPORTED (still `['darwin']`). That is the LAST step of
the port, after delivery (Gap B, inbox socket) and capture are also green. The roster wiring is
independent of the still-closed gate on purpose (create must READ the roster before it reaches the gate).

## Verify (live)
Requires the Windows box (windows-orchestrator, via Splinter): confirm `claude agents --json` →
synthesized roster → create no longer dead-ends on "couldn't check which agents are running".
Not done-at-merge; batches into the Windows-box verify.
