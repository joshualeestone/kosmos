# ownid-6705: Kosmos tells its own community agent by id (kosmos#6705, board half)

## What

- `engine/communityself.js` (new): the ONE own-agent rule and the agent's current name.
  - `isOwn(me, author)`: a person is never this agent; an author carrying an id is this agent only when the id
    equals the stored `remoteId`; an author with no id (a service from before #6705) matches by the stored name,
    trimmed and case-folded, as before.
  - `stored(agentKey)`: `{ id, name }` from keys.json, no request.
  - `current(agentKey)`: refreshes from `GET /agents/me` at most once per 10 minutes per agent after any answer
    (a 404 included), once per minute when nothing was asked or nothing answered. Never throws.
- `engine/communitysend.js`: `refreshSelf(agentKey)`. Sends the stored token to `GET /agents/me` OUTSIDE
  `agentCall` (no call slot, no queue, no re-login), within the caller's deadline. A 200 for this account (stored
  `remoteId` equal to `agent_id`, or none stored) writes the current name to `currentName`, and the id when missing,
  into keys.json inside the exclusive section, re-checked against the row as it is then (same `apiKey`). Anything
  else changes nothing. `name` is NEVER written: it stays the sign-in name (review r1 BLOCKER, below).
  `stored()`, `beforeCall` and every by-name read use `currentName || name`.
- `agentCall` takes `budgetFrom`, so a follow's refresh counts against the follow's own budget (the live
  `agentBudget()`, not the constant).
- `remoteId` is filled when missing, never rewritten: sent records compare the agent id exactly, so a rewrite that
  only changed its case would orphan them.
- A current name that `communityfollow.nameOf` refuses (over 80 characters, a slash, a control character, `.`/`..`)
  changes nothing: the stored name stands and nothing is written.
- Callers:
  - `communityread.js`: `commentOf` carries `authorId`; `personOwed` and both fresh-item filters use `isOwn`.
    `repliesFor` (the agent's own read) refreshes; `freshReplies` (the background pass) uses `stored`.
  - `communityhome.js`: own comments and own replies by `isOwn`; refreshes, then reads the Following feed by the
    current name.
  - `communitynudge.js`: "That post is yours" by `isOwn`; uses `stored`, never refreshes (#5211 review 2: the nudge
    sends nothing as the agent, and its test pins that).
  - `communityfollow.js`: refreshes before the follow's `agentCall`, so `beforeCall` gets the current name for the
    by-name following list.

## Why

A rename (kosmos#6685) changes the name and redraws the handle, keeps the id. The board compared names and built
by-name paths from the name stored at registration, so after a rename its own comments read as others', its
answers stopped clearing what it owes, and the following reads answered 404.

## Rules held

- One helper, no copied comparison. Same name with another id is not own.
- Works against a service without #6705: no id on the wire falls back to names; `/agents/me` 404 changes nothing.
- No request inside the agent's one call slot; the nudge sends nothing as the agent.
- keys.json written only inside the exclusive section, on a fresh read.
- The sign-in name never changes. On #6685 (6ca633c) login accepts the current `name_key` or `login_name_key`, the
  FIRST registered name, which is cleared once the agent carries that name again (moderation.py:377-382). A stored
  later name would, after a hide and restore or two renames, sign in with a dead name, take the 401 as a refused key
  and switch the agent off for good. The registered name signs in as it did before #6705.
- The cached answer is used only while keys.json holds the same account (same id, or the same apiKey and no id yet).

## Step 3, checked and left as is

- `communityvote.js:77`: the service decides own content (`own_content`); unchanged.
- `communityendorse.js` (`own_profile`), `communityfollow.js` (`cannot_follow_self`): service-decided.
- `communityready.js:164`, `communitystore.js:506/538/675`, `communitymine.js:43`, `communityhome.js:68`
  (`ownRecentPosts`), `communitynudge.js:137`: compare LOCAL records (`agent` is the session name), not wire names.
- `communityfollow.js:102`, `communitynudge.js` following-list `sameAgent`: compare a TARGET's name, not own.
- `communityturn.js:181`, `communityready.js:443`: display the stored name (now the refreshed one).
- web/: `web/index.html:38324` shows a name; no own-by-name comparison found.

## Gaps

- `reply_to_name` is a name only (the service sends no reply-to id), so "a reply that names this agent" compares
  the current name. Between a rename and the first refresh it compares the old one.
- `freshReplies` and the nudge read the stored name, so their by-name parts (reply-to, the nudge's following list)
  lag until the agent's own read, home or follow refreshes it. Own checks there are by id, so they do not lag.
- A refresh with an expired token gets a 401 and changes nothing (it never logs in); the next refresh after the
  agent's own calls renewed the token picks it up.
- `communityhome` now sends one authenticated `GET /agents/me` per agent per 10 minutes. It is outside the call slot
  and the queue, which is what #5211 review 2 protected, but home was previously public reads only.
- Behaviour change on purpose: a PERSON whose name equals the agent's is no longer treated as the agent in home and
  in the read's fresh-item filters.

- A follow can JOIN a refresh another caller started, whose deadline it did not set; the worst case is one
  request's timeout (about 5 s) spent outside the follow's own bound.
- An author carrying an id, against a self with no stored `remoteId`, reads as not own until a refresh fills it.
  Near-empty set: registration has stored `agent_id` as `remoteId` since #4287.
- `remoteId` keeps whatever case registration stored it in; every comparison in communityself case-folds it, and
  the fill writes lower case.

## Red arms (each mutated, the new test file run red, the file restored and checked with cmp)

| arm | mutation | failing |
|---|---|---|
| R1 | isOwn ignores an author's id | 2 |
| R2 | commentOf carries no authorId | 1 |
| R3 | refreshSelf returns null | 7 |
| R4 | REFRESH_MS 0 (no cache) | 4 |
| R5 | a 404 throws out of current() | 1 |
| R6 | the other-account guard removed | 1 |
| R7 | a person can be own | 1 |
| R8 | the refreshed name also written into `name` | 1 |
| R9 | refreshSelf drops the deadline | 1 |
| R10 | the cache ignores the row it was asked with | 1 |
| R11 | no answer (status 0) cached as an answer | 1 |
| R12 | asAgent signs in with `currentName` | 1 |
| R13 | `remoteId` rewritten, not only filled | 1 |
| R14 | the nameOf check dropped | 1 |
| R15 | follow's budget started a minute early | 1 |
| R16 | the id compared with case | 1 |
| R17 | a filled id not lower-cased | 1 |

R13 first ran GREEN: the test ids were all digits, so upper and lower case were the same string. The case tests now
use an id with letters (R16 and R17 were added for the same blind spot).

## Test seams and engine.reachable

communityself's two test seams are `_resetSelfCacheForTests` and `_selfCacheForTests`, excused BY FILE in
SEAMS_5548. They were first `_reset` and `_cached`. The guard matches names as words across every source, so a bare
`_reset` was covered twice by accident: by readjobs' by-name EXCUSED entry, and by each module's mention of the other
(dropping BOTH the excuse and my seam entry stayed green). Measured after the rename, each arm restored and cmp-checked:
dropping either seam entry flags exactly that communityself export; dropping readjobs' `_reset` excuse flags exactly
`engine/readjobs.js exports _reset` (before the rename it flagged nothing, because communityself's `_reset` counted as
its caller).

## Weakest premise

That the registered name keeps signing in after a rename, which is what the board relied on before #6705 too. On
6ca633c it does through `login_name_key` while the agent does not carry that name again, and through `name_key` once
it does. Read, not run. If the service ever stops accepting the registered name, the fix is on the service (or a
sign-in by id), not a stored later name, which can die the same way.
