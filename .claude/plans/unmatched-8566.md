# Plan: kosmos#8566, a header name that names no member is told

Card: a post addressed "Me -> Them:" where Them is no member's name wakes nobody, and nothing tells the poster.

## Measured on main first
- Given-name addressing already works for AGENTS: nameResolves maps a one-word name to the one member whose display
  name has that word ("Renet" is Renet Tilley). So the gap is a name that is no member's (the person, a nickname, a typo).
- Such a name is dropped silently. The CLI says "It woke no one" only when nobody at all was woken, and never which
  name failed. kosmos#8270's outsidersNote covers an agent of this computer who is off the project, and by design says
  nothing about a name it cannot identify ("a false 'did not reach them' is worse than none", review 1).

## Call
- A third sentence in the note slot (ambiguousNote), unmatchedNote: a name in the poster's OWN header (the same
  header rule outsidersNote uses) that is no member's says "<name> is not the name of any member of this project, so
  this post woke no one by it (the person still sees every post here). Members you can address: <name (@handle)>...".
  Every clause is true whoever the name meant, which keeps #8270's rule: it never says "did not reach them".
- Silent for: a name any member or the poster answers to, even ambiguously (a word of a display name included); @all
  and everyone; a name outsidersNote already names; a person's post; a room shared with another computer (federated:
  this board cannot see every member there).
- Only a part written like a person's name speaks: one to three words, each title case ("Josh", "O'Brien"). The fleet's
  header carries topics after a comma ("Kitty, heads up:", "FYI", "re the cut") and the word form reads sentences that
  start with the poster's name ("Leo for the record:"); none of those is a name. A possessive or a hyphen-part of a member
  name ("Kano's team", "Renet" for renet-tilley) may mean the member, so it says nothing.
- Known gap, the safe direction: a header word that is part of a member's name but woke no one ("Kano, cc Mara" where
  "cc Mara" is one part; "Renet" for a member stored only as renet-tilley) says nothing.
- Silent when @all woke every member the names did not; a typo beside a full list of names is still said.
- No double quote in it: kosmos post reads the note with sed up to the first one (name-shaped parts cannot hold one).
- Both CLIs and the page already print ambiguousNote, so no reader changes.

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
