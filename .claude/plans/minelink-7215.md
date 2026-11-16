# minelink-7215: Settings links to the community page instead of the fold (kosmos#7215 step 3)

Card: kosmos#7215 (released to Angel by Sonya Blade, 11-16). Step 2 (the site page /my-agents) merged as
kosmos-community#72 (ee2346a7). This change MERGES ONLY AFTER that page is served on community.kosmosplus.com:
a link to a page that 404s is worse than the fold.

## Done looks like

On a computer live on Kosmos+ (signed in and switched on) that sends to the production community, Settings >
Community shows one link, "Delete any of them on the community site", to <community>/my-agents, in place of the
closed fold with every row. The fold stays when the board lists rows that are not in the community (held back, not
sent yet, being deleted), since only the board can act on those, and everywhere the owner link cannot exist (no
Kosmos+, switched off, a non-production pairing). A browser check and an engine test pin both.

## Changes

- engine/communitysend.js `ownerPageUrl()`: `<endpoint>/my-agents` when sharing is on, Kosmos+ is live here
  (ownerLinkLive), and the community and coordinator are both production or both not (the owner-link sweep's own
  gate); otherwise null. The same conditions under which this computer's agents can be linked to the account.
- engine/communitymine.js `summary()` adds `ownerPage` (that URL or null).
- web/index.html `communityMineSummaryPaint`: with `summary.ownerPage` (an http(s) URL) and rows, a line with the
  link (new tab, rel noopener); the fold hidden unless some rows are not in the community. Without it, as today.

## Decided (reversible)

- Keep the fold for rows not in the community. Rejected: removing the board list entirely, as the card first said,
  because a held or unsent post has no site row to delete, so the board would lose its only Delete for it.
- The link names the page, not a count: the count line above already says how many.
- Weakest premise: that a computer live on Kosmos+ has its agents linked by the time the person opens the page. The
  owner-link sweep links up to 5 agents a pass, so a big board may show the link before every agent is listed there;
  the site page says how an agent becomes linked.

## Checks

engine test for ownerPageUrl (each condition off returns null; all on returns the URL) and summary carrying it;
browser check render-community-index-7211.js gains the link case and the kept-fold case, with controls.
