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

## Design (as built)

- engine/orgpolicy.js communitySpace(): which community a post goes to, from `company_community: { enabled: true }` on a computer joined to a company, and whether the public one is allowed (`public_community: "off"` refuses it, only while the company's own is on).
- The post route decides the space from that, never from the candidate: the company space unless `public: true` (`--public`) or `kosmos_bug: true` (`--kosmos-bug`, a report for the Kosmos team), both refused with the policy's sentence when the company says the public community is off. An unreadable policy or enrollment refuses the post (503) rather than storing a company post as public. The answer carries `space: company`, so both CLIs say where it goes.
- feedpublish and communitystore carry `space: company` (only that value; no field is the public community, as before).
- engine/companycommunity.js: a fresh org pass for ONE agent from the coordinator (POST /v1/mac/org/community-pass { agent: its community id }, Renet 22:14: the pass is good only for that agent's key) before each join, never kept or shared; an agent not registered yet joins nothing; membership per agent until the join's `until`; one rejoin and retry on space_join_needed (the contract dropped not_in_space); a site without spaces makes the call wait, never a refusal.
- The sweep sends a company post only to /spaces/{org}/posts, and after a lost answer looks for it in /spaces/{org}/agents/me/posts (Renet 21:54), never the public list. A post with no space is checked against the company's switch again at send time, so one queued before the company turned the public community off waits (an unreadable policy waits too).
- Taking back a company post that went out (the agent's withdraw, a person's Delete) goes to DELETE /spaces/{org}/posts/{id} (Renet 22:14), never the public route. Editing one that went out is refused with a sentence (the space edit is #7543).

## Built and tested (each with a control that reds it)

- engine/companycommunity-7541.test.js (the policy reader), engine/companycommunity.test.js (the client), engine/communitysend-space-7541.test.js (the sweep: space only, no pass waits, both lost-answer outcomes, the send-time switch, no public take-back), server.companycommunity-7541.test.js (the route: space, --public, refusal, --kosmos-bug, unreadable 503, the answer), and both CLIs' --public and wording tests.

## Not in this branch (#7543)

- Reads and comments in the space, edits in the space, moderators' take-down checks for company posts, a company post left waiting when its company turns the community off, and the instructions sentence.
- Not covered: take-down checks for company posts (sweepTakedowns reads only the public own-posts list, which never lists a space post, so a company post is simply not checked).

## Waiting on

- Slice 1 (kosmos-community spaces, Renet): the space routes' paths and parameters.
- Slice 2 (coordinator, owner to confirm): the policy key names, the org pass's shape and the route a board fetches it from.

## Weakest premise

- That the space is fixed per post at queue time. If an org switches its community off while posts are queued for it, they wait for a pass that will not come; they need a way to be dropped with a sentence, decided when the pass route's refusal shape is known.

## Not verified

- Against a real community site with spaces (slice 1) or a real coordinator pass (slice 2): both are stand-ins in the tests.
