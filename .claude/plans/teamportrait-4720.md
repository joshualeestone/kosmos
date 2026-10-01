# teamportrait-4720: the Team screen reads prebuilt portraits from /api/catalogue/portrait

Card: kosmos#4720. Mona Lisa's note (08:55): the catalogue repo now names portraits (kosmos-catalogue #10).
Measured 09:01: the published catalogue (installkosmos.com/catalogue/catalogue.json, serial 1790810974) sets
`avatar.image` on all 355 members of 77 teams. #4735 built the board route and said `tcPortrait` would move to it in a
follow-up; on main it still fetched `'/' + image` from the board, which 404s, so a member got NO picture and a
"portrait could not be set" row on every board that has downloaded the catalogue.

## Change (web/index.html)
- `tcPortrait(name, image, shown, team, slot)`: when the catalogue names a portrait, read
  `/api/catalogue/portrait?team=<key>&slot=<slot>` (the board fetched and checked the exact file the signed catalogue
  names; the page never builds an address from the catalogue's text). On any failure (404, a mismatch, an older board,
  a network error) fall back to the generated mark, so every member still gets a picture, as before portraits.
- The caller passes `TC.key` (the catalogue team key, the same key /api/teams/seeded/<key> loaded) and `m.slot`.
- web.api-routes-3957: UNREAD_CEILING 20 -> 19 (the variable-path fetch is gone).

## Decided
- Fallback to the mark rather than a "portrait could not be set" row: a member always got a picture before portraits
  existed (review 27 of #4557), and a missing portrait is not the person's to fix.
- Rejected: keeping the static path as a second try. It is the address #4735 retired on purpose.

## Weakest premise
That `TC.key` and `m.slot` are the catalogue's key and slot. Both come from /api/teams/seeded/<key> (teamseed.detail,
the catalogue's own key and member slot).

## Tests
render-teamcreate-4557 (chromium + webkit): the lead's portrait is read by team/slot and set as image/webp; the
writer's (404) and the third member (none) get the generated mark (png); the page never reads /avatars/...

## Review 1 (sonnet, blind): 0 blockers, 2 warnings, 2 nits
- Taken: a non-404 failure or a thrown read logs one console line (404 stays quiet: "no portrait yet").
- Taken: the writer's read aborts in webkit (the catch branch) and 404s in chromium; both must give the mark.
- Not changed (reasoned, not measured): the route's crossSiteRead through the relay. The same guard already fronts
  other GET routes a phone uses through Kosmos+ (the roles picker's catalogue read), so a relay host it refused would
  already break those.
- The ceiling claim was measured: web.api-routes-3957 29/29 with UNREAD_CEILING 19.

## Re-enabling portraits (April 08:55: kosmos-catalogue noportrait-4720, PUBLISH_PORTRAITS=false)
The catalogue side stops publishing portraits (avatar.image null) until this ships. Turn PUBLISH_PORTRAITS back on
only after a PRODUCTION build carrying this change is served (latest.json), not when staging has it: every install
still on an older build reads a named portrait as a static path and shows "could not be set". Even then, installs that
have not updated yet will do that until they do; that tail is the cost of re-enabling and is accepted then, not now.
