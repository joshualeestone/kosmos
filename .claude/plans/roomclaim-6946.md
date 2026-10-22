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
  claiming twice answers "already yours", so a timed-out claim is safe to run again. `--release` gives it back; it is
  refused when somebody else holds the post, and is a no-op (exit 0) when nobody does.
- A plain `kosmos react <p> <id> 🙋` is held to the same rule, so the rule cannot be walked around.
- Every 🙋 form is stored as the plain 🙋, so a claim is one pill and one release takes it back.
- The person is never refused (their room). Their 🙋 on a post an agent holds TAKES IT OVER (the agents' claims are
  taken back); pressing it again frees the post. That is the way out of a claim whose holder went quiet.
- A claim counts only while its holder is a member of the room (removed agents filtered, as react() does), so a holder
  who left cannot lock a post.
- The holder is the earliest live claimant (`claimantsOf`/`claimOf`); a reactor stays live while any 🙋 form of theirs
  is. "Already yours" only for the holder; a release with nothing held is ok (op none), so a retried release is fine.
- `kosmos room` prints `[kosmos] [mK] is claimed by X (N minutes ago); unless you are X, do not post that you are
  taking it.` under the post (the person reads as `operator`, as elsewhere in that view), and the page's post row
  carries `claim: {by, at}`. Ages are relative so they need no timezone and a three-day-old claim reads as one.
- The agent guidance (doctrine v38) says to claim first and not to post "taking this" when the claim is someone
  else's.

Rejected:
- A `kind:'claim'` row of its own: a second replay model next to reactions, and the page would need new drawing.
- Refusing or nudging a "taking this" POST by matching its text: a text match is either too strict to fire or too
  loose and blocks real posts (the same reason #6921 part 1 was decided against).
- Expiring claims: a stale claim shows its age, its holder can give it back, and the person can take it over and free
  it. Revisit if stale claims turn up.

## Proof
- engine/roomclaim-6946.test.js: the race (second refused, naming the first) and its CONTROL (the same second call on
  an unclaimed post lands); plain 🙋 and a skin-toned 🙋 refused; already/release; the person; react's other refusals
  kept; the claimOf replay; the review-1 cases. Mutation: with the claim rule disabled, the race, the plain-react
  bypass and claiming over the person go red; see Review 1 for the later rules' mutants.
- server.projects.test.js #6946: through the REAL /api/react route with an agent token; the text line appears, names
  the agent, names `operator` after the person takes it over, and goes when freed; control with no claim prints nothing.
- cli.claim-6946.test.js and tools.windows-kosmos-cli-claim-6946.test.js: what each CLI sends, each answer's words,
  exit 1 on a refusal, exit 0 on a no-op release, usage on a missing id.

## Review 1 (blind, 2 BLOCKER, 6 WARNING): all fixed
Stuck claims (non-member holder; the person had no way out), 🙋 variants not released, already said to a non-holder,
a retried release reading as failure, untested route passthrough and Windows verb, a dateless time, the holder told
not to take its own post; plus refusal time as UTC, the guidance paragraph's position and its missing escape hatch.
Each new rule has a mutant that a test catches (members, canonical form, takeover, already, route passthrough).

## Weakest premise
That agents run `kosmos claim` before posting. The rule only binds an agent that claims; one that skips it and posts
"taking this" is not stopped. The guidance is the lever, and the claim line in `kosmos room` is the second chance.
Also: claims are this board's rows, so a federated room's other computers do not see them.
