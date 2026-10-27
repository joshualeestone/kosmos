# #7361: a new Windows agent's card stays "working" after its first reply

**Posture:** production

## Evidence (the 0.7.71 V2 failure, read from the box)
`%APPDATA%\Kosmos\selfreports\v2check0771.jsonl`: the first turn's hook wrote `working` (17:14:19.202, instance
55f68e32f7c3, by auto, "answering a prompt") and NO `idle` for that instance; every later turn of that agent, and every
turn of v2check0771b (which passed), has a working/idle pair. The agent did answer ("OSPREY" on the board), so the turn
ended; only the Stop hook's idle report is missing. Why it went missing is not knowable from what is kept (no hook log).

## Why the card then stays "working"
The card reconciles the self-report with the scrape (status.reconcileReport). On Windows the scrape for a Claude agent is
the token win32capture returns: the supervisor's stream-state file (every agent Kosmos starts is a streaming session) or,
for an interactive session, `claude agents --json`'s status. An automatic `working` report outranks a scraped idle
unless that idle carries `liveToken` (proof no turn is running), and classify sets liveToken only for per-turn runners
(win32codexlive PER_TURN: codex, gemini, grok, antigravity), deliberately not for Windows Claude (#5949: an
`agents --json` idle also reads idle while the session waits). So the stale `working` stands until
REPORT_WORKING_DECAY_MS (5 minutes): a new user's first agent reads "working" for up to five minutes after it answered.

## Change
A Windows Claude idle that comes from the STREAM is proof the turn ended (win32streamstate sets IDLE on the turn's
`result` event), unlike an `agents --json` idle. Carry that distinction through capture to classify:
- win32capture knows which source each token came from (`listed` vs readStreamState). Return a distinct token for an
  idle read from the stream file (a new constant owned by win32streamstate, e.g. STREAM_IDLE), accepted by isGood/GOOD.
- classify's win32 arm reads it as IDLE with `liveToken: true` (as the per-turn arm does). `agents --json` idle stays
  without liveToken.
- The existing held-reading guard (a carried/held reading never keeps liveToken, status.js ~9093) must still apply.
- Every other consumer of the token vocabulary (win32capture memory/carry, failed() read-back, win32codexsup, tests that
  compare tokens) keeps working.

## Not in this card
The Stop hook's missing idle (cause unknown; this change makes the card correct itself whatever the cause). The #7368
queue logic is unchanged.

## Tests
- A Windows Claude pane with an automatic `working` report and a stream-file idle reads IDLE (control: the same with an
  `agents --json` idle stays WORKING until the decay; control: a stream BUSY stays WORKING).
- A held/carried stream idle does not end the report.
- e2e: kosmos-scripts e2e-zip.js Z3 run 5 times in a row on the Windows box after the build (the card's done-when).
