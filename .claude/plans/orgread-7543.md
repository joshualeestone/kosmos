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
- Round 1 (opus, blind): 1 blocker, 2 warnings, 3 nits, all fixed. BLOCKER: a company comment's take-back never settled when the comment was already gone, and each try paused the agent's company sends (a space 404 was read by route, not by the site's detail). Fixed: a space 404 is the site's answer about an item only when it says "post not found" or "comment not found"; a bare "not found" (spaces off) is nothing done, and the caller waits. W: a company comment on a site with spaces off was refused for good (same fix). W: a lost board row could turn a company comment's take-back public; the sent record now carries space and org, read first. Nits: no "unsure" mark for a profile change never sent; an unreadable policy has its own status words; the CLIs say a comment went to the company's community; the block says --replies covers public posts only.
- Full suite on round 0 (9aab9e305e): two reds of mine (communityready had no place for the new waiting states; the #1720 browser-check gate, web/ changed with no assertion). Fixed: the states placed; render-community-delete-4313 asserts the company marks (58/58 through the driver, KOSMOS_BC_CI_ALLOWLIST, queued).
- Full suite on round 1 (4eaebcd28c): six supervisor launch tests timed out at 20 to 70 s, each file green alone; none touched by this branch. Contention.
- Round 2 (sonnet, blind): 0 blockers, 3 warnings, 1 nit, warnings fixed. W: a --public read and a company read shared one read job (the key left public out). W: an unreadable company policy read as "not sent, you can post it again" while the item waits (a second copy); now policy_waiting, "do not send it again". W: a company comment on a post outside the space settled as "post gone"; now not_in_company, telling the agent to use --public for a public post. Nit (a held company post answers 404 to others): the same reason is right for it.
- Full suite on round 2 (ddb488197f): green, RUN_TESTS_EXIT=0.
- Round 3 (opus, blind): 0 blockers, 3 warnings, 4 nits. W: --replies and the reply check asked the PUBLIC routes about company posts (an agent whose newest posts were company ones saw no replies); company posts are skipped there now. W: a company read with company:true and no org fell through to the public routes and was framed as private; refused now, and agentCallSteps refuses a space call with no company named. W: three guards had no test or a control that could not fail; tests added (a company comment edit sends no PATCH, a reply in the space is refused at the route and nothing stored, policy_waiting driven through itemsFor with a control). Nits taken: clearing a vote (PUT value 0) goes while the public community is off; the Mac comment usage names --public. Nits accepted: space calls carry no per-call deadline or cap of their own (spaceAs predates this branch; a card if it shows up); one refusal sentence for "community off" with no company cannot be reached (kept, harmless).
- Full suite on round 3 (73f6fd81b3): green, RUN_TESTS_EXIT=0.
- Round 4 (sonnet, blind): 0 blockers, 1 warning, 3 nits. W taken: with the public community off, --following and --replies still read the public site while --public was refused; one rule now (communityread.publicReadRefusal, shared by both), and the block says so. Nits accepted: a space thread too long for THREAD_READ_CAP reads as "comments could not be read" (the site's list has no paging; rare); the board accepts org ids wider than the site's 32 hex (real orgs are hex; a 422 would read as invalid text); space calls have no per-call deadline (round 3).
