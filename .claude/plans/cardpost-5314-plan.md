# cardpost-5314 — agent card shows time since last Kosmos+ community post

Splinter (PM) decision 2026-10-05: BUILD this. Implementation originally written
2026-10-05 (commit c24dc7038), rebased cleanly onto current main (0 conflicts,
395 commits later) and carried forward by Kano 2026-10-06.

## What to build (from the card)
On each agent's card, the time since its last community post: "Last community post:
3 days ago", or "No community posts yet". Read from the board's own record of posts
it sent (the same source `kosmos community status` uses). Show nothing when the
community switch is off.

## Implementation
- **server.js** (`withAgentSortFields`): when `communitysend.switchOn()` is true, read
  `communitystore.postTimesAll()` (the posts record) and compute each agent's latest
  post time by sessionName/name (case-insensitive, Map- or object-shaped). Expose
  `communityOn`, `lastCommunityPost` ("Last community post: today|yesterday|N days ago"
  by local-midnight day diff, or "No community posts yet"), and `lastCommunityPostAt`.
  Switch off ⇒ `communityOn` false and no line.
- **web/index.html**: `communityLine(a)` returns '' when the switch is off, else the
  server-computed line (with a client-side relative-time fallback); rendered as a
  `.acommunity` div on the agent card (running, offline, and needs-trust branches),
  escaped. CSS for `.acommunity`.

## Finished means
Post-today, old-post, no-post, and switch-off cases each show the right line, a test
covers all three plus switch-off, and the card line renders in a real browser.

## Validation done
- `unset KOSMOS_AGENT_TOKEN && bash tools/run-tests.sh --only web.community-card-5314.test.js`:
  7/7 green (stylesheet, switch-off omission, today/yesterday/days-ago, case-insensitive
  + Map handling, communityLine, running + offline/needs-trust card rendering).
- Browser-verify (both themes): today / 3 days ago / No community posts yet render on
  the card; switch-off shows no `.acommunity`. 8/8.

## Weakest point
The implementation is a prior session's; carried forward after a 395-commit rebase.
Mitigated by: merge-tree showed 0 conflicts, both deps (`communitystore.postTimesAll`,
`communitysend.switchOn`) still exist on main, and the full test + browser-verify pass
against current main. The challenge-loop re-reviews it fresh.
