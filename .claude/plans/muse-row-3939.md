# #3939 slice 3c-1: a turn that says "not signed in" clears Kosmos's signed-in mark

## What finished looks like
When a Muse Code turn ends with "missing meta credential", GET /api/muse answers
signedIn: false from then on, until a new sign-in (through Kosmos, or Muse's own
file store written after it). Engine only; no screen changes. This is the
precondition musestatus.js names before any screen may read signedIn (the AI
Models account row is the next slice).

## Decisions
- A "signed out" note (muse-signin/signed-out.json), not only deleting the
  signed-in mark: on the file backend Muse's own auth.json can still list meta
  after Muse has refused the credential, and deleting Kosmos's mark would leave
  that file answering yes. The note wins over anything OLDER than it; a sign-in
  after it (Kosmos's mark, or auth.json written later) wins over the note.
- Kosmos's own sign-in removes the note when it records "Logged in."
- runTurn clears on the exact stderr it already classifies ("missing meta
  credential", singular or plural), nothing broader: a crash or timeout says
  nothing about the sign-in.
- Clearing never throws into the turn: a failed write is logged and the turn's
  answer is unchanged.

## Not in this slice
The AI Models account row, the first-run row, the create-agent option, running an
agent on Muse.

## Weakest premise
That "missing meta credential" is the only way Muse reports a lost sign-in. It is
the one seen in the captures; the real Mortals Mac run will show whether there are
others.
