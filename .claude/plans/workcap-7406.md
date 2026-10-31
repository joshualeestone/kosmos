# workcap-7406: a working-at-once cap per account, for every agent (kosmos#7406)

Card: kosmos#7406 (an outside user's report: ~35 agents woken by one event, ~1,000 failed turns in a morning on
the provider's rate limits). Branch workcap-7406. Supersedes stagger-7406 (a time spread; reviewed 3 rounds, not
merged: spreading turn STARTS by seconds leaves the turns running together, and it opened a window where a reply
could be logged before its question).

## What it does
- Settings > Automation, "Agents on one account at once": No limit (the default), 2, 4, 6, 8, 12, 16.
  engine/workcap-setting.js, made by the same function as the Gemini cap's setting (agycap-setting.make).
  /api/workcap-setting GET/PUT, writes from the screen only.
- An account is the runner plus the real path of the agent's account folder, from its launch job.
- OPT-IN: the gate (agyquota.heldForCap / noteCapStart, through chat.deliverAutomatic(Async)) holds a line only
  when its sender passes workCap: true. The senders that do are the burst sources:
  - other agents' room posts (messages.js typeInto; a person's post goes through deliverToPane, ungated);
  - telling a member the posts kept for it (roomhold.flushOnIdle: a turn end, a digest, the cap retry);
  - the Assigner handing out a part (server.js givePart);
  - an agent-only queue kept for a usage limit (limitqueue.js), never one holding a person's DM or task line.
- A capped post is noted on disk (roomhold.noteCap, a .cap file beside the held file) and roomhold.flushReleased
  tells it once the cap frees, for every runner (a Claude member waits for an empty box; others cannot be read),
  backing off ten minutes after a retry that reached nothing.
- The Gemini cap is unchanged everywhere.

## Decisions
- Opt-in, not opt-out (review 7). Rounds 1, 2, 3, 6 and 7 each found another automatic line that carries or chases
  the person's own ask, and each { cap: false } exemption also lifted the Gemini cap. Inverting it makes that class
  impossible to miss: a sender must ask to be held.
- Not deleted: extra servers or held posts are never dropped by the cap; everything held has a retry.
- Off by default, as the Gemini cap is.

## Weakest premise
That the outside user's failures were concurrency (many turns at once on one account). If they were a per-minute
request limit across busy agents, a working-at-once cap still helps (fewer turns at once means fewer requests per
minute), but the number to choose is theirs to find.

## Not covered
- A person's own room post to 35 members is still typed at once (a person's message is never held, by rule).
- Two account folders signed in to one provider login count as two accounts (errs toward holding too little).
