# kosmos#2570: disconnect AND stop

Option 2 from #1659, built on the night shift of 2026-09-09 by April.

## The problem, in one line

#1659 shipped the safe half: an account with agents on it REFUSES to disconnect, and names them.
The person then has to go and stop each agent by hand and come back. Josh's own framing on #1659
called option 1 "safest but least useful".

## What is built

An explicit opt-in flag, `stopAgents: true`, on the two account DELETE routes. With it, the agents
named in `usedBy` are stopped first and the account is then disconnected or deleted. Without it,
nothing changes.

| door | route | with no flag | with the flag |
|---|---|---|---|
| Disconnect Claude | `DELETE /api/accounts/claude` | refuse, name the agents | stop, then rename the dir aside |
| Delete Claude | same, `remove: true` | refuse, name the agents | stop, then delete |
| Disconnect OpenAI | `DELETE /api/accounts/openai` | refuse, name the agents | stop, then rename |
| Delete OpenAI | same, `remove: true` | refuse, name the agents | stop, then delete |

On the page, the row's armed button gains a SECOND confirm. It is offered only after the server
has refused once and named the agents, so somebody disconnecting an idle account never sees a
warning about stopping agents.

## Decisions, and what was rejected

**Reuse `removal.remove(name)`; do not write a stop.** It disables the launchd job before booting
it out (KeepAlive revives it in the other order), treats "no such service" as success, and RECORDS
the agent on the removed list. That record is what makes this reversible: sign back in, press
Restore. Rejected: a hand-rolled `launchctl bootout` in the route, which would have been a stop
nobody could undo.

**One stop helper, two routes.** The two routes each enumerate `usedBy` in their own copied loop,
which this codebase accepted for diffability. The stop is NOT copied: two spellings of "stop these
agents and decide whether it worked" would fail asymmetrically, one provider stopping an agent the
other refuses to.

**Leave the engine's refusal intact rather than bypassing it.** `usedBy` is cleared only after
every name comes back REMOVED, so a stop that silently did not work is still a refusal and not a
rename under a live agent. Rejected: passing an empty list unconditionally, which would have made
the engine guard decorative.

**Anything that is not a full REMOVED refuses, PARTIAL included.** A PARTIAL means the shut-down
could not be confirmed, so the agent may still be live. Renaming its account out from under it is
the exact #1659 hazard.

**The stop loop sits after the fail-closed `complete` return, by position.** An uncertain
enumeration can never reach it. Stopping a guessed set is worse than refusing.

## The copy

Josh owns the wording per #1659, and Renet put three options on the card. The standing rule is that
a copy carve-out parks one sentence and not the card, so an honest version ships now and he can
swap it: the button reads "Disconnect and stop marlowe?" for one agent and "Disconnect and stop 2 agents?" for more, which is what the browser check pins and the answer names who was stopped and
says they can be restored. That is closest to Renet's option C.

**Ask the engine before stopping anything.** Both engines refuse the DEFAULT account
outright, and refuse a path that is not one of their accounts, and BOTH of those checks run
BEFORE their agents check. So the route now makes a pre-flight call with the real (non-empty)
`usedBy` first: that call can only return a path refusal, a default refusal, or the agents
refusal, and can never perform anything, because every destructive step sits after the agents
guard. The agents refusal is told apart by SHAPE (it is the only one carrying a `usedBy` array),
not by matching its prose. Without this, a request naming the default account stopped every agent
on it, for real, and then refused.

**A stop is only believed when the commands actually ran.** `engine/remove.js` has two
fake-success paths, and its top-level `dryRun` marker covers only one: a missed live-execution
opt-in warns to stderr and returns success for every command, unmarked. So the route asks the new
`removal.commandsAreReal()` (runner installed, or live execution armed), which is the only place
that knows both halves. A caller that asked `liveExecutionAllowed()` directly would answer false
whenever a runner is injected, which is exactly when the commands DO run.

**The set the person agreed to is the set we act on.** The confirm names the agents from the
first refusal, and the route re-enumerates at press time, so an agent created on the account
between the two presses would otherwise be stopped having never been shown to anybody. The page
therefore sends `stopNames` (the set it displayed) and the route refuses anything enumerated
beyond it, answering `consentStale: true` so the page can re-offer with the new set. A caller
that sends no names is deliberately unchanged: this is a board API, `stopAgents` alone is a
complete request, and demanding a list would break every caller that is not this page.

**The identity refusal is handled separately, because the pre-flight structurally cannot see it.**
"that is not a Claude/OpenAI account on this computer" sits AFTER the agents guard in all four
engine functions and cannot be hoisted: `identityOf` answers null for a missing directory too, so
moving it above the existence check would turn "already gone" into "not an account". The route
therefore asks the engine's own `list()` for membership (the same identity rule, not a copy of
it), guarded on the directory existing so the quiet-success arm survives, and SKIPS the stop.
⚠️ **The person then gets the agents refusal rather than the identity one, and that trade is
taken knowingly:** getting the better sentence would mean clearing `usedBy` and relying on my
reading of guard order, which has been wrong three times on this branch, and the failure mode if
it is wrong again is a real rename under live agents.

⭐ **THE PATTERN WORTH KEEPING FROM THIS LOOP.** Three separate reviewers found three separate
counterexamples to the same claim of mine, that "every refusal which does not depend on the
agents comes before the agents guard": the default guard, then the OpenAI sign-in guard, then the
identity guard. Two were fixable by moving the guard; the third was not, by design. **A claim of
the form "every X does Y" in a file I do not own is the shape that kept being wrong**, and the
durable fix was to stop asserting the invariant and instead name which cases are covered, which
are not, and why.

## Residuals, named rather than left to be found

- **kosmos#2609 IS NO LONGER A RESIDUAL. It was filed from this loop and somebody shipped the
  engine half while this branch was still iterating**: PR #2613 (`c92c7cf2`, merged into main and
  folded in here) makes `restoreInner` refuse when the agent's recorded config dir is gone, which
  is option 1 from the card. Verified present after the merge at `engine/remove.js:1404`. The
  frontend half is **#2615** (grey the control out before the click rather than refusing after
  it), which names me as its owner, and it is follow-on work rather than part of this card.
  ⚠️ **So the paragraph below is kept as the record of a decision that was overtaken, not as a
  live one.** It is left in deliberately: the reasoning is still what I would have shipped, and a
  plan that quietly rewrites its own history to look prescient is worth less than one that shows
  where it was superseded.
- **The original deferral, now overtaken, and it WAS a decision rather than an oversight.**
  A reviewer asked that it be confirmed before merge rather than after, which is fair, so
  stating it plainly: this card ships with the hazard open. The copy on the delete door is honest
  about it ("needs a different one before it can start again"), the affordance that contradicts it
  lives on another screen, and closing it means changing what Restore does for every removed
  agent. **Weakest premise in that call:** somebody who stops-and-deletes will more likely visit
  the removed list than read the sentence, so the honest copy may be doing less work than I am
  crediting it with.
- **The original filing note:** The removed list renders a Restore control for every record with no
  check that the account directory still exists, and the record carries nothing distinguishing a
  restorable stop from an unrestorable one. It pre-dates this card; what this card changes is that
  the state now takes one guided click instead of two separate acts. Not fixed here because
  `restoreInner` is a shared path and changing it naively breaks the disconnect-then-reconnect
  flow this card's own copy points people at.
- **The stop loop is synchronous.** Four `execFileSync` commands per agent, each with a 20s
  ceiling, multiplied by the agents on one account. Deferred deliberately: the 20s is a hang
  ceiling rather than a duration, the existing single-agent removal route already calls the same
  primitive the same way, and the person has just pressed a button whose whole content is "stop
  these agents". The reasoning is recorded at the code. If a board is ever reported wedged during
  a disconnect, the fix is to make the primitive async, not to cap N in the route.
- **The DRY_RUN-marked half of the stop guard is not covered by a test**, and cannot be in the
  in-process harness: `markDryRun` marks only when no runner is installed, and with no runner
  `commandsAreReal()` already answers false, so the two conditions are mutually exclusive there.
  Both are reachable in production. The arm that exists covers the unmarked half, which is the one
  no marker could have caught.

## One behaviour change outside this feature, called out because a route-only reader would miss it

**`engine/openaiaccounts.js` now reports its refusals in a different order for EVERY caller, not
just for this route.** The sign-in-in-progress refusal moved above the agents guard, so an account
that simultaneously has running agents and a reauth in flight now answers "a sign-in is in
progress for this account; finish or cancel it first." where it previously named the blocking
agents. Both refusals are correct and both are dead ends until the person acts; the sign-in one is
the more actionable of the two, and nothing asserted the old precedence. The four sibling suites
(#1659, #1372, #1689, #2264) are green either way, which is exactly why it needs saying out loud
rather than being left to a green run.

## Weakest premise

That a person who has just been refused, and reads a sentence naming their agents, understands that
the second press stops those agents rather than only retrying. The button text says so explicitly,
which is the mitigation; a modal would be stronger and is not what this row uses for any other act.

## Test plan

- `server.disconnect-stop-2570.test.js`: both CONTROL arms (default unchanged, per provider), the
  fail-closed arm, separate PARTIAL and REFUSED arms, both doors, both providers.
- `web.disconnect-stop-2570.test.js`: the handler's source, including that exactly one place sends
  the flag and it is inside the `stopFor` ternary.
- `docs/browser-checks/render-disconnect-stop-2570.js`: three presses in a real DOM, asserting the
  ORDER (the first disconnect must not carry the flag) and the WCAG 2.5.3 armed name.

A dry-run board cannot produce a full stop of a RUNNING agent, so the happy-path arms use
registered-but-stopped agents, which is also the honest case here.
