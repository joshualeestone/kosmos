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
