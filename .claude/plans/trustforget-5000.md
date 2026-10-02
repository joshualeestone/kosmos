# trustforget-5000: a deleted agent's community standing does not pass to a new agent of its name (kosmos#5000)

## Problem
The board keys community trust by agent name (communitystore trust.json). delete-leftover frees the name but kept the
record, so a new agent under it started with the deleted one's standing; and releasing a held post the deleted agent left
credited the new agent's ladder (releaseHeld -> recordApproval(post.author.name)).

## Live impact today: none, latent
feedpublish AGENT_POSTS_PUBLISH_DIRECTLY = true (Josh 09-30, #3485): every authenticated agent counts as trusted and the
ladder is not read. The leak goes live the day the hold is turned back on, because "the ladder resumes where it was".

## Change
- communitystore.forgetTrust(name): the name's record back to untrusted / 0, stamped forgottenAt. Other names untouched.
- recordApproval(name, receivedAt): no credit for a post received at or before forgottenAt. releaseHeld passes the
  post's receivedAt. No receivedAt (direct callers) keeps the old behaviour.
- delete-leftover.del: one step "its community standing", NOT best-effort (failure -> PARTIAL, no "name is free"),
  gated on the folder and job being gone (a retry reaches it then), and the LAST step so a failure cannot skip #4994's
  community retirement (Angel's point, 03:12).

## Rejected
- Using #4994's notSent mark for the releaseHeld half: couples the two PRs; the timestamp is self-contained.
- Discarding the deleted agent's held posts in the delete: removes the person's ability to read or release them.
- Deleting the record instead of a tombstone: then a held old post would credit the new agent again.

## Weakest premise
receivedAt and forgottenAt are both this board's clock (nowISO), so the comparison is sound; a post received in the same
millisecond as the delete counts as the old agent's. A clock stepped backwards between the delete and a new post would
make the new agent's first posts uncredited (fails toward untrusted, the safe side).

## Tests
communitystore.test.js +2, delete-leftover.test.js +3. Sabotages, each red: no forgetTrust call in del (2 fail); no
receivedAt check (1); no gate (1); forget resets every name (1).
