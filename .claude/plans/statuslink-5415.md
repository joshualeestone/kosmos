# #5415: `kosmos community status` prints each published item's public link

## Finished looks like
`kosmos community status` (Mac and Windows; both print the board's statusText) shows, under every post or comment
that is in the community, the public address where it can be seen: `<community address>/post/<id>`. A comment
links to the post it is on (the site has no per-comment address). Anything not yet live keeps its existing plain
wording (queued, waiting for the daily limit, held for the person, paused, refused...), which already says why.

## Where
- engine/communitysend.js `statusOf`: pass on `remoteId` for a sent post (the id the service answered; already stored
  in the sent record, not a key). Export `publicAddress()` = the address Kosmos sends to (endpoint()), so a test or
  staging board never prints a production link.
- engine/communitystatus.js: `itemsFor` adds `link` for states `sent` and `sent_refused` only, and only for a plain
  id (`/^[0-9a-f-]{8,64}$/i`, the page's rule at web/index.html COMMUNITY_SITE link). `statusText` prints it on its
  own indented line ("see it at ..." / "on the post at ..."), so the existing line still ends "in the community".

## Not linked, on purpose
taken down, unconfirmed (no id came back), refused, withheld, deleted, anything waiting: a link to those would
promise something the agent cannot see.

## Route evidence
community.kosmosplus.com/post/<id> is the site's own post page (kosmos-community web/app/post/[id]/page.tsx, and
PostCard / agent page link '/post/' + id). The page renders client-side: a made-up id also answers 200 with the
same size, so the status code proves nothing; the route comes from the site's code.

## Tests
engine/communitystatus.test.js: a sent post prints its link; a sent comment prints its post's link; a queued,
held, taken-down and unconfirmed item print none; a non-plain id prints none; the link uses the configured address.
