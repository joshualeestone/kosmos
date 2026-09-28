# #3939 slice 3c-3b: Meta Muse in the Create Agent form (behind the flag)

Branch muse-pick-3939, off origin/main 2f8649405 (3c-3a, #4329). Angel, 2026-09-28.

## Finished looks like
With AGENT_WORKFORCE_MUSE=1 on a Mac where Muse Code is installed and signed in, a person can open Create
Agent, choose Meta, see no account row and a one-line "Meta Muse picks its own model." note in the model row's
place, press Create, and get an agent on the muse runner (the POST sends provider "meta", no account, no model).
Everywhere the flag is off, the form is exactly as today (Meta disabled, "Coming soon"). The Settings
Connections box counts a signed-in Muse as an account thinking for agents once one can be created.

## Changes (web/index.html)
1. MUSE_CREATE state + paintMuseOption(sel, current), modelled on paintAgyOption: the create
   form's (and the agent page's) Meta option is enabled only when GET /api/muse says enabled AND installed
   AND signedIn, or when it is the agent's current provider. Off-reasons in data-off: flag off -> no
   data-off ("Coming soon", today's pill); on but not installed or not signed in -> "Set up in Settings: Add a
   provider"; not read yet, or every read so far failed -> no data-off either (today's "Coming soon", so a
   flag-off board never shows a Meta word it would not show today). A failed read after a good one keeps the
   good one. Asked by museCreateAsk when the create menu paints, one read in flight at a time; a flag-off
   answer is settled for the page (the flag is the board process's environment).
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
- web.muse-create-3939.test.js: paintMuseOption / museCreateAsk arms (flag off, not installed, not signed
  in, signed in, not read, read failed, current === 'meta', flag off not re-asked) and createPickGone's
  three Meta sentences. fillCreateAccounts / applyCreateProviderUI are covered by the browser check.
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

## Review round 1 (opus, 09:10)
- Agent page for a Muse agent: the model picker gets a "Meta Muse picks its own model" arm, and the account
  picker says there is no account to move it to (both as Antigravity). acctMoveWorld keys 'muse' so no row
  matches.
- museCreateAsk: a flag-off answer is not asked again per paint. Flag on stays asked per paint (sign-in shows
  without a reload).
- createPickGone's Meta sentence names the real reason: not available (flag off), not set up (not installed),
  not signed in.
- Node test file added (the stubs in four sibling tests already named it); the browser check now reads the
  create request itself for provider meta / no account / no model.
- Deferred: the one validation red at the start (engine/musefront.test.js "a long turn keeps saying
  working") is not in this diff and passes alone 15/15 at load 70; contention.

## Review round 2 (sonnet, 09:28)
- The browser-check index entry still said the Connections box does not count Muse; rewritten for 3c-3b.
- NIT left: acctMoveWorld's 'muse' key is unreachable today (both callers stop earlier for a Muse agent),
  as its 'antigravity' key already is; kept so the helper answers right if a caller changes.

## Review round 3 (opus, 09:51)
- providerOf reading muse as 'meta' made "Switch to Anthropic" reachable on a Muse agent's page, a
  setProvider path (muse -> claude) no test covers, whose dialog would speak of model and account choices
  a Muse agent does not have. DECIDED: moving an agent off Muse is not offered in this slice, like moving
  one onto it: the provider menu is held down with one line saying so. Rejected: an engine test for the
  switch now (it belongs with the slice that offers switching both ways). Weakest premise: the engine
  still accepts that switch from a direct API call, as it did before this branch; the page just no
  longer offers it.
- A 500 arm beside the throw arm in the failed-read node test.
- NITs left: museCreateAsk's finally has no open-form guard (it acts on the live form, not another
  agent's, and the chain ends once the value leaves meta); the native option text still ends "coming
  soon" (the Decided section's known premise; a follow-up when the flag turns on by default); goneLoad
  stubs vendorPicksModel (the real one is pinned in web.agy-on-3568).
