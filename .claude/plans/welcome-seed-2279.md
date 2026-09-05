# welcome-seed-2279: the welcome project appears on a fresh install (#2279)

## The card, and why its premise was wrong

Josh, testing the 0.6.36 fresh install: the default welcome / "Getting started"
project he has seen in prior versions did not appear. The card framed this as a
regression from "a recent change to first-run/onboarding".

That premise is false, and proving it is half the value of this change:

- The welcome-project seed is **byte-identical back to archive/0.5.77** (verified
  with `git show "${v}:server.js"` across v0630..v0636 and the three archive tags;
  the first pass returned a false zero from the zsh `:s` colon-modifier trap on an
  unbraced `$v:server.js`, corrected with `"${v}:..."`).
- The engine seed itself works (verified in an isolated `AGENT_WORKFORCE_HOME`).
- The new "worlds" feature (#1704/#2238) does **not** trip the seed gate: a named
  world nests under its own root; the default world's `projects.json` is untouched.

So nobody should hunt for a "recent change" that broke it. There isn't one.

## The real gap

The seed only ever fired on the create/connect path, i.e. when the first agent
was made **through Kosmos** (`!seededFlag && projects.readAll().length === 0`,
inline in both `/api/agents` and `/api/connect-agent`). A person who arrives on a
fresh install with an existing fleet (agents already on the board, adopted from
tmux, so nothing is created through Kosmos) never triggered it, and landed on an
empty first impression. **Every external tester is that person** (~6 of them for
the launch), so all of them would hit it.

## The fix

1. **Consolidate the seed into one shared helper** in `engine/projects.js`
   (`seedWelcomeHome` / `markWelcomeSeeded` / `homeForFirstAgent` + `WELCOME_NAME`
   / `WELCOME_DESCRIPTION`). The shape was a second copy inline in create and
   connect; a third copy at first-run would have drifted (kosmos#253). The two
   existing sites now call the helper; net duplication goes 2 -> 1.
2. **Seed the welcome home at first-run completion** (`/api/first-run/complete`),
   independent of agent creation, with the welcoming room note. This is the case
   the agent-path seeds could never reach.
3. **Compose via the shared once-ever flag** so nobody gets two: whichever path
   seeds first writes `seeded-project.json`; the others become no-ops.
4. **Preserve "the first agent gets a home"**: when first-run already seeded an
   empty welcome home and it is the whole store, the first agent created/connected
   afterwards **adopts** it (`homeForFirstAgent` returns `{created:false}`), so the
   create/connect routes neither re-furnish nor roll it back, they just join it.

No frontend change: the seeded project appears via the projects list the board
already reads.

## Tests

- `engine/projects.test.js` (7 new): fresh seed; once-ever flag stops a re-seed
  even after the person deletes it; refuses over a non-empty store; fresh
  `homeForFirstAgent` creates; adopts an empty first-run-seeded home; does not
  adopt one that already has an agent; does not adopt a non-welcome sole project.
- `server.projects.test.js` (2 new, over the wire): first-run completion seeds
  the welcome home with no agent created through Kosmos + an agent made afterward
  adopts it; and does not grow a second home over one the agent path already made.
- `server.projects.test.js` #732 source-grep updated to the new helper call site
  (`projects.homeForFirstAgent(` before `create.createAgent(`) -- the ordering
  property is unchanged, only the marker moved.
- Full node suite green (4682 pass).

## Weakest premise (named for the reviewer)

I did not watch Josh reproduce this, so I inferred his exact path from his words
("the project that was already the welcome project ... that we've had for all the
other versions") plus the code. If Josh actually created an agent through Kosmos
in 0.6.36 and STILL saw no project, there would be a second, separate defect in
the create path -- but the create-seed is byte-identical and its over-the-wire
test (#166) passes, so that path is sound. The most likely truth is the
adopted-fleet gap this change closes.

## Overlap with HELD #1652

This touches the first-run/onboarding surface that HELD #1652 (find-my-agents /
auto-pull) also touches. #1652 stays held and untouched; the welcome-project seed
is orthogonal (a place to work vs adopting agents), and when #1652's approach
lands, this one shared helper stays the single seeding path so they compose.
Splinter reviewed and endorsed proceeding to the launch cut.
