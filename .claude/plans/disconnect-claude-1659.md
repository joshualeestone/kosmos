# #1659: build the Claude half of account removal

## What finished looks like

A person with MORE THAN ONE Claude account can remove one from Settings, its
button is not disabled,
and it behaves the same way the OpenAI Remove beside it already does: it refuses
while agents are running on that account and names them, it forgets rather than
deletes, and it says which of those two it did.

## Why this was open

Josh, 2026-08-31 09:19: the button answered "Disconnect is not built." That was
honest rather than forgotten. `web/index.html` carried the reason in its own
title text: disconnecting "has no way to tell agents on it to stop first".

**That reason stopped being true when #1372 shipped.** The OpenAI route already
enumerates the agents on an account and refuses while any is on it. The card
framed this as an open design question; it was a design question that had
already been answered on the other provider and never carried across.

## The call I made, and what I rejected

The card offered three behaviours. I first chose "disconnect and stop those
agents", then **reversed it after reading the code**: the OpenAI half ships
"refuse and name them", and two buttons in one row builder, under one word,
must not mean two different things depending on a provider the person is not
thinking about. Consistency beat my abstract preference.

Rejected:
- **Stop the agents.** Diverges from the shipped sibling for no gain.
- **Leave them running.** Fails in the quiet direction: agents keep working
  authenticated against a thing that was removed, and fail later, elsewhere,
  unattributably.

## The one deliberate asymmetry

`forgetAccount` **refuses the default `~/.claude`** where the OpenAI one allows
`.codex`. Measured: `prepare()` symlinks every account Kosmos makes at
`~/.claude/projects`, and on the fleet machine two other accounts had both
`projects` and `settings.json` linked into it. Moving the default strands the
history of accounts nobody asked to remove, and the button that did it cannot
undo that.

## Shape

- `engine/accounts.js` : `forgetAccount(dir, usedBy)`, renames to
  `.removed-claude-<label>` with a collision loop so a second removal of the
  same label cannot clobber the first one's sign-in.
- `server.js` : `DELETE /api/accounts/claude`. The enumeration is **copied**
  from the OpenAI route, not re-derived, so Renet Tilley's #1447 fail-closed
  fix comes with it.
- `web/index.html` : both buttons carry `data-forget-provider`, one handler
  reads the endpoint off the button. No second handler to drift.

## What the review added, beyond the original shape

The plan below described what I set out to build. Three things the challenge
loop added are recorded here because a plan that omits them reads as a smaller
change than shipped:

- **The default row renders a PERMANENTLY disabled Disconnect.** The engine
  refuses `~/.claude`, and `list()` always emits that row first, so a live
  button there is one every user sees and none can use.
- **The OpenAI control was relabelled from "Remove" to "Disconnect".** That is a
  user-visible change to an already-shipped feature. One act, one word, in one
  row builder, which is this card's own argument applied one layer up.
- **The refusal copy was rewritten twice.** The first version named two
  remedies and neither was reachable: "remove the other accounts first" implies
  the button then works (it never does), and "sign out of this one" names an
  affordance the product does not have (measured: no sign-out control exists on
  the page). It also asserted that other accounts keep their history there,
  which is false on a single-account machine. The reason is now unconditional,
  because the refusal is.

## Verification

- 18 tests: 8 on the engine function, 10 on the route.
- **6 perturbation arms**, each breaking one guard and confirming the matching
  test goes red, then restoring clean: default refusal, usedBy refusal, path
  guard, collision loop, runner filter, fail-closed.
- A route DISCRIMINATOR arm: an agent on a **different** account must not
  block, or the button would be unpressable on a busy machine.
- Full suite: 3281 pass, 0 fail (re-measured at iteration 10).
- ⚠️ **These counts are a timestamp.** The previous version of this line said 13
  and 3267 and was stale within two iterations, which is the same defect this
  plan records elsewhere: a number written once and read as current.

## Consequences of the default refusal, recorded rather than left in a comment

**On a single-account machine the capability this card was opened for is
unreachable.** `list()` emits the default row whenever `~/.claude.json` carries
an `oauthAccount`, and on the common install that is the only row, so its
Disconnect is permanently disabled and there is no other path (#1492's "Sign in
again" re-auths the same identity rather than replacing it).

**That is a deliberate call and it is defensible** (removing the only account
leaves Kosmos with none, and `prepare()` symlinks other accounts' history into
that folder), **but it was not written down anywhere**, and a plan that
justifies the refusal without naming who it leaves with nothing reads as more
complete than it is.

**A stopped agent is invisible to the refusal.** `safeRoster()` reports agents
the live roster knows (`listPanes()` plus `panelessKeys()`, the latter gated on
`liveness.alive`). An agent that exists but is not running keeps a launch file
naming this config dir, so removal proceeds and its next start points
`CLAUDE_CONFIG_DIR` at a renamed directory. It bites harder on Claude than on
OpenAI because transcripts live under the config dir. Inherited from the OpenAI
route, named in the route docblock, and now named here too: a data-visible
failure mode recorded only in a code comment is recorded for nobody.

**The refusal is announced AND focusable, and both halves shipped.** The reason
rides the `aria-label` rather than only the `title`, because a `title` on a
disabled control is not announced; and the control is `aria-disabled="true"`
rather than natively `disabled`, so it stays in the tab order and a keyboard user
reaches it.

⚠️ **THE SECOND HALF WAS MISSED FOR ONE ITERATION AND THAT IS THE INSTRUCTIVE
PART.** Making the control focusable also made it PRESSABLE, and the shared
handler binds only `[data-forget]`, which this branch deliberately lacks. So for
one iteration Enter and Space did nothing at all, with no feedback: the
accessibility fix created a fresh instance of the exact
nothing-that-looks-live-may-do-nothing shape it was meant to serve. A no-op
handler now writes the button's own `title` into the accounts message line, so a
press produces the reason on every input path, and it reads the title rather than
repeating the sentence so it does not become a third copy.

🛑 **AND THE SAME EDIT SILENTLY BROKE TWO GUARDS, WHICH IS WHY THIS SECTION IS
LONG.** `b.disabled` in the browser check is the IDL property and reflects only
the native attribute, so the arm asserting it went red; and the node floor
`/disabled/` matched the substring inside `aria-disabled`, so it stopped
discriminating and did not catch the first. **One markup change, two guards
quietly retired, in opposite directions.** Both are re-anchored on the exact
spelling and perturbation-checked in both directions.

## Known gap, narrowed

**The browser check now covers the Claude control's STATE but not a click.**
The diff adds three arms and seeds two Claude accounts in sandbox 4 so they are
exercised rather than dormant: the OpenAI control is live, a non-default Claude
control is live, and the default one is disabled. What is still not covered is
pressing the Claude button end to end, the way the OpenAI flow is pressed.

**I did not add that press, deliberately.** I cannot run the browser gate from
here, and that is now MEASURED rather than asserted: `docs/browser-checks/
render-accounts-openai.js:22` does `require('playwright')`, `package.json`
declares **zero dependencies** (so `yarn install` would not supply it), and the
module resolves from neither the worktree nor the main checkout (control: an
impossible module fails identically, so the probe can say no). A chromium build
IS cached at 1.6G, so the gate is expected to run somewhere that has the package
- not on this machine as configured. and an unverified press flow in a file that has already taken down three
release cuts is a worse trade than a stated gap. The repaint ordering is
inherited rather than re-derived, because both providers share one handler.

⚠️ **And the earlier version of this section was stale within one iteration:**
it said "no browser check" after the diff had already modified the browser
check, which read as more honest than it was.
