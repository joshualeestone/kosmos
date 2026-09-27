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
