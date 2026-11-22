# kosmos#8877: a usage-limit stop is recorded as one, and the mover rescues it

## Finished looks like
1. A real Claude Code usage-limit stop is recorded as `provider api (rate_limit)` by both report hooks (node and shell, with and without jq), not "an api error".
2. A card blocked by that report carries `limitReported: true`.
3. The usage mover's at-limit rescue (autobalance.stoppedAtLimit) counts such a card as stopped at its limit, and decide() still moves it only off an account at risk (overall, or for its model).
4. Measured on a real board after release: a Fable agent stopped on a full Fable limit is moved off.

## Evidence (measured 11-21)
- Claude Code 2.1.330 program: `hook_event_name:"StopFailure",error:g,error_details:e.errorDetails,last_assistant_message:r`.
- The stopped agent's transcript row: `"error": "rate_limit"`, `"apiError": "usage_limit_reached"`.
- Agent1s' board: 36 of 36 stored stops read `provider api (an api error)`; the real card read `blocked`, "waiting on provider api (an api error)", no limitUntil.

## Calls
- Read `error` first; matcher and error_type stay as fallbacks (older builds, the existing test shape). jq takes `error` only as a string; without jq each key is tried in turn.
- A structured flag (limitReported) rather than matching the card's sentence.
- No reset time on a reported limit: the decision's own risk rules (a reset more than 6 h away, overall or for the agent's model) are what keep a five-hour limit from moving anyone.

## Consequence to say in the PR
- #5805's usage-limit handling (held messages, the limit hold) keys on `provider api (rate_limit)`; with the hook fixed it starts working on real stops. It was built and tested but inert.

## Weakest premise
- The `error` field is measured on one Claude Code build. Fallbacks keep older shapes as before.

## Review round 1 (blind): 1 BLOCKER, 2 WARNINGs, 2 NITs
- BLOCKER: nothing clears a rate_limit report within a run, so `limitReported` stayed true for hours after the reset; the mover would restart a recovered agent holding open work. Fixed: a reported limit counts only with `limitFull` (decide(): the account's weekly, or the agent's own model's limit, is FULL now; an agent cannot have recovered while it is). Passed through movableFor (ctx), modelOf.atLimit, and automove's three uses (two sightings, the re-check, the move message) via the move's own `limitFull`. Pinned: a recovered agent with open work at 85% weekly is not moved; the same agent on a full week is.
- WARNING: a five-hour stop could move an agent. Fixed by the same gate (a five-hour stop does not make the week or the model full).
- WARNING: the no-jq sed took the LAST "error" (a nested error_details). Fixed: the first `"error":"<kind>"` on the line; pinned with an object error_details decoy (the old decoy could not fail).
- NIT: a kind must look like one (^[a-z_]{1,40}$) in both hooks; a number, a message or an object falls through.
- NIT (accepted, for the PR text): real server_error stops now clear on an automatic idle (#6209 starts working); kinds like max_output_tokens now read as themselves.
