# #3939 slice 3c-3b: Meta Muse in the Create Agent form (behind the flag)

Branch muse-pick-3939, off origin/main 2f8649405 (3c-3a, #4329). Angel, 2026-09-28.

## Finished looks like
With AGENT_WORKFORCE_MUSE=1 on a Mac where Muse Code is installed and signed in, a person can open Create
Agent, choose Meta, see no account row and a one-line "Meta Muse picks its own model." note in the model row's
place, press Create, and get an agent on the muse runner (the POST sends provider "meta", no account, no model).
Everywhere the flag is off, the form is exactly as today (Meta disabled, "Coming soon"). The Settings
Connections box counts a signed-in Muse as an account thinking for agents once one can be created.

## Changes (web/index.html)
1. MUSE_CREATE state + paintMuseCreateOption(sel, current), modelled on paintAgyOption: the create
   form's (and the agent page's) Meta option is enabled only when GET /api/muse says enabled AND installed
   AND signedIn, or when it is the agent's current provider. Off-reasons in data-off: flag off -> no
   data-off ("Coming soon", today's pill); on but not installed or not signed in -> "Set up in Settings: Add a
   provider"; not asked yet or the read failed -> "Checking Meta Muse". Asked when a provider menu paints,
   one read in flight at a time, latest read wins.
2. fillCreateAccounts: a 'meta' branch like 'antigravity' (empty account option, row hidden, return), so
   the Muse row is never listed as an account and the "Meta Muse key" fallback never shows.
3. vendorPicksModel('meta') true, so applyCreateProviderUI hides the model row and says
   "Meta Muse picks its own model." (switchKeyedWord('meta') is already 'Meta Muse').
4. Connections box: drop the "no agent can run on it yet" exclusion only while create is offered; decided
   below.
5. The create submit path: confirm provider 'meta' is sent and account/model are omitted (no change
   expected; test it).

## Decided
- Option label stays "Meta / Llama" (the combobox strips "coming soon"): 3c-2 left the Add a provider
  option the same way, and one name across both menus beats a new one here. Weakest premise: the native
  select text still ends "coming soon" for a screen reader that reads the hidden select, as Add a provider
  does today.
- engine/connections.js (agent-facing text) is NOT changed in this slice. The text goes to every agent on
  every machine and the flag is off everywhere; saying Meta can be connected would be false for all of
  them. It changes in the slice that turns Muse on by default. What would change my mind: the text gaining
  a per-machine clause the engine fills in.
- Connections box: count a signed-in Muse row as connected (agents can now run on it); keep the museOnly
  sentence only for the flag-off case, where the row cannot exist anyway, so it is removed.
- Switching an existing agent TO Meta from the agent page is not offered in this slice (d-provider keeps
  Meta disabled unless it is the current provider): setProvider's generic path to muse is untested.

## Tests
- web.* node tests for fillCreateAccounts / applyCreateProviderUI / paintMuseCreateOption arms (flag off,
  not signed in, signed in, read failed, current === 'meta').
- A browser check driving the real create form: Meta enabled on a stubbed signed-in /api/muse, account row
  hidden, model note shown, the POST body has provider meta and no account/model; and disabled with the
  right pill when not signed in.
- Screenshot of the create form with Meta chosen for the PR.

## Status
- 2026-09-28 07:5x: plan written.
- 2026-09-28 08:18: built (8e828c283) and checked (52ea7351e). Also, beyond the plan: providerOf reads the
  muse runner as 'meta' (an agent on Muse showed as Anthropic on its own page); the create form's
  "pick turned off" recovery is one function, createPickGone, shared by the account read and the Muse read,
  with a Meta sentence; a saved Meta pick restores while Muse is ready; the switch refusal names Meta.
  Measured: with a signed-in Muse row in the list, the old path listed that row (empty value and name), so the
  Meta branch only shows when the list is empty; the check's arm is aimed there, and a perturbation of the
  branch fails exactly that arm. web.* 2018/2018; render-muse-signin-3939 passes; surface gate rc 0.
