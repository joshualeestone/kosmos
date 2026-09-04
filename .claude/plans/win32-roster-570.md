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
`claude agents --json` lists EVERY Claude session including the operator's own. Two LAYERED
fail-closed properties keep the board managing ONLY Kosmos's. They are layered, not independent (see
the caveat below): property 1 is the guarantee, property 2 is defense-in-depth that narrows.
1. EMIT ONLY sessions in the record (the LOAD-BEARING guarantee). A row is produced only for a live
   session whose sessionId is in the Kosmos-created record. An unrecorded session (the operator's
   own) is never emitted, so no board code path ever touches it, and no ownership arm can claim a row
   that does not exist.
2. `command = "claude.exe"` (defense-in-depth on the PROCESS arm). `status.isClaudeCommand("claude.exe")`
   is true (an emitted row classifies as a real agent, typeable/restartable), but `status.isNativeClaude`
   matches ONLY a 3-segment version string (`^[0-9]+\.[0-9]+\.[0-9]+$`), so the ownership PROCESS arm
   (the `isNativeClaude(command)` half of `isNamedOurs || isNativeClaude(command)`) does NOT fire on a
   synthesized row.
A failed `claude agents --json` returns null (honest refusal via listPanes), never "" (which would
read as an empty machine off a look that never happened).

⚠️ Caveat (found in iteration-4 review, corrected here rather than left overselling): property 2 is
NOT an independent backstop, and the earlier "decided SOLELY by the claim column" framing was wrong.
`isNamedOurs` has a legacy arm that matches a session NAME ending in `-discord`, independent of the
claim column AND of the command. So an unrecorded `*-discord`-named row with an empty claim WOULD
read as ours despite property 2. Property 2 closes only the isNativeClaude process arm, not the
`-discord$` name arm. What actually closes the hole is property 1 (no unrecorded row is ever emitted).
Not reachable today (operator sessions are named like `agent1-d2`, not `*-discord`), but the guarantee
is property 1; do not lean on property 2 alone.

## Rejected
- command = a version string or "claude": isNativeClaude fires → EVERY session (operator's too)
  becomes ours via the process arm. "claude.exe" is the one value that classifies as an agent
  WITHOUT triggering it.
- name-keyed record: a stranger opening a session with a Kosmos agent's name would match. sessionId
  (a UUID, minted per session, never reused) gives the "dies with the session" property.
- emit-all-with-empty-claim (mark not-ours): rejected, and the `-discord$` caveat above is exactly
  why it is LESS safe than it first looks - an emitted empty-claim row named `*-discord` would still
  read as ours via the name arm. emit-only-recorded avoids the question entirely (operator sessions
  never reach any board code path). If we ever want to SHOW non-ours sessions, that path needs the
  name arm accounted for, not just an empty claim.

## Weakest premise
That the record is populated. This PR does NOT include the create.js record-write, so the roster is
readable but EMPTY until that lands (agents appear only once create records them) - which is exactly
the unblock this slice targets (create's roster refusal), not the full working roster. The record
write + the win32 create path is the next PR. Also: the win32 STATE (from a pane capture) is a later
seam (setPaneCapture); listed agents read "unknown state" until then - honest, not a break.

Second premise, on the BINARY resolution (found in review, disclosed here rather than guessed at):
`defaultRun` resolves claude via `runners.resolveBin('claude').bin`, whose canonical (non-override)
rung builds `path.join(homeDir(), '.local', 'bin', 'claude')` with NO `.exe` suffix. Windows'
CreateProcess only auto-appends `.exe` for a BARE name resolved via PATH search, never for a string
that already carries a directory path - which this absolute join always does. So on a real Windows
box, unless `AGENT_WORKFORCE_CLAUDE_BIN` points at the actual claude executable, execFileSync likely
ENOENTs and `defaultRun` returns null forever. This fails SAFE (null -> honest refusal via listPanes,
never a false-empty machine), so it is not a correctness hazard for the board, but it means the
roster may not POPULATE on Windows until the bin is resolved correctly. Deliberately NOT patched in
this slice: the correct fix depends on how claude actually ships/invokes on the box (bare `claude.exe`
on PATH vs an absolute path), which only the live Windows box can answer - guessing a `.exe` rung here
would bake in an unverified path shape. The `AGENT_WORKFORCE_CLAUDE_BIN` override already works as the
escape hatch. Routed to windows-orchestrator (via Splinter) as the specific first thing to check on
the live-box verify below.

## Tests
engine/win32roster.test.js - 14, driven through the REAL status.js (parsePanes/isNamedOurs/
isFleetSession/isAgentSession): recorded→ours+agent; unrecorded (operator's own)→never emitted;
claude.exe+empty-claim→NOT a fleet session while a version-string command IS (the defense-in-depth
property, with a control that returns the dangerous answer); run-null→null; readable-empty; runner
rides through; record round-trip + no-name/bad-id/blank-name/zero-width-name refused; a
prototype-member-named id (toString) round-trips; JS-reserved id (__proto__) refused honestly, not
ok:true on a silent no-op; corrupt-file→empty; a corrupt store with an own __proto__ key + a matching
live id is not emitted (emit-loop validId gate); and a corrupt store with a zero-width name + a
matching live id is not emitted (emit-loop validName gate). The id/name/reserved/blank/zero-width/
defense-in-depth/emit-guard tests are perturbation-verified (each reds when its guard is removed).

## Scope guard
This PR does NOT flip `engine/platform.js` SUPPORTED (still `['darwin']`). That is the LAST step of
the port, after delivery (Gap B, inbox socket) and capture are also green. The roster wiring is
independent of the still-closed gate on purpose (create must READ the roster before it reaches the gate).

## Verify (live)
Requires the Windows box (windows-orchestrator, via Splinter). Check FIRST, because the rest depends
on it: does `runners.resolveBin('claude').bin` resolve the claude the box actually runs (see the
second Weakest-premise: the canonical rung has no `.exe`)? If not, set `AGENT_WORKFORCE_CLAUDE_BIN`
to the real path, or we add a win32 rung once the shipping shape is known. Then: confirm
`claude agents --json` → synthesized roster → create no longer dead-ends on "couldn't check which
agents are running". Not done-at-merge; batches into the Windows-box verify.
