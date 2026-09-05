# #1899: kosmos whoami reports the agent's name, projects, and identity source

## What "done" looks like
`kosmos whoami` (via `POST /api/whoami`) answers not only account + model but also:
- the agent's own **name** as the board derived it, led in the sentence the CLI prints so an agent
  handed the wrong instructions can READ its way to the mismatch;
- the **identity source** (its launch token vs the tmux pane it is running in) so a weak/spoofable
  identification is visible rather than silent;
- its **projects**.
All three as structured response fields AND in the one board-composed sentence.

## Why the shape it is
The card: an agent's identity lived only in the prose it was launched with, with no way to check that
against what the system believes. The response already carried `agent` (the name) as a structured
field, but the CLI prints only the `because` sentence, which never said the name -- so reading the CLI
output could not surface a mismatch. And the existing `source` field is which reader answered for
account/model, NOT how the agent itself was identified.

- **Name** = `sender.card.sessionName` (already resolved; now surfaced in the sentence).
- **Identity source**: derived at the endpoint from the same inputs `resolveAgentSender` reads -- a
  presented agent token means identified by the launch token; otherwise the pane fallback was used. A
  pane id is enumerable and this route is unauthenticated, so the pane case is exactly the mismatch
  the card is about. Re-derived at the endpoint (not threaded back through `resolveAgentSender`)
  because report/reply share that resolver and do not want this label.
- **Projects** = `projects.projectsFor(name, roster)` names; fails soft to none so an unreadable
  projects store never turns "who am I" into an error.

## The change
- `server.js`: two small board-side composers `whoamiIdentityClause(name, source)` and
  `whoamiProjectsClause(names)` (kept `sentenceForWhoami(account, model)` untouched so its extensive
  existing tests stay green -- the new clauses wrap around it). The endpoint computes `identitySource`
  + `projectNames`, adds them as structured fields, and composes `because` as identity-lead +
  account/model sentence + projects-tail. Both helpers exported for direct tests.
- `server.test.js`: a new endpoint test (name leads the sentence, `identitySource` = pane when no
  token, `projects` is a structured array, account clause preserved, projects clause closes it); a
  unit test for both composers (none/one/two/three projects; missing name; token vs pane source). One
  pre-existing #1304 assertion updated from `/^We cannot tell which account/` (position 0) to the full
  honest account clause anywhere -- the anchor was only ever a proxy for "did not fabricate a
  confident account", which #1899's identity lead legitimately moved off position 0.

## Rejected / weakest premise
- Rejected changing `sentenceForWhoami`'s signature to fold in identity/projects: its call sites and
  many pinned tests take `(account, model)`, so wrapping around it is lower-risk and equally
  board-side (the "one shape" principle is about agents not composing their own answer, not about
  internal function count).
- Weakest premise: the identity source is a two-way token/pane label, not the full three-way
  (agent file / launch argv / supervisor record) the card floated as "ideally". Two-way captures the
  card's actual concern (strong token vs enumerable pane); a finer breakdown is a follow-up if needed.

## Verification
- `node --test --test-name-pattern='#1899|#1304' server.test.js`: 7/7 pass.
- Full server.test.js + challenge-loop before PR. CLI prints `because` verbatim, so no `install/kosmos`
  change is needed. No em dashes.
