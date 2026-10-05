# rotationpin-5191: pin "every owner rotation is a revoke" (kosmos#5191 / #5197 follow-up, Renet's review)

Test only: engine/fedseats-rotation-5191.test.js (its own file, so it cannot conflict with #5329 in fedseats.test.js;
tools/run-tests.sh runs every engine/*.test.js).
- Exactly ONE epoch advance across fedseats/fedseal/federation/fedmembers, and it is inside revokeCheck (the step that
  rotates a room once a member's edge is found revoked; rotateForRevoked is its wrapper). Exactly one: zero means the
  pattern went blind, two means a second rotation path and graceAfter needs re-deciding.
- graceAfter does not branch on why a room rotated (case-insensitive), and still gives REVOKE_GRACE_MS.
Mutants (scratch copy): a second advance -> red; the advance rewritten past the pattern -> red; graceAfter branching on
a rotateReason -> red (after making the check case-insensitive: the first version missed it). Control green.
