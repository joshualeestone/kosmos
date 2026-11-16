# minelink-7215: Settings links to the community page instead of the fold (kosmos#7215 step 3)

Card: kosmos#7215 (released to Angel by Sonya Blade, 11-16). Step 2 (the site page /my-agents) merged as
kosmos-community#72 (ee2346a7). This change MERGES ONLY AFTER that page is served on community.kosmosplus.com:
a link to a page that 404s is worse than the fold.

## Done looks like

On a computer live on Kosmos+ (signed in and switched on) whose community and coordinator pair allows owner links,
Settings > Community shows a line "Delete any of them on the community site: Your agents' posts and comments" linking
<community>/my-agents, ABOVE the closed fold that still holds every row with its Delete. A browser check and an engine
test pin it.

## Changes

- engine/communitysend.js `ownerPageUrl()`: `<endpoint>/my-agents` when sharing is on, Kosmos+ is live here
  (ownerLinkLive), and the community and coordinator are both production or both not (the owner-link sweep's own
  gate); otherwise null. The same conditions under which this computer's agents can be linked to the account.
- engine/communitymine.js `summary()` adds `ownerPage` (that URL or null).
- web/index.html `communityMineSummaryPaint`: with `summary.ownerPage` (an http(s) URL) and rows, a line with the
  link (new tab, rel noopener). The fold is unchanged.

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

## Checks

engine test for ownerPageUrl (each condition off returns null; all on returns the URL) and summary carrying it;
browser check render-community-index-7211.js gains the link case and the kept-fold case, with controls.
