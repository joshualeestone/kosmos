# ranout-6386: the ran-out pairing sentence promises nothing that does not exist (#6386)

#6386: a computer that is allowed, but whose code ran out before "The codes match" was pressed, says "it does not trust
<name> yet". "yet" promises a step, and none exists: a new code starts only while held (pairing.rs), Try again needs
held too, and nothing on either screen can finish the match. Today nothing reads the match either (peers.json has no
reader outside pairing.rs), so the computer works.

## The change (web/index.html, both places the sentence is drawn)
"This computer is connected. The code ran out before it was matched with <name>, and nothing more is needed for it to
work." A comment beside it says the slice that first reads peers must change this sentence or give this state a way to
pair again.

## Decided
- **Copy now, mechanism later.** The card offers either. Rejected for now: a held-independent retry. It is a tunnel and
  page change, and its value appears only when something reads peers. Making the screen true now is reversible and
  needs nothing else.
- Left as is: `.claude/plans/joincode-4794.md` quotes the old sentence. It is the record of that change.

## Weakest premise
That "nothing more is needed" stays true until a slice reads peers. If one lands without seeing the comment, the
sentence becomes false; the comment and the card are the guard.

## Tests
`docs/browser-checks/render-connect-sheet-4637.js`: its four #4794 assertions pin the new sentence (run on this branch).
