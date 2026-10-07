# cardpost-5314: agent card shows time since last Kosmos+ community post

Splinter (PM) decision 2026-10-05: BUILD this. Original implementation 2026-10-05
(commit c24dc7038), rebased cleanly onto current main (0 conflicts, 395 commits
later) and carried forward by Kano 2026-10-06, with Sonya's pre-PR review applied.

## What to build (from the card)
On each agent's card, the time since its last community post: "Last community post:
3 days ago", or "No community posts yet". Read from the board's own record of posts
(community/posts.json). Show nothing when the community switch is off.

## Implementation
- `engine/communitystore.js`: new `publishedPostTimesAll()`, like `postTimesAll` but
  ONLY `status === 'published'` rows. A held or quarantined post is public on nobody's
  feed, so it must not read as a recent post (Sonya's pre-PR finding). `postTimesAll`
  is left byte-for-byte unchanged: the community nudge counts posts of any status and
  keeps that meaning. The two share the read/key/corrupt logic by copy; a note on each
  says to keep them in sync.
- `server.js` (`withAgentSortFields`): when `communitysend.switchOn()` is true, read
  `communitystore.publishedPostTimesAll()` and compute per agent `communityOn`,
  `lastCommunityPost` ("Last community post: today|yesterday|N days ago" by local
  midnight day diff, or "No community posts yet"), and `lastCommunityPostAt`. Switch
  off gives `communityOn` false and no line.
- `web/index.html`: `communityLine(a)` returns '' when the switch is off, else the
  server line (with a client-side relative-time fallback); rendered as an escaped
  `.acommunity` div on the running, offline, and needs-trust card branches, with CSS.
- `engine/communitystore.test.js`: held-only arm for `publishedPostTimesAll` (published
  counted, held and quarantined excluded, `postTimesAll` still counts all).
- `web.community-card-5314.test.js`: the card tests, plus an unsupplied-path test that
  exercises the real wiring (switch on + a held-only post in the store, no `supplied`
  argument) so a swap back to `postTimesAll` would be caught.
- `docs/browser-checks/mobile-shots.js`: a `community-card-5314` screen so design review
  can see the line at desktop and phone (the throwaway board has the switch off).

## Scope boundary (what "published" means here)
This counts posts PUBLISHED on this board (`community/posts.json`, the source the card
names). It does NOT distinguish the send-layer state that `kosmos community status`
reports (whether a published post was actually synced to community.kosmosplus.com:
`sent`, `not_sent`, `before_on`, `withheld`...). A post published on the board while the
send-switch was off would still count here. That finer notion lives in the send layer
(`engine/communitysend.js` / `communitystatus.js`), not in `posts.json`, and is out of
scope for this card line; flagged in the PR for the reviewer.

## Finished means
Post-today, old-post, no-post, and switch-off cases each show the right line, a test
covers all of them plus the held-only case, and the line renders in a real browser.

## Validation done
- `unset KOSMOS_AGENT_TOKEN && bash tools/run-tests.sh --only engine/communitystore.test.js web.community-card-5314.test.js`: 32/32 green.
- Browser-verify (both themes): today / 3 days ago / No community posts yet render; switch-off shows no line.

## Weakest point
A prior session's implementation carried forward over a 395-commit rebase, refined by
two Sonya reviews. Mitigated by: merge-tree showed 0 conflicts, both store deps still
exist on main, the full test set + browser-verify pass against current main, and the
published-vs-sent boundary above is documented rather than guessed.
