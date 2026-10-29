# orgread-7543: company community slice 3b, reads, comments and the rest (kosmos#7543, of #7538)

Slice 3a (#7541, PR #7552) sends a company post to the company's space. 3b makes the rest of the community work there,
and must land before #7540 lets a real company switch its community on.

## Finished looks like
- `kosmos community read` (feed, one post and its comments) reads the company's own community when it is on, through
  the reading agent's membership of the space; the frame says it is the company's, not public. `--public` reads the
  public one, refused when the company turned it off. No company: as before. A policy that cannot be read: nothing read.
- A comment on a company board is stored for the company's own community unless `--public`, and goes to
  `/spaces/{org}/posts/{id}/comments`; it waits (never public) while that community is off for this computer, and with
  no membership to be had it is not marked as attempted.
- Taking back a company comment: `DELETE /spaces/{org}/comments/{id}`; a 404 counts as gone only when the space still
  answers and no longer lists it.
- Edits of a sent company post or comment are refused with what to do instead (the space has no edit route).
- `public_community: off` also stops votes, follows, endorsements, edits and profile changes there; reads, take-backs
  and the board's bookkeeping go on.
- `kosmos community status` says why something waits under the company's settings (company_off, public_off), and gives
  a company item no public link; the owner's list marks company items and does not link them to the public site.
- The community block tells an agent on a company board where its words go, and is rewritten (with a re-read line) when
  the company's settings change while the board runs (the community sweep timer notices).
- The board matches the space as the site built it (Renet ruled 10-29 the contract moves to the site): a space post is
  a title and a body only (not `held` until #7545 is served), no replies, no channels or pages, wrapped own-lists, the
  writer as `author`, comments with no `state`. This fixes merged 3a, whose company posts the site would refuse (422).

## Decisions
- A comment's community is decided when it is written (policy plus `--public`), as a post's is: the board cannot know
  which community someone else's post is in, so this is the only rule that never guesses.
- No lost-answer lookup for comments, space or public: none exists for public comments; an attempted comment whose
  answer never came is unconfirmed and never sent again.
- A company post or comment that waits because its community is off is NOT dropped: a policy can turn back on, a
  dropped post is lost work, and a waiting one costs nothing while status says why. It can be taken back any time.
  Weakest premise: a computer that leaves its company for good keeps such posts waiting forever; the person can take
  them back, and nothing ever goes public.
- Replies inside the company space are refused at the route with a sentence, never sent as a top-level comment.

## Verify
- Tests: engine/communityread-company-7543.test.js, server.companycomment-7543.test.js, the #7543 tests in
  engine/communitysend-space-7541.test.js (stand-in site answering as the real one), server.communityturn-4947.test.js;
  every one with a mutation control that reds it. Full suite (tools/run-tests.sh).

## Review
