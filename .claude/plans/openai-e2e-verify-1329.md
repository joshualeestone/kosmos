# #1329/#1903: verify the OpenAI create path end-to-end (route-level e2e matrix)

## Context (Josh directive via Splinter, 2026-09-03 night)
"Get OpenAI working RIGHT e2e in Kosmos" = PROVEN e2e, not "the code exists." Measured first (measure-whether-a-card-is-still-live): #1903's create-time credential live-check is ALREADY merged (PR #1906, on main) and covers both providers; #1465's "can't test e2e" premise is dead (a setRunner/setFetcher seam exists). So this is a VERIFICATION effort that fixes gaps where verification finds them, with #1329's 4-cell matrix (Claude/OpenAI × no-agents/pre-existing) as the deliverable.

## What I found (the coverage gap + the fail-open residual)
- The OpenAI create-gate (`accountConnectable`, create.js:2164-2184) had only UNIT coverage (`create.account-connectable-1903.test.js` calls it directly). `server.create-live-1903.test.js` drives the ROUTE but only the Claude arm. **No route-level OpenAI create test existed** — a genuine gap.
- Splinter's dangerous-answer arm, confirmed: `openai.checkLive` returns `NONE` only for an absent auth file or OpenAI's `invalid_api_key`; an **unreachable** check maps to `UNKNOWN` and the gate **fails open** (agent created). codex does **no turn-1 re-check** (mapped: `bin/agent-supervisor.sh` launches codex raw), so a dead-but-unreachable-at-create cred is created and 401s raw on turn 1 — the original symptom, for the case #1906 does not cover.

## What I built
`server.openai-create-e2e-1329.test.js` — drives the real `POST /api/agents` for the OpenAI arm, asserting via `createdLog()` (a refused create records no birth):
1. **OpenAI dead** (fetcher → 401 `invalid_api_key`) → 400 refused, "sign-in is not working", no birth.
2. **OpenAI live** (fetcher → 200) → passes gate, birth recorded.
3. **THE FAIL-OPEN ARM** (fetcher throws → unreachable) → NOT refused (fails open), agent created — pinned so a future change that starts refusing unreachable checks (blocking legit accounts) is caught, and the turn-1 residual is documented.
4. **#1329 pre-existing-agents cell** — dead still refused / live still creates with agents already born.

Faked boundary: `openaiaccounts.setFetcher` (the module's own /v1/models seam). Sandboxes every root + DRY_RUN + fake bins. No product code changed — new test file only.

## #1329 matrix coverage (for Josh's morning fixtures)
| | no-agents (first-ever) | pre-existing agents |
|---|---|---|
| **Claude** | covered: `server.create-live-1903.test.js` (dead refused, live created) | LEFT for Josh's fixtures / a follow-up test |
| **OpenAI** | covered: this file, cells 1-3 (dead/live/unreachable) | covered: this file, cell 5 |

The turn-1 SURVIVAL of a live agent and the turn-1 401 of a fail-open+dead agent need real accounts (the codex runtime) — that is Josh's morning pass with his fake-agent fixtures. Staged so those land on this work.

## The fail-open residual → follow-up, not create-time
The turn-1 surfacing (make a running agent's 401 read as `auth_failed`) is a running-agent liveness read, filed as **#2093** against the state layer (Renet's #2019 liveness module owns it). NOT create-time work; keeps me out of Renet's precedence/status layer (coordinated, zero file overlap).

## Weakest premise
That `createdLog()` birth-presence is a faithful proxy for "reached createAgent." It is the same assertion `server.create-live-1903.test.js` uses and the control cells (live → birth present) prove recordBirth fires for a passed gate, so a missing birth on a refused cell means the gate stopped it. The one thing this cannot prove is the actual codex turn-1 (that needs a real account) — explicitly left to Josh's fixtures.
