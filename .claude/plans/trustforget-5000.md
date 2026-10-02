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
- delete-leftover.del: the reset is the FIRST step (after review 1). A failure refuses the whole delete with nothing
  touched, so a retry works; once the folder and job are gone plan() refuses, so this is the only order a retry can
  reach. Resetting a leftover early costs nothing (it is not running; a standing only drops). Being first, it cannot
  skip #4994's community retirement either (Angel's ordering point, 03:12). The folder's real-case name
  (realpathSync.native) is reset too.
- grantTrust / revokeTrust keep forgottenAt.

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

## Review 1 (blind, general-purpose): 0 blockers, 3 warnings, 1 convention, 2 nits; all taken or answered
- W1 a failed reset at the end could never be retried (plan() refuses once files are gone) -> reset moved FIRST, failure refuses whole.
- W2 grant/revoke erased forgottenAt (revoke then release re-opened the leak) -> keepForgotten; test.
- W3 comment cited #4994's step that is not on main -> gone with the move.
- C "could not move its community standing" wording -> gone (own refusal sentence).
- N case: p.name vs the folder's real case -> realpathSync.native basename also reset; test (my first try used
  basename(p.folder.path), which is built from the asked name and did nothing; caught before commit).
- N clock stepped back: already the plan's weakest premise; fails toward untrusted.
Sabotages after the fixes, each red: no realpath name (1), failed reset does not refuse (1), keepForgotten no-op (1),
no reset in del (4).

## Review 2 (blind): 0 blockers, 2 warnings, 1 convention, 1 nit
- W a later refusal said "Nothing was changed." after the standing was reset -> the sentence now says only the standing was reset.
- W (on main, worse here) plan()'s running check is exact-case (`sessionName === clean`) on a case-blind Mac disk:
  del('miles') with Miles running moves the running agent's folder (main), and now also resets Miles's standing.
  NOT fixed in this branch: filed as its own card (the folder move is the real harm and belongs in plan()).
- C the case test passed vacuously on a case-sensitive disk -> skips with a reason there.
- N grant then release of an old post was untested -> added; keepForgotten sabotage still red.

## Review 3 (blind, whole diff): 0 blockers, 1 warning, 2 nits; all taken
- W the late-refusal sentence said "only its standing was reset" (tokens, removed-record and restart record also clear
  by then) and showed "(#5000 ...)" to the person -> "Nothing was moved/deleted. Its standing in the community was
  reset, so a new agent with this name starts at the beginning." The halfgone test now asserts it and that no card
  number reaches the person (sabotage red).
- N "Try again" on a failed reset promised a retry that may fail the same way -> dropped.
- N inverted assertion message in communitystore.test.js -> fixed.
