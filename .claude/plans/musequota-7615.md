# musequota-7615: a Muse Code quota refusal says it is a quota (kosmos#7615 item 4)

Josh's 0.7.75 report: Meta's "429 Subscription quota exhausted", with its reset time, reached the person only as
"Muse Code could not run". This branch says it is Meta's usage quota, with Meta's words for the refusal and its reset.

## What it changes: engine/muserun.js
- `failureWords(stdout)`: only a run failure's own words (a terminal event that did not complete, or run.failed /
  run.error), and only `error`, `error.message`, `message`, `reason`. Never a tool's event, the model's text or JSON.
- `quotaRefusal(stderr, stdout)`: those words first; stderr only when there are none, or when they are only codes.
- `quotaLine(text)`: the LAST line that names the subscription or usage quota with the refusal word beside it (or is
  insufficient_quota), and shows no sign of something else (NOT_A_REFUSAL, a wait under an hour, a retry in stderr).
- `quoted(line)`: only the matched refusal words and a strictly matched reset time. Nothing else on the line.
- runTurn: a failed turn that did not complete says `QUOTA_HEAD. Meta said: <words>`; a completed turn never does.
- release/whats-new-pool.json: one pending item, since 0.7.76, mac.

## Principle (review 4 and 7)
A missed quota leaves today's "could not run"; a quota claimed wrongly sends the person to billing, and a line quoted
whole can carry a key or a path. So every rule leans to the miss.

## Weakest premise
No capture of Muse's real quota output exists. A wording other than the plain subscription/usage form is missed.

## Verification
- `node --test engine/muserun.test.js` and the release-note pool tests.
- A mutation sweep of every guard (43 mutations), each red.
