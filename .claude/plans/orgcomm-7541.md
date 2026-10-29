# orgcomm-7541: kosmos board and CLI for a company's own community, part 3a: POSTS (#7541, slice 3 of #7538)

## Decided: this branch is 3a (posts); 3b follows

- This PR carries the post half: which community a post is stored for, --public, the sweep sending company posts only to their space, and the lost-answer recovery in the space. Reads, comments and the instructions sentence are 3b (a follow-up card).
- Why split: everything here is inert until a company has `company_community: { enabled: true }`, which only April's slice 2 (#7540) can set, so it can merge safely now and slice 2 can test against a real board. The instructions sentence changes what every agent's instruction file says under a policy, which the instruction-reread machinery guards closely; it deserves its own review.
- Weakest premise of the split: an org that turns its community on after 3a and before 3b gets company posts with reads and comments still public. That needs slice 2 deployed with an admin switching it on, so 3b must land before slice 2's switch reaches a real company.

## Finished looks like (the whole of #7541; 3a covers the first and third bullets for posts)

- On a board enrolled in an org whose policy turns its company community on, `kosmos community post` and `kosmos community read` go to that company's space; `--public` posts to (and reads) the public Kosmos+ community, and is refused with the org's own sentence when the org's policy says the public one is off.
- On every other board (no org, a family, an org with it off) nothing changes: posts and reads go to the public community exactly as today, and `--public` is accepted and means what it already means.
- The board fetches the short-lived org-community pass from the coordinator (slice 2) and sends it with every space request; a post never goes to the space without one, and nothing is ever mirrored between the two.
- Each agent's instructions carry one sentence saying which community a post goes to.

## Design (from the code, 10-28 21:5x)

- The policy arrives through the existing push (engine/orgpolicy.js); communityAllows() already decides whether an agent may take part at all. New reader beside it: which community a post goes to (`company` or `public`) and whether the public one is allowed. Key names to be fixed with slice 2's owner (asked Renet 21:4x); until then the reader returns "public" for every board, so nothing changes.
- A post is queued and signed by engine/communitysend.js and sent by its sweep. The space becomes a field of the queued post (recorded at queue time, so a policy change while it waits cannot move it to the other community), and the sweep sends a space post to slice 1's space route with the org pass. A post queued for a space whose pass cannot be had waits, as any post does when the site is down; it is never sent to the public community instead.
- Reads (engine/communityread.js) take the same choice.
- The CLI (install/kosmos, and tools/windows/kosmos.ps1 and kosmos.sh for parity) gains `--public` on post and read.

## Built so far

- orgpolicy.communitySpace: which community, from company_community and public_community (engine/companycommunity-7541.test.js).
- engine/companycommunity.js: a fresh org pass from the coordinator before each join (never kept), membership per agent until the join's until, one rejoin and retry on space_join_needed, not_in_space forgets the membership, a site without spaces or no pass sends nothing (engine/companycommunity.test.js, a mutation control reds it).
- The post route decides the space (--public as `public: true`, refused when the org says off; an unreadable policy refuses the post rather than storing a company post as public); feedpublish and communitystore carry `space: company`; the sweep sends such a post only to its space, and after a lost answer looks for it in the space's own-posts list (GET /spaces/{org}/agents/me/posts, Renet 21:54), never the public one (engine/communitysend-space-7541.test.js, two mutation controls red it).
- Not covered yet: take-downs of company posts (sweepTakedowns reads only the public own-posts list, which never lists a space post, so a company post is simply not checked; the company admins' moderation is slice 4).

## Still to build

- `--public` on `kosmos community post` and `read` (install/kosmos, and the Windows kosmos.ps1 / kosmos.sh for parity).
- Reads (communityread) and comments (sendComment, and GET /spaces/{org}/agents/me/comments) to the space.
- The agent-instructions sentence.

## Waiting on

- Slice 1 (kosmos-community spaces, Renet): the space routes' paths and parameters.
- Slice 2 (coordinator, owner to confirm): the policy key names, the org pass's shape and the route a board fetches it from.

## Weakest premise

- That the space is fixed per post at queue time. If an org switches its community off while posts are queued for it, they wait for a pass that will not come; they need a way to be dropped with a sentence, decided when the pass route's refusal shape is known.

## Not verified

- Nothing built yet.
