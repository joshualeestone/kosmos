# #2709 -- `kosmos report show`: a read-back so an agent can check its own board state

## Problem (measured, Mortals "Kosmos Inside Out" diagnostic)

`kosmos report` is WRITE-ONLY. An agent can SET its board state but has no CLI verb to READ its own current state back (`report show`/`report status` are rejected as unknown; `whoami` does not carry it). This bites a rule Kosmos itself sets: agents are told to CLEAR `needs_you` once answered, but an agent cannot check whether its `needs_you` is still set -- it can only remember, and memory does not survive a context compaction. So the board state most likely to go stale is the one the product most needs to be true. The data EXISTS (selfreport stores each agent's report; the board HTTP API is readable with the agent token); only the CLI read surface is missing.

## Design (all primitives exist -- confirmed in source)

### 1. server.js -- NEW `GET /api/report` (sibling to the existing `POST /api/report`)
- Identify the calling agent with the SAME auth POST /api/report uses: `resolveAgentSender(req, body, roster, opts)` (server.js:504) reads `x-kosmos-agent-token` and resolves it to the ONE calling agent (`{ok:true, card:{sessionName, isNamedOurs}}`), or `{ok:false, because}`. An agent reads only ITSELF -- never the roster; this is NOT the account-gated /api/agents. Use `safeRoster()` for the roster arg (same as POST /api/report); pass the same `opts` (denyPaneFallback on an enforcing board) the POST path computes, so the read honors the same board-token enforcement.
- On `!sender.ok`: return the sender's own error shape (do NOT invent one) -- `sendJson(res, 403, { ok:false, because: sender.because })` (match POST /api/report's unresolved-caller handling; confirm its exact status/shape and mirror it).
- On success: `selfreport.read(sender.card.sessionName)` (engine/selfreport.js:278) returns either `{found:false, because}` (NEVER_REPORTED / UNREADABLE) or `{found:true, state, on, owner, until, at, ...}`. `state==='needs_you'` (or `blocked`) is a `selfreport.WAITING_ON_A_PERSON` state -- the motivating "is my needs_you still set" field.
- Two arms, same as the room route:
  - JSON (default): `sendJson(res, 200, { ok:true, report })` where report is the selfreport.read result (found:true|false). A read miss is a 200 with `found:false` + because (a real state, NOT a 500).
  - `?as=text` (the CLI): the server shapes a human line (bash has no JSON parser), e.g. `You are currently: needs_you -- on <on>, owner <owner>, until <until> (set <at>). This is a WAITING-ON-A-PERSON state; clear it with `kosmos report working ...` once answered.` and for no report: `No report recorded yet.` Keep it one short block; surface `state` and, when WAITING_ON_A_PERSON, say so explicitly.
- HEAD: behaves like the room route (Node strips the body; no special-casing needed).

### 2. install/kosmos -- `report show` subcommand
- `report` currently dispatches to `cmd_report`. Add, at the TOP of cmd_report (or in the `report)` dispatch), a `show` subcommand (accept `status` as an alias): if `$1` is `show`/`status`, call a new `cmd_report_show` and return; otherwise fall through to the existing write path UNCHANGED.
- `cmd_report_show`: `healthy()` check (same message shape as cmd_report), then GET `$URL/api/report?as=text` forwarding the agent token EXACTLY as cmd_report does (reuse its KOSMOS_AGENT_TOKEN-forwarding block -- only a hex token is sent, malformed dropped) plus the board token (`board_token`), capture the HTTP status (curl `-w`, the #2702 pattern), print the body, exit 0 on 2xx / non-zero + clear message on 4xx (token unresolved) or transport failure. bash 3.2 under set -euo pipefail: `local`-then-substitute, `|| _rc=$?`, `printf '%s'` (no doubled newline), keep the unreachable arm distinct.

### 3. Regression test (match the server-route node test pattern)
- POST a report (e.g. `needs_you --on X --owner Y`) as an agent, then GET /api/report as that SAME agent (token/pane) and assert the read-back carries the SAME `state` (and on/owner). 
- Assert an agent with NO report gets `found:false` + a plain because at 200 (NOT a 500).
- Assert the JSON and `?as=text` arms agree on the state.
- Assert an UNRESOLVED caller (no/invalid token on an enforcing board) gets the sender error shape, not the report (an agent cannot read another's state).
- If a CLI harness exists for install/kosmos, add a `report show` exit-code assertion; else the server test covers the core (the CLI verb is a thin as=text GET).

## Checklist
- [ ] 1. server.js: GET /api/report -- resolveAgentSender -> selfreport.read -> JSON + ?as=text; read-miss is 200 found:false; unresolved caller = sender error shape.
- [ ] 2. install/kosmos: `report show`/`status` subcommand + cmd_report_show (token-forwarding reused, curl -w status, bash-3.2 discipline); write path unchanged.
- [ ] 3. Regression test: round-trip state, no-report 200, JSON==text, unresolved-caller rejected. CLI exit-code arm if a harness exists.
- [ ] 4. Full node suite green; `/challenge-loop` to convergence (model-alternated); PR (reviewer joshualeestone, squash, merge on green), body NON-closing `Addresses #2709`. No em dashes.

## Notes / weakest premise
- Weakest premise: that reusing POST /api/report's exact auth (resolveAgentSender + safeRoster + the enforcing-board opts) is the right gate for a READ. It is: the read returns only the caller's OWN report, keyed on the token-resolved sessionName, so the same auth that authorizes a write authorizes reading that same agent's state. If wrong, the fix is to tighten (never loosen) -- but there is no weaker read here (no roster, no other agent).
- No collision: CLI + server.js + a node test only. Does NOT touch web/index.html (Renet's found-panels-gate-2651, Mona's project-tab-2711) or engine/discover.js. Confirmed with Renet + Mona.
- #2704 (found-agents per-agent dismiss, also mine) is parked pending Renet's found-panels-gate-2651 landing (Renet confirmed our contracts are compatible; per Splinter, option b = build after it lands + rebase). This #2709 is the independent in-lane card taken meanwhile.
