# trust-record: #169, removal takes back exactly the trust line we wrote

## The gap, which was a documented decision until its condition was met

#164 answers Claude Code's trust question for the folder a creation makes;
on removal the line stayed, because an ordinary removal could not tell our
line from one the person wrote by answering the prompt themselves, and
deleting a person's own answer in another tool's config is the worse
failure direction. The card recorded the change-condition in its own
words: if Kosmos recorded WHICH trust lines it wrote, removal could
delete only its own. #157's birth record has since shipped the exact
shape (a record of what we did, kept beside the artifact that goes
missing), and Splinter re-ranked the card as buildable tonight for the
reused-name reason: a stale line is how a reused agent name silently
inherits or loses trust.

## The build

- engine/trust.js grows the side record (trust-writes.json under
  store.ROOT, beside profiles and the birth record): recordWrite,
  recordedWrite, dropRecord. An unreadable record answers null, the
  leave-the-line signal; a WRITE over a corrupt record heals it, the
  bytes set aside as evidence (a refusal would silently disable
  recording forever after one torn write; reads still answer null);
  cross-process races resolve toward losing an entry, a line never
  taken back, never toward acting on a wrong one; displaced-absent is kept
  distinct from displaced-false, because forgetFolder reads the first as
  "delete the key" and the second as "put false back".
- create.js persists, on the SUCCESS path only, exactly what the
  failed-start rollback already knows in memory: key, displaced,
  madeEntry, and only when the write was ours (already false).
  Best-effort and non-gating: a creation whose record write failed leaves
  a line removal will not touch, which was every agent's behavior before
  the record existed.
- remove.js consumes it before the board-record step: a record means the
  same forgetFolder call the rollback uses, with its own guards carrying
  the removal distance (only-if-it-still-says-yes leaves a value the
  person changed in the gap; already-gone answers ok). The record drops
  only on success at REMOVAL, so a failed take-back retries at the next
  removal. A fresh CREATION of the same name that did not itself record
  drops whatever record the name held, because a stale record acting on
  a new incarnation could delete the person's own answer; a kept-for-
  retry record can therefore be lost to a re-creation, and that trade,
  failing toward the inert stale line, is deliberate and recorded here.
  The step appears only when a record exists: the common no-record
  removal stays exactly as quiet as before.

## Tests

trust.test.js: the record round-trip, displaced-absent kept distinct,
unreadable answering null on read and refusing on write. remove.test.js,
through the real createAgent and remove(): the line restored and the
record dropped; the no-record control leaving the line (the person-owned
direction); the person-changed-in-the-gap case leaving their answer and
retiring the record. The fixtures seed the minimal real config shape,
because trustFolder refuses on absent by design.

## Review bound

Two rounds maximum, declared before starting. Stopping rule: findings
only in a round's own fixes mean ship.
