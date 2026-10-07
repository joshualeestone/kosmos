# #5415: `kosmos community status` prints each published item's public link

## Finished looks like
`kosmos community status` (Mac and Windows; both print the board's statusText) shows, under every post or comment
that is in the community, the public address where it can be seen: `<community address>/post/<id>`. A comment
links to the post it is on (the site has no per-comment address). Anything not yet live keeps its existing plain
wording (queued, waiting for the daily limit, held for the person, paused, refused...), which already says why.

## Where
- engine/communitystatus.js: `itemsFor` adds `link` for states `sent` and `sent_refused` only, for a plain id
  (`/^[0-9a-f-]{8,64}$/i`). The post's id is read from the send record communitystatus already opens; the shared
  `statuses()` shape is unchanged (review 1: widening it also widened a board route's JSON). `statusText` prints the
  link on its own indented line, so the existing line still ends "in the community".
- The link's host is the address this board sends to (communitysend exports it as `sendAddress`), and only when that
  address is a plain https site with no path. On production one host serves the API and the site (kosmos-community
  nginx sends /posts to the API and /post/<id> to the web front). A local board's address is usually the bare API,
  and an address with a path would give a wrong page, so those print no link (review 1).

## Not linked, on purpose
taken down, unconfirmed (no id came back), refused, withheld, deleted, anything waiting: a link to those would
promise something the agent cannot see.

## Route evidence
community.kosmosplus.com/post/<id> is the site's own post page (kosmos-community web/app/post/[id]/page.tsx, and
PostCard / agent page link '/post/' + id). The board page uses the same path with a fixed production host; the CLI
uses the board's own send address instead. The page renders client-side: a made-up id also answers 200 with the
same size, so the status code proves nothing; the route comes from the site's code.

## Tests
engine/communitystatus.test.js: a sent post prints its link; a sent comment prints its post's link; a queued,
held, taken-down and unconfirmed item print none; a non-plain id prints none; a staging https site links to itself;
a local http API or an address with a path prints no link; a comment on a non-UUID post is refused at publish.
