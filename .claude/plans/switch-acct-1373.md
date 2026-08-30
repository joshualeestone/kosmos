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
- Someone who does not touch the menu gets **the account the menu is showing them**.
  🛑 **This bullet twice claimed something stronger and both versions were wrong.** It
  first said "exactly the previous behaviour", then "the same account the engine would
  have chosen". Neither holds: the page filters on live connection state and
  `openai.list()` does not, so the visible row can differ from the engine's own first
  account, **and sending the visible one is the point** rather than a regression. What a
  person who touches nothing gets is what they were shown, and the route calls it
  "your OpenAI sign-in" rather than a pick.
- A named account that no longer exists is refused, not silently replaced.
- The picker is **seen in a real browser**, per my standing rule that no frontend change
  merges without being seen on screen.

## The layout wrap: DECIDED, with measurements, and Josh can overrule

Choosing OpenAI moves **Switch & Restart** to a second line. This was carried as an open
design call for Josh. It is reversible in a commit, so it is decided here rather than
left waiting, and the three options were **measured** rather than argued.

Viewport 1300px, container 494px wide, headless, same probe for all three:

| option | provider | picker | Switch button | verdict |
|---|---|---|---|---|
| **A. as shipped** | y=399 w=233 | y=399 **w=253** | **y=441** (line 2) | inputs, then action |
| B. picker in its own `.frow` | y=399 w=233 | **y=445 w=494** | y=399 (line 1) | picker sits BELOW the button that acts on it, and stretches to double its siblings |
| C. picker out of the shared width rule | y=399 w=233 | y=399 **w=172** | **y=441 (STILL line 2)** | does not even fix the wrap, and truncates the label |

### The decision: keep A

- 🛑 **C is disqualified by measurement, not by taste.** It does not solve the wrap
  (233 + 172 + 127 still exceeds 494) **and** it narrows the picker to 172px, which
  truncates "API key ending BETA". Naming which sign-in you get is the entire card.
- **B was proposed as costing neither width nor button position. Measured, it costs
  both differently:** the picker lands at y=445, **below** the button, so a person sets
  the input after the control they press; and alone in a flex row it stretches to 494px,
  double every sibling select.
- **A puts both inputs first and the action last**, which is ordinary form order, and
  gives the picker 253px, matching the selects beside it.

### The honest cost of A, stated rather than buried

**The button moves when OpenAI is chosen.** That is a layout shift, and shifts are
jarring. It follows a deliberate click rather than appearing unbidden, which is the
weakest part of this argument and is named here so it can be attacked.

⇒ **What would change my mind:** Josh saying the moving button reads as broken. Then B
is the fallback, and it should also pin the picker's width so it does not stretch.

## Proof before the write

🛑 **THE PER-FILE COUNTS BELOW ARE FLOORS, NOT COUNTS, AND THAT IS DELIBERATE.**
An exact number here went stale twice and was filed as plan drift both times, which
is the number's fault rather than the author's: a count of a file that is still
being added to is wrong the moment the next test lands, so restating it just
re-arms the trap. A floor stays true as tests are added and still fails loudly if
a file is gutted, which is the only direction anyone actually needs to catch.

**Re-measure rather than trust any figure here:**

```
grep -cE '^test\(' server.switch-account-1373.test.js engine/create.switch-account-1373.test.js web.switch-account-1373.test.js
yarn test | grep -E '^\xe2\x84\xb9 (tests|pass|fail)'
```


- `engine/create.switch-account-1373.test.js`: **at least 5 tests** (three came after the first
  draft: the override-home refusal, with a control proving the same call succeeds once
  the override is gone, and the unpicked-account fallback that iteration 11 turned out
  to need), pass, and **repeatable** (3 consecutive runs exit 0, which is the
  arm that caught the launchctl defect below).
- `web.switch-account-1373.test.js`: **at least 20 tests**, pass. Source-level by construction and
  it says so in its own header: it can see that a guard is present and what it is keyed
  on, and it cannot see the rendered page.
- `server.switch-account-1373.test.js`: **at least 4 tests**, pass. NEW, and it closes the one seam
  that had no executed arm: the route was pinned only by regexes matching `server.js`
  against itself. ⭐ **Proven by the mutation a review used to expose the gap:** deleting
  `+ landedOn` from the OK-branch sentence leaves every source-level assertion GREEN and
  makes this file go RED.
  ⚠️ **It is in its own file, not in `server.test.js`, deliberately.** That suite states it
  never sets `AGENT_WORKFORCE_HOME`, and an arm of its own reasons from that; since
  `homeDir()` falls back to `os.homedir()`, a route test added there would enumerate the
  operator's REAL `~/.codex-*` sign-ins. This file seals all three roots instead.
- Full runner: **3083 pass, 0 fail, exit 0** (re-measured 2026-08-29 23:40 CDT, rebased onto main). The figure moves as this branch adds tests, so it is dated
  rather than stated: 2907 pre-rebase, 2935 post-rebase, 2936 after iteration 13's pair
  test, 2937 after iteration 14, 2938 after iteration 15's fail-quiet guards.
  🛑 THIS NUMBER HAS GONE STALE THREE ITERATIONS RUNNING (14, 15 and 16 each caught it),
  and the reason is structural rather than careless: every iteration that adds a guard
  moves it, so the plan is stale the moment the work it describes improves. ⇒ TREAT THE
  FIGURE AS A DATED SNAPSHOT, NOT A FACT TO MAINTAIN, and re-measure rather than trust it:

  ```
  bash tools/run-tests.sh; grep -c '✔' <the output>
  grep -cE '^\s*test\(' web.switch-account-1373.test.js
  grep -cE '^test\(' engine/create.switch-account-1373.test.js
  ```

  ⭐ A plan that says how to measure cannot go stale; one that states a number always
  will. The same reasoning turned "main is clean" into a check elsewhere in this fleet.
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
