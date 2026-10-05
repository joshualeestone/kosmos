# rotationpin-5191: pin "every owner rotation is a revoke" (kosmos#5191 / #5197 follow-up, Renet's review)

Test only: engine/fedseats-rotation-5191.test.js (its own file, so it cannot conflict with #5329 in fedseats.test.js;
tools/run-tests.sh runs every engine/*.test.js).
- Exactly ONE epoch advance across fedseats/fedseal/federation/fedmembers, and it is inside revokeCheck (the step that
  rotates a room once a member's edge is found revoked; rotateForRevoked is its wrapper). Exactly one: zero means the
  pattern went blind, two means a second rotation path and graceAfter needs re-deciding.
- graceAfter does not branch on why a room rotated (case-insensitive), and still gives REVOKE_GRACE_MS.
Mutants (scratch copy): a second advance -> red; the advance rewritten past the pattern -> red; graceAfter branching on
a rotateReason -> red (after making the check case-insensitive: the first version missed it). Control green.

## Review 1 (0 blockers, 4 warnings): pin the WRITERS, not one spelling
The epoch-advance regex sees one spelling only. The guard now also pins who writes a room's key state: across every
engine file, fedseal.setRoomState is called only from revokeCheck (rotation, clock clamp), ownerHello (creation, epoch
0) and onKeyFrame (a member adopting the owner's verified rotation). A new writer fails the test and asks for the
graces to be re-decided. The function boundary now knows `async function` and ends at a top-level statement;
missing files fail rather than being skipped; a URL's "://" is not taken for a comment; the third test claims only
what it checks. Mutants: a new writer with a spelling the regex cannot see -> red; an async function after
revokeCheck advancing the epoch -> red; a reason branch in graceAfter -> red. Control green.

## Review 2 (0 blockers, 4 warnings)
- Any mention of setRoomState counts (an alias like `const set = fedseal.setRoomState` is a writer); in fedseal.js its
  definition and top-level export list are excluded, a use inside any function is not.
- Any other unindented code line ends a function, so a writer after an allowed function cannot borrow its name.
- Block comments are stripped before graceAfter's "why" check (the next function's doc comment is in the slice).
- Accepted residual (stated in the header): a new rotation inside one of the three allowed functions, spelled other
  than `epoch + 1` / `+= 1` / `++`.
- Mutants: an alias -> red; a writer in a top-level `if` after an allowed function -> red. Control green.
