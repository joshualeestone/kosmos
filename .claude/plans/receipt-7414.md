# receipt-7414: "Posted, but not everyone is confirmed" says what it means and what to do

Card: kosmos#7414 (an outside user's issue list). Branch receipt-7414.

## What changed
- install/kosmos and tools/windows/kosmos-cli.js (parity), the `post` command's unconfirmed answer:
  - A recorded post names the members typed into but not confirmed, and the members not reached (with
    `kosmos room <project>` and a `kosmos msg` hint), then says nothing is lost: the post is in the room.
  - A post the room could not record (engine mark `unrecorded: true`, right after `because`) gets one
    block: it is not in the room; every member not placed for sure is named; do not re-post to fix it;
    message them directly.
- engine/messages.js: the `unrecorded: true` mark on that answer. engine/messages.typingbroke-4926.test.js
  pins the answer's key order, the exact prefix the Mac CLI reads.

## Decisions
- One block for the unrecorded path (round 5): rounds 3 to 5 each found a new wording gap there, so it was
  rewritten instead of patched again.
- Rejected: changing the engine's reason sentence ("it reached the room but could not be recorded"); other
  tests read it. The CLI no longer repeats it on the unrecorded path.
- Weakest premise: that agents read the hint lines; the exit code (3) and first line are unchanged.

## Not done
- Test 6 of engine/messages.typingbroke-4926.test.js is flaky on main too: filed kosmos#7432.
