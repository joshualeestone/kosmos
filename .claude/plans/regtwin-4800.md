# #4800: a lost register answer never becomes a second public identity

Card: joshualeestone/kosmos#4800 (claimed:angel). Branch regtwin-4800, off main 47133e513.

## What finished looks like
An agent whose community registration answer was lost never ends up with two public identities: the board looks the
name up before registering again, reuses the same name when nothing live was made, and registers nothing while an
account under that name exists without a key here.

## The change (engine/communitysend.js ensureRegistered)
- Write-ahead: each register attempt first saves `{ registering: { name, at } }` as the agent's keys entry. A usable
  201 replaces it with the real keys; only a 4xx (which proves nothing was made) removes it. No answer, a 5xx (a
  gateway can answer 504 after the service committed) or a 2xx whose body could not be read keeps it. Every other
  loop skips an entry with no apiKey, so the mark changes nothing else.
- registration(): a display name holding '/' or only dots is sent as our own generated handle, because the service
  would swap it for a handle of its own and the lookup of the sent name would then miss the account. (The service's
  other name rules are a port of the board's own scrub, which registration() already applies.)
- Next attempt with a mark: GET /agents/by-name/{name} (public, case ignored, 404 for no ACTIVE agent):
  - 404: register the SAME name (also fixes the nameless case: registration() made a fresh random handle each call).
    A deactivated holder keeps its name, so that register 409s and the loop takes a suffix, as before;
  - 200: register nothing, log once, ask again hourly (REGISTER_LOST_RECHECK_MS); registers once the name is free.
    The held post is recorded, its status carries agentNameUnclaimed (only when true), engine/communitymine.js passes
    it to the owner's row, and the page says why the post waits and that Kosmos checks hourly;
  - anything else: wait for the next sweep.

## Decisions
1. Look up and hold, rather than keep retrying the same name (the card's other option): a same-name retry would 409
   every sweep and never resolve; the lookup costs one public GET and self-heals when the name frees.
2. The mark lives in keys.json (the agent's own entry), not a new file: one file the layer already guards, and the
   entry is replaced whole on success.
3. Only a 4xx clears the mark (review 1: a gateway 504 after the commit, or a 201 whose body never arrived, would
   otherwise make the twin). Rejected: clearing on any answer.
4. The owner is told on the page (review 1: otherwise the post just looks pending forever). A mark outlives a rename:
   the account may exist under the old name.
WEAKEST PREMISE: a 200 on lookup is taken as "ours". Another agent could have registered that exact name after our
answer was lost and before our lookup; then our agent waits (hourly) instead of taking a suffixed name. Safe
direction (no twin, no wrong post), but it can leave an agent not posting. The person is not told on the page yet,
on the page, and the only way out is the name freeing (or hand-editing keys.json).

## Tests (engine/communitysend.test.js, 9 new; the fake service gains GET /agents/by-name)
- lost after the account was made: one identity, no post, no second lookup within the hour (with a control that the
  lost register did make the account);
- lost before: looked up, the same name registered, post sent;
- no display name: the same generated handle retried;
- an answered 409 leaves no mark; an answered 400 leaves no mark (next try does not look up);
- a gateway 504 after the commit, and a 201 whose body is cut, keep the mark (no twin); a 503 lookup waits;
- slash and dots-only names are sent as our handle (control: an ordinary name is not);
- the held post's status carries agentNameUnclaimed. web.community-name-held-4800.test.js calls the page's
  communityMineWord for the new line (control: ordinary pending and refused agent unchanged).
- Mutants, each failing a test: no lookup, new name on 404, no write-ahead, no hourly wait, mark kept after an
  answer, clear on any answer, lookup 5xx registers, slash allowed, no status flag, no held row. From the repo
  directory, every web.*.test.js plus the communitysend/communitymine files: 2284 pass, 1 skipped (the live contract
  test needs a service URL). Both browser-check gates pass (the coarse one by a copy-only trailer).

## Review
Round 1: 3 should-fix (only a 4xx clears the mark; names the service swaps; the owner cannot see the hold), all
taken; nits taken (the deactivated-holder comment, the rename note, tests for lookup 5xx).
