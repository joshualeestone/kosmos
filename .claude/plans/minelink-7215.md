# minelink-7215: Settings links the community page beside the fold (kosmos#7215 step 3)

Card: kosmos#7215 (released to Angel by Sonya Blade, 11-16). Step 2 (the site page /my-agents) merged as
kosmos-community#72 (ee2346a7). This change MERGES ONLY AFTER that page is served on community.kosmosplus.com:
a link to a page that 404s is worse than the fold.

## Done looks like

On a computer live on Kosmos+ (signed in and switched on) whose community and coordinator pair allows owner links,
Settings > Community shows a line linking <community>/my-agents (its words are in web/index.html,
communityMineSummaryPaint, and pinned by the SITE arm of render-community-index-7211.js), ABOVE the closed fold that
still holds every row with its Delete, and only when some are in the public community (summary.onSite > 0): the site page lists public posts and comments
only, not a company's space (separate SpacePost tables) and not held rows. A browser check and an engine
test pin it.

## Changes

- engine/communitysend.js `ownerPageUrl()`: `<endpoint>/my-agents` when sharing is on, Kosmos+ is live here
  (ownerLinkLive) with a computer id, and the community and coordinator are both production or both not (one helper,
  ownerLinkPairOk, shared with the owner-link sweep); otherwise null. These are the conditions under which linking
  can START; whether a given agent is linked yet is per agent and per pass, so the fold stays.
- engine/communitymine.js `summary()` adds `ownerPage` (that URL or null) and `onSite` (live, not company).
- web/index.html `communityMineSummaryPaint`: with `summary.ownerPage` (an http(s) URL), rows, and onSite > 0, a line
  with the link (new tab, rel noopener). The fold is unchanged.
- Noted, not changed: the link needs sharing switched on, though posts already out stay deletable on the site after
  it is switched off; the fold covers them then. A record whose board copy is gone counts as public in onSite.

## Decided (reversible)

- Keep the fold, closed, beside the link. Rejected (the card's first idea, and this branch's first version, which
  review round 1 found a BLOCKER in): hiding the fold when the link shows. The link's condition says agents CAN be
  linked, not that they ARE (a coordinator 403, a site that is not set up, a refused agent, 5 links a pass), and a
  held or unsent post has no site row, so hiding it would take away the only Delete for public content.
  Hiding the fold only once every live agent carries the current owner-link marker would be the next step; it is not
  built here.
- The link names the page, not a count: the count line above already says how many.
- Weakest premise: that a computer live on Kosmos+ has its agents linked by the time the person opens the page. The
  owner-link sweep links up to 5 agents a pass, so a big board may show the link before every agent is listed there;
  the site page says how an agent becomes linked.

- Not changed: the agent links beside it use the board's COMMUNITY_SITE constant, the page link the configured
  endpoint. In production they are the same host; under a test override they can differ. Left as is.

## Checks

engine test for ownerPageUrl (each condition off returns null; all on returns the URL) and summary carrying it;
browser check render-community-index-7211.js gains the link case and the kept-fold case, with controls.
