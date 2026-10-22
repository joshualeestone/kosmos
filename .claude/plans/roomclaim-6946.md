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
  claiming twice answers "already yours", so a timed-out claim is safe to run again. `--release` gives it back; when you hold
  nothing it is a no-op (exit 0) that names the holder, if there is one.
- A plain `kosmos react <p> <id> 🙋` is held to the same rule, so the rule cannot be walked around.
- Every 🙋 form is stored as the plain 🙋, so a claim is one pill and one release takes it back.
- The person is never refused (their room), and their 🙋 is an ordinary reaction: it agrees with a claim and never
  is one (round 3: the person's picker has no 🙋, so their only 🙋 is a click on an agent's pill, which means "+1").
- A claim counts only while its holder is a member of the room (removed agents filtered, as react() does), so a holder
  who left cannot lock a post.
- The holder is the earliest live claimant (`claimantsOf`/`claimOf`); a reactor stays live while any 🙋 form of theirs
  is. "Already yours" only for the holder; a release with nothing held is ok (op none), so a retried release is fine.
- `kosmos room` prints `[kosmos] [mK] is claimed by X (N minutes ago); unless you are X, do not post that you are
  taking it.` under the post (the holder is always an agent), and the page's post row
  carries `claim: {by, at}`. Ages are relative so they need no timezone and a three-day-old claim reads as one.
- The agent guidance (doctrine v38) says to claim first and not to post "taking this" when the claim is someone
  else's.

Rejected:
- A `kind:'claim'` row of its own: a second replay model next to reactions, and the page would need new drawing.
- Refusing or nudging a "taking this" POST by matching its text: a text match is either too strict to fire or too
  loose and blocks real posts (the same reason #6921 part 1 was decided against).
- Expiring claims: a stale claim shows its age, its holder can give it back, and it ends when its holder leaves the
  project. Revisit if stale claims turn up.
- The person taking a claim over by clicking its pill (built in round 1, removed in round 3): a "+1" click silently
  took the post from the agent and the page could not say so. A person-side "free this claim" control on the page is
  the follow-up card instead.

## Proof
- engine/roomclaim-6946.test.js: the race (second refused, naming the first) and its CONTROL (the same second call on
  an unclaimed post lands); plain 🙋 and a skin-toned 🙋 refused; already/release; the person; react's other refusals
  kept; the claimOf replay; the review-1 cases. Mutation: with the claim rule disabled, the race, the plain-react
  bypass and claiming over the person go red; see Review 1 for the later rules' mutants.
- server.projects.test.js #6946: through the REAL /api/react route with an agent token; the text line appears and
  names the agent; the person's click on the pill leaves the holder alone; a removed holder drops out of the line
  (control: back on the project, they hold it); it goes when given back; control with no claim prints nothing.
- cli.claim-6946.test.js and tools.windows-kosmos-cli-claim-6946.test.js: what each CLI sends, each answer's words,
  exit 1 on a refusal, exit 0 on a no-op release, usage on a missing id.

## Review 1 (blind, 2 BLOCKER, 6 WARNING): all fixed
Stuck claims (non-member holder; the person had no way out), 🙋 variants not released, already said to a non-holder,
a retried release reading as failure, untested route passthrough and Windows verb, a dateless time, the holder told
not to take its own post; plus refusal time as UTC, the guidance paragraph's position and its missing escape hatch.
Each new rule has a mutant that a test catches (members, canonical form, takeover, already, route passthrough).

## Review 2 (blind, 0 BLOCKER, 3 WARNING): fixed, partly SUPERSEDED by round 3
Round 2 kept and announced the person's takeover (a room note, `tookOver`, `takenBy: 'you'`); round 3 removed the
takeover entirely, so none of that is in the code. What round 2 left that stands: a new claim ends a departed holder's
claim (`takenBy: 'left-the-room'`); roomClaimOf with a removed holder and a control; no member list filters nobody; a
release with nothing held is op none; only 🙋 forms claim.

## Review 3 (blind, 0 BLOCKER, 2 WARNING): fixed by removing the takeover (above); the claim verb added to the
agent-token verbs table; every raised-hand form a pill can show is a claim; a non-holder's release is a no-op that
takes their stray 🙋 off; the removed list is read once per room read; test stubs use the engine's current sentences.

## Review 4 (blind, 0 BLOCKER, 3 WARNING): fixed. The room route's own member filter is tested through the route
with a removed holder and a control (a mutant passing no members goes red); a no-op release names the holder in both
CLIs; the card comment that described the round-0 behaviour is corrected on #6946.

## Review 5 (blind, 0 BLOCKER, 1 WARNING): fixed. The guidance said to release "when you stop", and Stopped also
means finished, so a finished request would show as free and be redone; it now says to release only when stopping
before it is done, and to keep a finished one claimed. The holder's own plain 🙋 toggle-off is tested.

## Review 6 (blind, 0 BLOCKER, 1 WARNING): fixed. A raised hand from before this rule would have counted as a claim
of whatever age it is, so react() now marks the claims it writes (`claim: true`) and only marked adds count; an old
🙋 stays an ordinary reaction (control: the same row with the mark is a claim). Guidance: a claim stops counting while
its holder is off the project; if the claim could not be made at all, say it in the room as before; "do not raise a
hand to say you are available". A left-the-room remove records `takenBy` (the new claimant) and `because`. Windows
timeout path tested.

## Review 7 (blind, 0 BLOCKER, 1 WARNING): fixed. An old unmarked 🙋 pill could never be taken off (an agent's
toggle claimed the post instead; a toned pill stuck). Every take-off now removes all of the reactor's live 🙋 forms,
marked or not: an agent's plain toggle on a pill that is not the claim un-reacts it, a claim replaces an old pill of
the claimant's with the one marked pill, and the person's click removes whatever 🙋 form they have. Guidance: on a
timeout run the claim again first, and only if Kosmos still cannot be reached say it in the room.

## Weakest premise
That agents run `kosmos claim` before posting. The rule only binds an agent that claims; one that skips it and posts
"taking this" is not stopped. The guidance is the lever, and the claim line in `kosmos room` is the second chance.
Also: claims are this board's rows, so a federated room's other computers do not see them. And the person has no way
to free a quiet holder's claim except asking the agent or removing it from the project (follow-up card).
