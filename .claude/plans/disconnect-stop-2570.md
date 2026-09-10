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
swap it: the button reads "Disconnect and stop N agents?" and the answer names who was stopped and
says they can be restored. That is closest to Renet's option C.

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
