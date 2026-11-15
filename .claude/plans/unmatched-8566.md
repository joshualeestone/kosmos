# Plan: kosmos#8566, a header name that names no member is told

Card: a post addressed "Me -> Them:" where Them is no member's name wakes nobody, and nothing tells the poster.

## Measured on main first
- Given-name addressing already works for AGENTS: nameResolves maps a one-word name to the one member whose display
  name has that word ("Renet" is Renet Tilley). So the gap is a name that is no member's (the person, a nickname, a typo).
- Such a name is dropped silently. The CLI says "It woke no one" only when nobody at all was woken, and never which
  name failed. kosmos#8270's outsidersNote covers an agent of this computer who is off the project, and by design says
  nothing about a name it cannot identify ("a false 'did not reach them' is worse than none", review 1).

## Call (as narrowed by review rounds 1 to 5)
- A third sentence in the note slot (ambiguousNote), unmatchedNote, only for a post that WOKE NO MEMBER (no header
  name, @-name or @all reached anyone), which is the card's case: the CLI already says "It woke no one", and this says
  which name and the handles to use: "<name> is not the name of any member of this project, so this post woke no one
  by it (the person still sees every post here). Members you can address: <name (@handle)>...". Every clause is true
  whoever the name meant, keeping #8270's rule: it never says "did not reach them".
- Only the poster's own ARROW header (-> or the arrow character). The word form ("Leo for the record:") is mostly
  sentences, which is where the noise came from in rounds 3 to 5.
- A part speaks only when name-shaped (one to three words of letters, . ' and -) and not one that may mean a member:
  a name or word a member or the poster answers to, its possessive, or a run of three or more letters inside one
  ("Kitty" in icecreamkitty, "Mona" in MonaLisa, "Renet" in renet-tilley). Nor a name outsidersNote names.
- Not for a person's post or a room shared with another computer (federated: this board cannot see every member).
- No double quote in it: kosmos post reads the note with sed up to the first one (name-shaped parts cannot hold one).
- Both CLIs and the page already print ambiguousNote, so no reader changes.

## Decided trade
- A non-member name BESIDE a member who was woken ("Leo -> Kano, Josh:") is not reported. Rounds 2 to 5 showed every
  rule that tried to report it also reported topics ("Kano, heads up:", "Kano, Blocked:"); a deny list of topic words
  has no end. The CLI already says such a post reached only the members it addresses.

## Rejected
- Resolving a nickname or the person's name to a handle: a guess, and the person is not woken by posts at all.
- Warning on any header word: "Before -> After:" is a sentence, which the poster-own-header rule keeps out.

## Changed test
- #8270's "nothing is said" test: the cases whose name is no member's (the team, Josh, Dana, Everyone on the project,
  Cream, Homer on m702) now carry the new sentence and are asserted never to carry the outsider one. The rest still
  assert no note at all.

## Weakest premise
That a header name nobody has is worth a sentence even when the poster meant the person on purpose. The sentence says
the person still sees the post, so it costs a line, not a wrong belief.
