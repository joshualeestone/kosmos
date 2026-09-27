# #3939 slice 3c-1: a turn that says "not signed in" clears Kosmos's signed-in mark

## What finished looks like
When a Muse Code turn ends with "missing meta credential", GET /api/muse answers
signedIn: false from then on, until a new sign-in (through Kosmos, a new credential
in Muse's own file store) or a completed turn. Engine only; no screen changes. This is the
precondition musestatus.js names before any screen may read signedIn (the AI
Models account row is the next slice).

## Decisions (revised in review round 1)
- Nothing is deleted to say "signed out". A note (muse-signin/signed-out.json) is
  written, and Kosmos's mark counts only when it is NEWER than the note (a tie is
  signed out, the safe direction).
- A refusal from a turn that BEGAN before a sign-in writes nothing: the mark is newer
  than the turn's start, so the new sign-in stands (the race round 1 demonstrated).
- A completed turn writes the mark and ends the note: it is the strongest proof of a
  sign-in, and the only way a terminal `muse login` on the Keychain is ever seen.
- Muse's own auth.json counts after a refusal only for a DIFFERENT meta entry: the
  note keeps a sha256 of the refused entry (never the entry), so a rewrite for any
  other reason does not revive it.
- A note that exists but cannot be read is a refusal (fail closed).
- Kosmos's own sign-in removes the note when it records "Logged in."
- runTurn clears on the exact stderr it already classifies ("missing meta
  credential", singular or plural), nothing broader: a crash or timeout says
  nothing about the sign-in.
- Recording never throws into the turn: a failed write returns false and the
  turn's answer is unchanged.

## Not in this slice
The AI Models account row, the first-run row, the create-agent option, running an
agent on Muse.

## Weakest premise
That "missing meta credential" is the only way Muse reports a lost sign-in. It is
the one seen in the captures; the real Mortals Mac run will show whether there are
others.

## Review round 1 (opus): 0 blockers, 3 warnings, 4 nits
- W1 FIXED: a refused turn finishing after a mid-turn sign-in undid it (demonstrated).
  markSignedOut(startedAt) writes nothing when the mark is newer than the turn's start.
- W2 FIXED: a completed turn never cleared the note. markTurnSignedIn on completion.
- W3 FIXED: any rewrite of auth.json revived a refused meta entry. Digest comparison.
- N1: the tie rule is now stated and tested (signed out). N2: the unused `at` param is
  gone; the argument is the turn's start. N3: nothing is deleted any more, so a failed
  rm cannot fail open; an unreadable note fails closed. N4: every 3c-1 test sandboxes
  XDG_CONFIG_HOME.

## Review round 2 (sonnet): 2 blockers, 0 warnings, 3 nits, all fixed
- B1: a slow completed turn that began before another agent's refusal undid it
  (several agents share one Mac-wide credential). markTurnSignedIn(startedAt) now
  mirrors markSignedOut's guard: it writes nothing when a note is newer than its start.
  Tested in the unit and through a real slow turn.
- B2: the digest hashed JSON.stringify, so the same credential in another key order
  read as new. It now hashes a canonical form (keys sorted at every depth).
- Nits: the note's field is metaDigest; the stat-then-read window is documented as
  deliberately failing closed; both mark writers write the same shape.

## Review round 3 (opus): 2 blockers, 2 warnings, 2 nits -- redesign
- B1: file mtimes keep sub-millisecond precision that Date.now() drops, so an mtime read
  as later than a clock taken after it; a committed test failed 3 runs in 4 and the
  refusal guard sat on the unsafe side. Mtimes are no longer compared: each record
  carries its own integer `at` written inside the file.
- B2: a slow success stamped its FINISH, hiding a refusal from a turn that began
  after it. Both records now carry the turn's START (a completed turn proves the
  credential it began with); Kosmos's own sign-in carries its finish. Later wins; a tie
  is signed out. Neither record ever moves back.
- W1: an auth.json that could not be read at the refusal revived the refused entry
  later. The note records fileUnread, and the file is ignored until a later completed
  turn or sign-in.
- W2: an unreadable note blocked every later turn for ever. A completed turn removes it.
- N1/N2: comments now describe the start-time rule. N3 (canonical form lossy only
  toward signed out) needs nothing.
- A mark from before this slice (ISO `at`, or none) is still read (none: its mtime,
  floored to the millisecond).
- The integration test that wrote a note and started a turn in the same millisecond now
  backdates the note; 5 of 5 and 10 of 10 repeat runs clean.

## Review round 4 (sonnet): 1 blocker, 0 warnings, 2 nits
- BLOCKER FIXED: a late refusal from an older turn kept the newer `at` but rewrote the
  note's digest from the file as it is NOW, which could mark a never-refused credential
  refused, or revive a still-refused one (both reproduced). A late refusal now writes
  nothing when a newer note exists. Both scenarios are tests.
- NIT FIXED: Kosmos's own sign-in writes an integer `at` like the other writer.
- NIT FIXED: an unreadable mark is no mark (never a yes); commented as deliberate.

## Review round 5 (opus): 0 blockers, 2 warnings, 3 nits
- W1 FIXED: the refused credential's digest was taken when the refusal REPORTED, so a
  `muse login` or `logout` during the turn recorded the wrong one (both reproduced).
  runTurn takes musestatus.fileAtStart() beside startedAt and passes it on.
- W2 FIXED: several boards on one Mac share the sign-in folder, and a success's
  check-then-delete could remove another board's newer refusal. Successes (a completed
  turn and Kosmos's own sign-in) no longer delete the note: the later mark already
  wins. Records are written to a temp file and renamed, so "unreadable" means real
  damage, never a write in progress (only then is a note removed).
- N1: the wall-clock limit is stated in signedIn's comment (a clock stepped back can
  misorder records made within the step). N2: docstring lists a new credential in
  Muse's file as a restore. N3: the sign-in tests remove the note in setup.

## Review round 6 (sonnet): 1 blocker, 1 warning, 2 nits -- redesign to append-only events
- BLOCKER FIXED: every earlier round tested ordering inside ONE process; two board
  processes (they share this folder) could interleave a read-decide-write, leaving an
  older note on disk or deleting a newer one (both reproduced). Records are now
  append-only EVENTS: each observation is its own file, created once by rename, with
  its kind and integer time in the NAME. The answer is a pure read (latest mark vs
  latest note, tie signed out), so a late or out-of-order write is simply not the
  latest. Nothing is rewritten; the only deletes are pruning events older than the
  newest of their own kind, which can never change the answer, and slice 3a's single
  mark file when a save fails (nothing writes it any more). Tested by placing events
  straight into the folder in both arrival orders.
- WARNING (decided, recorded as a premise): the digest hashes the whole meta entry. If
  Muse keeps a self-updating field there (lastUsed, a refreshed expiry), the file backend
  would read a still-refused credential as new. The entry's shape has never been
  captured, and on a Mac the sign-in lives in the Keychain (the #3939 Mortals run), so
  the file branch is not reached while Muse is Mac only. Revisit with a real capture.
- NITs: crypto required once at the top; the atomic-write comment no longer implies it
  solves ordering (ordering is the events' job).
- Kosmos's own sign-in and a failed save now go through musestatus (markKosmosSignedIn,
  markSaveFailed), so there is one writer for the folder.

## Weakest premise (updated)
Two: that "missing meta credential" is the only way Muse reports a lost sign-in, and
that Muse's meta entry in auth.json has no self-updating field (file backend only).
- Mutation gap closed: "last listed wins" survived because APFS lists names sorted; a test now reverses the listing so only a real time comparison passes.

## Review round 7 (opus): 0 blockers, 2 warnings, 7 nits
Cross-process stress by the reviewer (15 trials, 6 real node processes, random writes,
checked against an oracle): no failures.
- W1 FIXED: when a turn reads the credential inside [start, finish] is unknown, so
  overlapping success and refusal were ambiguous and settled toward yes. Three event
  kinds now: TURN (a completed turn, by its start), SIGN (Kosmos's own sign-in, by its
  finish), NOTE (a refusal, named by its FINISH with its start inside). A turn beats a
  note only if it started after the note finished; a sign-in beats a note if it finished
  after the refused turn started (round 1's case). Every ambiguity is signed out.
- W2 FIXED: notes at the same moment are combined, failing closed (all digests refused;
  unread if any is).
- N1: a time that is not a whole number of ms below 1e15 is refused, never written unseen.
- N2: a future-dated slice 3a mark is ignored; Kosmos's own sign-in removes that file.
- N3: a failed save's note names no credential in Muse's file (it blocks older sign-ins
  only).
- N4: a note pruned between listing and reading makes latest() read once more.
- N5: every muserun test sandboxes XDG_CONFIG_HOME.
- N6: leftover .tmp files older than a minute are pruned.
- N7: noted (the garbled case's early return); the answer is still asserted there.
