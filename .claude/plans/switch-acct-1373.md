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
- `render-model-change.js` now seals `AGENT_WORKFORCE_HOME`. It was the one root that
  check did not seal and it is the one the accounts list reads, so a sandboxed check was
  enumerating the operator's real `~/.codex-*` sign-ins.

## Finished when

- A person switching an agent to OpenAI can choose which sign-in it lands on, and the
  agent actually starts in that home (`CODEX_HOME` in the launch job, not merely the
  return value).
- Someone who does not touch the menu gets exactly the previous behaviour.
- A named account that no longer exists is refused, not silently replaced.
- The picker is **seen in a real browser**, per my standing rule that no frontend change
  merges without being seen on screen.

## Proof before the write

- `engine/create.switch-account-1373.test.js`: 2 tests, pass, and **repeatable** (3
  consecutive runs exit 0, which is the arm that caught the launchctl defect below).
- Full runner: **2893 tests, 2893 pass, 0 fail, exit 0**.
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

## Still open at the time of the PR

⌛ The browser check has not been run: the browser is held by another agent for two
in-sequence PR runs. **This does not merge until it has been.**
