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
- registration() / profileName(): these display names are sent as our own generated handle, because the service
  would swap each for a handle of its own and the lookup of the sent name would then miss the account: one holding
  '/' or '@'; one made only of dots (stripped from the ends, as the service does); one carrying an invisible
  character from the shared list (feedguard.stripFormatCharacters, the feedguard-cases.json contract the service
  copies: Cf, Default_Ignorable, U+2800; the JS set is the wider, safe direction). A trailing half character the
  80-unit cap leaves is dropped as the service drops it, and a mark already holding one is dropped, not looked up.
  (The service's other name rules are a port of the board's own scrub, which registration() already applies.)
- Next attempt with a mark: GET /agents/by-name/{name} (public, case ignored, 404 for no ACTIVE agent):
  - 404: register again, reusing a generated handle (registration() made a fresh random one each call, so the old
    retry was a twin under another name) or the display name as it is NOW (review 3: not an old one after a rename).
    A deactivated holder keeps its name, so that register 409s and the loop takes a suffix, as before;
  - 200 and made more than REGISTER_CLOCK_SKEW_MS (10 min) before or after our try (the profile's registered_at vs
    the mark's `at`): somebody else's (a name another install held, or took while ours sat unanswered; a lost POST
    commits within seconds of the try). Drop the mark and register as before, where the 409 takes a suffix
    (reviews 2 and 5);
  - 200 otherwise: register nothing, log once, ask again hourly (REGISTER_LOST_RECHECK_MS); registers once the name is free.
    The held post is recorded, its status carries agentNameUnclaimed (only when true), engine/communitymine.js passes
    it to the owner's row, and the page says an earlier try made an account under a name this agent used and Kosmos
    never received its key, so its posts wait (no "checks again" promise: only the service freeing the name ends it);
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
WEAKEST PREMISE: a 200 on a name made within 10 minutes either side of our try is taken as "ours". Another agent
could have registered that exact name inside that window; then our agent waits (hourly) instead of taking a
suffixed name. Safe direction (no twin, no wrong post), but it can leave an agent not posting. The page tells the
owner why the posts wait. There is no recovery path in the product: the only way out is the name freeing (which
the service never does on its own) or hand-editing keys.json. A follow-up card if it is seen in practice.

## Tests (engine/communitysend.test.js, 9 new; the fake service gains GET /agents/by-name)
- lost after the account was made: one identity, no post, no second lookup within the hour (with a control that the
  lost register did make the account);
- lost before: looked up, the same name registered, post sent;
- no display name: the same generated handle retried;
- an answered 409 leaves no mark; an answered 400 leaves no mark (next try does not look up);
- a gateway 504 after the commit, and a 201 whose body is cut, keep the mark (no twin); a 503 lookup waits;
- slash and dots-only names are sent as our handle (control: an ordinary name is not);
- review 6: a profile with no registered_at holds the name (control: the lookup ran);
- review 5: an account made an hour after our lost try takes a suffix; communitymine passes the flag as true (and
  false for a mark not yet found taken);
- review 4: braille-blank names use our handle; a name cut through an emoji drops the half; a mark holding a half
  character is dropped and the agent registers (control: another agent posts);
- review 3: '@scout', 'Bot @ Home' and a U+034F name use our handle; a rename after a lost try registers the new
  name; an account 5 minutes before our try (inside the margin) is still held;
- review 2: a name another install held a day before our lost try takes a suffix (control: the lookup ran); an owner
  delete of a held post is withheld, never sent; ". . ." is kept as the service keeps it;
- the held post's status carries agentNameUnclaimed. web.community-name-held-4800.test.js calls the page's
  communityMineWord for the new line (control: ordinary pending and refused agent unchanged; a held agent's withheld
  and sent posts keep their usual words; no retry promise).
- Mutants, each failing a test: no lookup, new name on 404, no write-ahead, no hourly wait, mark kept after an
  answer, clear on any answer, lookup 5xx registers, slash allowed, no status flag, no held row, no age check, age
  check inverted, every dot stripped, the page line without its pending guard, the margin in seconds, no '@' rule,
  no invisible-character rule, the old name after a 404, never reusing the handle, no shared invisible rule, the
  half character kept, no guard on the lookup URL. From the repo
  directory, every web.*.test.js plus the communitysend, communitymine, feedguard and communitysite files: 2427 pass, 1 skipped (the live contract
  test needs a service URL). Both browser-check gates pass (the coarse one by a copy-only trailer).

## Review
Round 1: 3 should-fix (only a 4xx clears the mark; names the service swaps; the owner cannot see the hold), all
taken; nits taken (the deactivated-holder comment, the rename note, tests for lookup 5xx).
Round 2: 1 blocker (a name another install held before our lost try was held forever), taken with the registered_at
age check; 3 should-fix (the page's hourly promise, the rename wording, tests for delete and page ordering), taken;
nit taken (dots stripped from the ends only).
Round 3: no blocker; 2 should-fix ('@' and invisible-character names the service swaps; the old name registered after
a rename and a 404), taken; nits taken (a stale test title, a test pinning the clock margin).
Round 6: no blocker; 2 should-fix (the mark's time was the sweep's start, so a slow sweep could read our own
account as somebody else's; no test for a missing registered_at), taken; nit taken (no recovery path, stated).
Round 5: no blocker; 2 should-fix (no upper bound on "ours": an account made well after our try was held forever;
the owner's row flag untested through communitymine), taken; nits taken (two garbled plan lines).
Round 4: no blocker; 2 should-fix (braille blank missed; a name cut through an emoji jammed the lookup), taken with
the shared invisible list and the half-character drop; nits taken (the invisible rule's stated reason; the 404 reuse
comment).
