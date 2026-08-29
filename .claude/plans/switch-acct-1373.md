# The switch offers the OpenAI sign-in, instead of stating a default (#1373)

Branch `switch-acct-1373`.

## Context

Creation has let a person pick an OpenAI account since #540. The switch picked
deterministically and named its choice in the confirmation, so you could see which
sign-in you got and could not change it. **That asymmetry is the whole card**, and I
filed it myself at 12:42 today when #1313's fix shipped the stated default.

`plistFor(..., configDir, runner)` already carried a codex account into the launch job
and the switch already used it, so **what was missing was only the way to say which**.

⭐ One premise of my own card went false before I started it, and I corrected it on the
card rather than planning around it: I wrote that neither a picker nor a removal existed,
"which is why this card should not sit forever". **#1372 shipped removal earlier tonight
(PR #1447).** So the multi-account case is survivable today. That lowers the urgency and
does not close the card: **removing an account to influence a picker is a workaround, not
a choice.**

## What changed

- `setProvider` takes an optional `accountDir` and uses it instead of `accounts[0]`.
- **It fails closed on an account that is not in the list**, and #1372 is what makes that
  reachable: a page that has not repainted can now name a directory that has been
  removed. Falling back would start the agent on a sign-in the person did not choose,
  silently.
- The route passes `body.account` through and says a **different sentence for a pick than
  for a stated default**.
- The switch dialog gains `#d-provider-account`, hidden unless OpenAI is chosen,
  preselected on the account the engine would have taken anyway.
- `render-model-change.js` now seals `AGENT_WORKFORCE_HOME`, **and `CODEX_HOME` and
  `AGENT_WORKFORCE_CODEX_HOME`**, which are two more roots `defaultHome()` reads and
  which walk straight past a HOME-only seal. It was enumerating the operator's real
  `~/.codex-*` sign-ins.
- **It also boots a local OpenAI models stub**, with its own two-arm control. Without it
  the check sends fixture API keys to the real `api.openai.com`, and the resulting 401
  empties the account list and reds every positive assertion while the negative arm
  still passes.

## Added after the plan was written, during the challenge loop

📌 **Recorded because a plan that does not match the diff is the drift this project
keeps catching, and three of these came out of review rather than design:**

- **The confirmation dialog echoes the pick back**, and only when a person actually
  picked. It is the last screen before a restart and it still carried the stated-default
  wording this card replaced.
- **A refusal drops the cached account list and repaints, and a pick re-arms Switch.**
  The engine's refusal says "pick one from the list and try again", and without both of
  these that remedy could not be carried out: the list was the stale one that produced
  the ghost, and the button stayed greyed out.
- **The page-to-route key is pinned on both sides.** Renaming `body.account` had left
  every test in the repo green while the feature silently reverted to the stated default.
  An HTTP-level test cannot close this today; the coupling is filed as kosmos#1465.
- **WHICH account and WHETHER a person chose it were split into two fields**, and this
  was a **wrong-account** bug rather than a wording one. Re-selecting the option a
  `<select>` already holds fires no `change`, and with exactly one working account it can
  never fire at all, so requiring the touched flag meant the row **on screen** was not
  the row sent: the engine fell back to its own first account, which this page's filter
  can make a different sign-in. `account` now travels whenever the menu is showing;
  `picked` gates the sentence.
- **Two user-facing sentences dropped their sign-in clause**: the `setAccount` refusal in
  `engine/create.js`, and the parked-model message on the panel a person lands on right
  after choosing. Both said "this computer's OpenAI sign-in", which implies there is one.
- **The picker announces itself** through the existing `aria-live` region when it appears,
  on the transition only. WCAG AA is this worker's stated bar.

## Finished when

- A person switching an agent to OpenAI can choose which sign-in it lands on, and the
  agent actually starts in that home (`CODEX_HOME` in the launch job, not merely the
  return value).
- Someone who does not touch the menu gets **the same account** the engine would have
  chosen before this card. ⚠️ **Not literally "exactly the previous behaviour" any more,
  and the plan should not claim it**: the confirmation dialog's wording changed for that
  person too, from a sentence asserting one sign-in to one saying it picks its own unless
  you choose.
- A named account that no longer exists is refused, not silently replaced.
- The picker is **seen in a real browser**, per my standing rule that no frontend change
  merges without being seen on screen.

## Proof before the write

- `engine/create.switch-account-1373.test.js`: **3 tests** (a third was added later for
  the override-home refusal, with a control proving the same call succeeds once the
  override is gone), pass, and **repeatable** (3 consecutive runs exit 0, which is the
  arm that caught the launchctl defect below).
- `web.switch-account-1373.test.js`: **10 tests**, pass. Source-level by construction and
  it says so in its own header: it can see that a guard is present and what it is keyed
  on, and it cannot see the rendered page.
- Full runner: **2903 tests, 2903 pass, 0 fail, exit 0**.
- **Both guards perturbed inside the real runner and required to go RED**: ignoring the
  pick gives "the switch ignored the account the person picked"; failing open on a ghost
  account fails the refusal test. Baseline green.

## What I got wrong on the way, so it is not re-derived

**The first version of the test called `createAgent`, whose name-collision check runs the
real `/bin/launchctl`.** It **loaded three live launchd services on this machine**. I
measured all three, booted them out, and verified zero remain with no stray plists in the
real LaunchAgents dir.

🛑 **`AGENT_WORKFORCE_DRY_RUN=1` is what the browser checks use for this and it is the
wrong fix here.** `setProvider` guards the whole account block with
`runner === 'codex' && !DRY_RUN`, so under dry run **no account is chosen at all** and
every assertion would have passed against a world where the feature never ran. The tidy
fix would have produced a green test measuring nothing.

## The browser check: run, and it passes

**Closed.** `render-model-change.js`, standalone, `HEADED=0` stated explicitly so the
mode is on the record: the picker appears with both sign-ins offered, one is
preselected, and the negative arm confirms it disappears again for Anthropic. The
stub's own control fires first (401 for a key it was not given, 200 for one it was).
Zero failures, exit 0.

**Screenshot hooks** (`SHOT_1373`, `SHOT_1373_BEFORE`) were added for it, env-gated so
the release gate never pays for them, and the before/after pair is with Josh.

🛑 **One layout consequence, accepted deliberately:** the new control pushes **Switch
and Restart** onto a second line. A reviewer predicted it and no assertion in this
branch could have seen it. The panel is about 518px; two selects at the shared
`min-width: 220px` consume it. The alternative makes both menus narrower than the Model
select directly beneath them, which is the exact defect that shared rule exists to
prevent. **What I am giving up is that the button moves at the moment OpenAI is chosen.
Josh has both screenshots and can overrule me.**
