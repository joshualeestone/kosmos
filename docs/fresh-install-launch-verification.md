# Fresh-install launch verification (served 6.36+)

The ~6 external testers hit a **fresh install first**. That first-run experience
is the launch's front door, so this is the go/no-go scenario to run against the
served build the moment a cut lands. It operationalizes the fresh-install cards
(most recently #2279, the welcome project) into a checklist with pass criteria,
and it says which parts an agent can automate and which a person has to watch.

**This is a scenario, not a fix.** Run it; do not edit the product from it. If a
step fails, file a bug with the served URL, the step, and what you saw.

## Before you run: which fresh-install state are you in

Reaching a genuine fresh-install state is its own trap, fully explained in
[`clean-machine-retest.md`](clean-machine-retest.md). Read that first. The one
fact that decides half of this scenario, restated here because it is easy to miss:

> **The wizard's last screen forks on what is RUNNING.** Live tmux agents route
> you down the **adopt path** ("You already have N agents here"); only a machine
> with **no** agents shows the new-user **create path**.

So there are two fresh-install shapes, and the launch has to work on both:

| Shape | How to reach it | Who hits it |
|---|---|---|
| **Adopted fresh install** | A machine with a live fleet, wizard re-armed (`rm first-run.json`) or a fresh install over an existing fleet | A tester who already ran agents (Josh's own case, and the #2279 reporter) |
| **New-user fresh install** | A machine with **no** running agents (a clean account, or a full destructive wipe per clean-machine-retest.md) | A genuinely new tester |

⚠️ **The adopted path is the one #2279 was filed on and the one most testers with
an existing fleet will hit, and it is the path the old seed logic never covered.**
Verify it explicitly; do not assume the create path result carries over.

## Area 1 - the welcome project (#2279 / PR #2293)

**What shipped:** the "Getting started" welcome project now seeds at **first-run
completion**, independent of whether the person ever creates an agent through
Kosmos. Before this, it only appeared when the first agent was made through
Kosmos, so an adopted fresh install (agents already on the board) landed on an
empty Projects tab. That was every tester with an existing fleet.

**Verify, on BOTH shapes above:**

1. Reach the fresh-install state (adopt shape first - it is the regression case).
2. Complete first run to the board.
3. **PASS:** the Projects tab shows a project named **"Getting started"**, and
   opening it shows the welcoming room note ("This is where you talk to everyone
   on a project at once ... only here to show you around").
4. **PASS (new-user shape):** after completing first run and then creating the
   first agent, there is still exactly **one** "Getting started" project and the
   new agent is **on** it (it adopts the home first-run seeded, it does not grow a
   second).

**How to check it. The primary check is the board UI**, above: complete first run
and look at the Projects tab. That path has no auth to fight and no store to
resolve, and it is what a tester actually sees. Do that first.

**The store must have NEVER seeded the welcome project, whichever way you check.**
The seed fires only when BOTH the store holds no projects AND a once-EVER flag
`seeded-project.json` is absent (the flag is what lets "never had one" differ from
"the person deleted it"). Re-arming the wizard removes `first-run.json`; it does
**not** remove `seeded-project.json`. So a store that was onboarded once, then had
its welcome project deleted, has an empty Projects list but a PRESENT flag -
completing first run there seeds nothing and the count stays 0. That is correct
product behavior, and a verifier who read it as a regression would file a **false
FAIL**. Use a store that has never seeded: a full destructive wipe (`rm -rf` the
store, per clean-machine-retest.md) or a genuinely new account. Both clear the
flag with the rest of the store.

**The served-API form (agent-runnable, but auth-gated - read this or get a false
FAIL).** A served board is not a sandbox, so it **enforces the board token**: every
`/api/*` request without a valid `x-kosmos-board-token` header returns **403** at
a pre-dispatch gate. A bare `curl` therefore
403s, and `grep -c 'Getting started'` reads **0** off the 403 body - so all three
commands below would "pass" the before and "fail" the after and manufacture a
bogus #2279 regression. Two consequences the recipe has to respect:

- **The token goes OFF argv.** argv leaks it cross-account (kosmos#1970); the CLI's
  own `kosmos_curl` writes it to a mode-600 file and passes `curl -H @file`. Do the
  same - never `-H "x-kosmos-board-token: $tok"` on the command line. The token is
  the board's `board.token` file inside the served account's store.
- **The address is per-account.** Resolve it from the CLI (`kosmos status` prints
  the board URL); do not assume `16180` - the wrong port lands you on a different
  account's board. (The origin/cross-site guard is a *separate* gate; passing it
  is necessary but not sufficient - both gates must pass, and a request that
  clears the cross-site check still 403s without the token.)

```
# Served, never-seeded store. STORE = that account's Application Support/AgentWorkforce;
# BOARD = its URL from `kosmos status` (NOT an assumed port).
hdr="$(mktemp)"; chmod 600 "$hdr"
printf 'x-kosmos-board-token: %s\n' "$(cat "$STORE/board.token")" > "$hdr"
curl -s -H @"$hdr" "$BOARD/api/projects" | grep -c 'Getting started'          # BEFORE: 0
curl -s -X POST -H @"$hdr" "$BOARD/api/first-run/complete"                    # complete
curl -s -H @"$hdr" "$BOARD/api/projects" | grep -c 'Getting started'          # AFTER: 1
rm -f "$hdr"
```

If you see 0 after, before calling it a regression: confirm the requests were
authenticated (a 403 body also greps to 0) - `curl -s -o /dev/null -w '%{http_code}'
-H @"$hdr" "$BOARD/api/projects"` must be 200, not 403.

⚠️ **Do NOT run the wipe/complete form against a store you care about** - it
destroys real data and seeds a real project. Run it against a throwaway store /
a test account, per clean-machine-retest.md.

**Weakest premise, named:** the server seed is unit- and route-tested (see
`server.projects.test.js` `#2279` tests), so this scenario's job is to confirm the
**served** build carries that fix and that the board **renders** the seeded
project - not to re-derive the logic. If the API returns the project but the board
shows an empty Projects tab, that is a render bug, not a seed bug; capture both.

## Area 2 - first run completes

The whole numbered wizard has to walk end to end and land on the board.

**Automatable (existing browser-checks - render half):**
- `render-first-run.js` - every first-run state painted in a real browser.
- `render-firstrun-namestep-1994wiz.js`, `render-firstrun-enter-2186.js`,
  `render-firstrun-model-continue-2134.js` - individual step behaviors.
- `click-first-run.js` / `lib-firstrun-steps.js` - the click-through.

**Operator-observed on the served build:** the wizard actually advances step to
step, Continue is enabled when it should be, and the final screen lands on the
board (not a blank or an error). Deep-link `/?first-run=1&fr-step=N` shows a
single screen with **no state mutation** (clean-machine-retest.md) - use it to
eyeball a screen, not to test the boot decision.

## Area 3 - the permission flow

A non-technical tester must not be alarmed by the macOS permission gauntlet, and
the accessibility gate must actually gate.

**Automatable (existing browser-checks):**
- `render-preflight-2163.js` - the pre-flight "you're going to get warned by these
  sorts of things" interstitial renders and its Continue leads into the flow.
- `render-a11y-gate-2125.js` - the Accessibility Continue-gate is fail-safe and
  positive-only (blocks Continue only on a definitive not-trusted reading; a
  browser with no native reading does NOT block).

**Operator-required (native, no browser-check can see it):** the real macOS
permission dialogs fire, each paired with its explainer screen, and granting them
actually unblocks the flow. A tester on a genuinely fresh macOS account is the
only way to see the real TCC prompts; an agent on this box cannot.

## Area 4 - agent adoption and import

The two ways an existing fleet comes into Kosmos both have to work.

**Automatable (existing browser-checks):**
- `render-found-count.js` - the found-agents screen: one row per agent and a count
  that cannot disagree with its rows (#1346).
- `render-found-board.js` - the board panel for agents Kosmos is not yet managing
  (the route in for everybody who already finished first run).
- `render-adopt-1531.js` - the adopt prompt renders as a question, the name field
  is editable, Add posts the typed name, an empty name is refused.
- `import-agent-flow.js` - "import my existing agent": after pasting a CLAUDE.md
  and pressing "Bring it in", the create-instructions textarea actually holds the
  imported text.
- `render-found-undo.js` - undoing an add.

**Operator-observed on the served build:** on a machine with a live fleet, the
found list shows the real agents; adding one puts it on the board; the count
matches. On a machine with none, the create path appears instead.

## Running the automatable checks against the served build

The browser-checks live in `docs/browser-checks/`. They run under the pinned
pw-runtime (NODE_PATH to `~/work/pw-runtime/node_modules`, `HEADED=0`), not
claude-fe. Most intercept API responses and render the client path, so they prove
the shipped **client** paints correctly; they are the render half of this
verification. The server half (the #2279 seed, the a11y reading, the real found
list) is the served-API curls and the operator observation above.

⚠️ **Box contention:** other agents run pw-runtime too; two Playwright runs starve
each other and the loser "fails like missing code". Run one at a time on a
browser-quiet box.

## The fast go/no-go (smoke subset)

If there is time for only one pass, do these five, on the **adopt** shape:

1. First run walks to the board (Area 2, operator).
2. "Getting started" is on the Projects tab with its room note (Area 1, #2279).
3. The permission preflight + a11y gate behave (Area 3: `render-preflight-2163.js`
   + `render-a11y-gate-2125.js`, plus the real dialogs if on fresh macOS).
4. The found list shows the real fleet and an add lands on the board (Area 4).
5. No console errors on the served board through the whole walk.

A red on 1, 2, or 4 is a launch blocker (the front door is broken). A red on 3's
native half needs a fresh-macOS tester and is flagged, not waved through.

## What this scenario deliberately does not cover

- **The install download itself** (the ~200MB Claude Code fetch, the confirm step)
  - a separate concern, operator-observed.
- **Windows** - the reading-half / runner story is its own lane (#2281 and the
  Piece-3 work); this scenario is the macOS served board.
- **Provider connect beyond Claude** (OpenAI/Codex) - covered by its own checks
  (`render-firstrun-openai-connectbox-2241.js`, `render-picker-provider-2097.js`,
  `render-openai-key-step.js`, `render-openai-only-2096.js`).
