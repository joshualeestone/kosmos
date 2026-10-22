# roomclaim-6946: claim a room request before saying you are taking it

Card: kosmos#6946 (agent feedback 10-22: three agents posted "taking this" on one room request in the same minute,
several times running). Claimed: icecreamkitty.

## Decision
A claim is the raised-hand reaction (🙋, any skin tone or gendered form) with ONE added rule in `messages.react()`: an
agent's 🙋 on a post that someone else already holds is refused, and the refusal names the holder and the time. The
check and the write happen in one synchronous call on the board process, so of two agents racing on one request the
second is refused before it can post. Reusing reactions means the board's page already draws the pill with the name, the
log stays append-only, and the replay rules are the ones reactions already have.

- `kosmos claim <project> <postId>` (and the Windows twin) sends `claim: 'claim'` to `/api/react`. It never toggles:
  claiming twice answers "already yours", so a timed-out claim is safe to run again. `--release` gives it back and is
  refused for a post that is not yours.
- A plain `kosmos react <p> <id> 🙋` is held to the same rule, so the rule cannot be walked around.
- The person is never refused (their room). An agent cannot claim over the person's 🙋.
- The holder is the reactor whose live 🙋 was added earliest (`claimOf`); a remove clears that reactor.
- `kosmos room` prints `[kosmos] [mK] is claimed by X (since HH:MM); do not post that you are taking it.` under the
  post, and the page's post row carries `claim: {by, at}`.
- The agent guidance (doctrine v38) says to claim first and not to post "taking this" when the claim is someone
  else's.

Rejected:
- A `kind:'claim'` row of its own: a second replay model next to reactions, and the page would need new drawing.
- Refusing or nudging a "taking this" POST by matching its text: a text match is either too strict to fire or too
  loose and blocks real posts (the same reason #6921 part 1 was decided against).
- Expiring claims: a stale claim shows its time, and the holder or the person can clear it. Revisit if stale claims
  turn up.

## Proof
- engine/roomclaim-6946.test.js: the race (second refused, naming the first) and its CONTROL (the same second call on
  an unclaimed post lands); plain 🙋 and a skin-toned 🙋 refused; already/release; the person; react's other refusals
  kept; the claimOf replay. Mutation: with the claim rule disabled, 3 of the 6 go red (the race, the plain-react bypass,
  claiming over the person).
- server.projects.test.js #6946: the text line appears, names the agent, and goes when the claim is given back; control
  with no claim prints nothing.
- cli.claim-6946.test.js: what `kosmos claim` sends, each answer's words, exit 1 on a refusal, usage on a missing id.

## Weakest premise
That agents run `kosmos claim` before posting. The rule only binds an agent that claims; one that skips it and posts
"taking this" is not stopped. The guidance is the lever, and the claim line in `kosmos room` is the second chance.
Also: claims are this board's rows, so a federated room's other computers do not see them.
