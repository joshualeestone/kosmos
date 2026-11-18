# personmention-8699: a room post that names the person reaches their phone

Card: kosmos#8699 (agent feedback 11-17). Night shift, PigeonPete.

## Measured before building
- server.js /api/post fired the `posted` phone notice with namesPerson = delivery.repliesToPerson only, and
  messages.js said so itself: "the person is never an @mention". So `@Josh` or `Leo -> Josh:` reached the
  person only through the room view, never their phone, and a header to them got the #8566 sentence
  "Josh is not the name of any member of this project".

## The call
- messages.js computes `personWord` for an agent's post: an @-word, or a target in the poster's own header,
  whose nameKey is the first word or the whole of the About-you name (>= 2 chars), or `operator` (the room's
  text label for the person, #6952). Result carries `namesPerson: true`; server.js ORs it into the existing
  names-you notice (postedMention, on by default, 5-minute per-agent cooldown already in phonenotify).
- A word naming ANY agent card on this computer is the agent's, never the person's (member or not).
- Not for the person's own post, not in a federated room (the name may be the other computer's person).
- For a post that woke no member, the #8566 note skips the person's name and personNote says it named the
  person, and only what is true either way (they see every post; the phone is told when notices are on).

## Rejected
- Waking the person through needs_you: a room post is not a blocked agent, and needs_you has its own
  lifecycle (clear, held). postedMention is the seam #6254 built for exactly "a post that names you".
- Matching a plain first name without @ or header ("Dana said..."): a plain word never addresses (@ rule).
- Matching inside a word (Danae): whole-token only, as the @ rule.

## Weakest premise
- That the About-you name is what colleagues call the person. If it is unsaved or a formal name, only
  `@operator` matches. A nickname list would need a new About-you field; not built.

## Validation order
- Blind review first, then one full local `tools/run-tests.sh` run (Mortals is held for the 0.8.10 cut).

## Review iteration 1 (and what stays as it is)
- The sender note no longer mentions the phone: only the token route (/api/post) sends a notice, a pane-claim
  post and the outbox drain do not, and the cooldown and settings are invisible to messages.js.
- A header names the person only by the whole name, or by the first word when the next word is lower case.
- Known and kept: a post that names the person now goes through postedMention, not postedRoom, so someone with
  postedMention off and postedRoom on gets nothing for it (replies to the person already work this way, #6254).
- Known and kept: the outbox drain sends no phone notice for a post that names the person, as it sends none for
  a reply to them; only the live /api/post route notifies.
