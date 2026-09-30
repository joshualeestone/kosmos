# #4800: a lost register answer never becomes a second public identity

Card: joshualeestone/kosmos#4800 (claimed:angel). Branch regtwin-4800, off main 47133e513.

## What finished looks like
An agent whose community registration answer was lost never ends up with two public identities: the board looks the
name up before registering again, reuses the same name when nothing live was made, and registers nothing while an
account under that name exists without a key here.

## The change (engine/communitysend.js ensureRegistered)
- Write-ahead: each register attempt first saves `{ registering: { name, at } }` as the agent's keys entry. A 201
  replaces it with the real keys; an answered failure (400, 409, 429, 5xx) removes it; only a lost answer (status 0)
  keeps it. Every other loop skips an entry with no apiKey, so the mark changes nothing else.
- Next attempt with a mark: GET /agents/by-name/{name} (public, case ignored, 404 for no ACTIVE agent):
  - 404: register the SAME name (also fixes the nameless case: registration() made a fresh random handle each call);
  - 200: register nothing, log once, ask again hourly (REGISTER_LOST_RECHECK_MS); registers once the name is free;
  - anything else: wait for the next sweep.

## Decisions
1. Look up and hold, rather than keep retrying the same name (the card's other option): a same-name retry would 409
   every sweep and never resolve; the lookup costs one public GET and self-heals when the name frees.
2. The mark lives in keys.json (the agent's own entry), not a new file: one file the layer already guards, and the
   entry is replaced whole on success.
3. Answered 5xx clears the mark like any answered failure. Rejected: keeping it for 5xx (a server that answered 500
   after committing is possible but rarer than a lost answer; the cost is a twin, the same as before this change).
WEAKEST PREMISE: a 200 on lookup is taken as "ours". Another agent could have registered that exact name after our
answer was lost and before our lookup; then our agent waits (hourly) instead of taking a suffixed name. Safe
direction (no twin, no wrong post), but it can leave an agent not posting. The person is not told on the page yet,
only in the log: a follow-up if it is seen in practice.

## Tests (engine/communitysend.test.js, 5 new; the fake service gains GET /agents/by-name)
- lost after the account was made: one identity, no post, no second lookup within the hour (with a control that the
  lost register did make the account);
- lost before: looked up, the same name registered, post sent;
- no display name: the same generated handle retried;
- an answered 409 leaves no mark; an answered 400 leaves no mark (next try does not look up).
- Mutants, each failing a test: no lookup, new name on 404, no write-ahead, no hourly wait, mark kept after an
  answer. Test files using communitysend: 105 pass, 2 skipped (the live contract tests need a service URL).
