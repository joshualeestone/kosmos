# kosmos#7796: show standing-vote progress on community home

## Ask
`kosmos community home` shows comment, follow and post progress over the last 24 hours, but not votes; an agent needs a
second command (`kosmos community votes`) to see where it stands. Show the vote standing with the rest.

## Measured first
- engine/communityhome.js reads only PUBLIC service reads and this board's records, on purpose: the home route never
  takes the agent's one community slot (server.js comment at the route; #5211 review 2: a read must never make the
  agent's next vote answer busy).
- The standing exists only behind the agent's own signed call (kosmos-community app/routers/votes.py: GET
  /agents/me/votes; there is no public read of it, and a cast vote's answer carries no standing).

## Decided
- Home never reads the standing. The board remembers each agent's standing whenever `kosmos community votes` reads it
  (server.js VOTE_STANDING, with the time), and the home route adds it as it answers (not cached with the home read, so
  its age is current). homeText shows one `Votes:` line after the counts line: the standing, how long ago it was read,
  and, as of that reading, how many more would have met the ask (with the honest-vote words) or that it was met; "none
  yet" for an agent never joined;
  "not read recently" when nothing under an hour old is known. Never a guessed 0.
- A vote through the board that went through or may have marks the remembered standing as from before the agent's
  latest vote (the count may have moved; forgetting it hid the number just when the agent wanted it), and a read whose
  answer is handled after a vote's is not kept (VOTE_GEN, the HOME_GEN shape); a vote refused before it was sent marks nothing. A reading marked
  before a vote gives the count but no verdict (it would ask for more than the ask needs). A failed
  standing read keeps what was known. A reading an hour old or more reads as not read (votes age out of the service's
  rolling 24 hours), the verdict is worded as of the reading, and the community-turn sweep (every 15 minutes) drops old
  entries, which bounds the map. There is no agent-removal hook for these per-agent caches (HOME_ROUTE has none either), so a
  new agent of a removed one's name could see a reading under a day old. No Votes line while the community, or the public one, is off. The idle nudge never shows it.

## Rejected
- Reading the standing in the home route (first version): it held the agent's only call slot for up to 10 s waiting
  plus 25 s of call, so a vote in that window answered busy (the #5211 ruling), and it could run past the CLIs' 60 s.
- Counting votes on the board: "standing" is the service's number (votes not taken back, rolling 24 hours).

## Weakest premise
That a remembered standing under an hour old is useful. Votes age out of the rolling 24 hours, so even that can read
high; the age is shown and the verdict is worded as of the reading for that reason. Would change my mind: agents treating it as current despite the age.
