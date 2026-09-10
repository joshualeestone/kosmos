# Plan: Claude connect subscription-vs-API-key choice + key entry (#2433, UI slice of #2420)

## Goal / definition of done

The Settings > Accounts add-a-provider modal offers a **Claude** account the same
subscription-vs-API-key connect choice OpenAI already has (Josh, #2338: "follow suit on
Claude too"). Done when:

- Choosing Claude first shows a picker (subscription vs API key), not a flow.
- "Use an API key" gives a field to paste an `ANTHROPIC_API_KEY`, wired to the merged
  engine, ending on the standard gold connected box; the key never lingers on screen.
- "Sign in with your subscription" reaches the existing browser-OAuth flow unchanged.
- A reauth ("Sign in again") still goes straight to the subscription flow.
- No user-reachable broken control ships (see the ordering constraint).
- A browser-check pins the paint/toggle behavior; the full validation gate is green.

## Context (what already exists)

- Engine: PigeonPete's `POST /api/accounts/claude/apikey {label, key}` merged (#2423);
  api-key account listing + live badge merged (#2432, `apiKey:true` on the row).
  Success shape: `{ account: { label, connection: { state } } }` (no keyTail).
- The OpenAI choice already exists in the SAME modal (`#acct-openai-pick` /
  `#acct-openai-key-step` / `acctOpenaiChoose`). First-run has no OpenAI choice, so this
  work is settings-modal-only, matching OpenAI's scope.

## Approach (mirror the OpenAI pattern)

`web/index.html`, inside `#acct-claude-flow`:
- Add `#acct-claude-pick` (the choice) ahead of the sign-in.
- Wrap the existing subscription controls (`acct-add`, `acct-add-confirm`, `acct-flow`,
  `acct-add-note`) in `#acct-claude-sub-step`, keeping their ids so
  `acctReauthChrome`/`acctFlowPaint`/`acctAddStart` are unchanged.
- Add `#acct-claude-key-step`: a password field for the key (+ Show), an optional name,
  and Add.
- JS: `acctClaudeStep` (resting = picker), `acctClaudeShowSub`, `acctClaudeChoose`, plus
  the key-submit / Show / pick-button handlers; restructure `acctPick` so a fresh Claude
  add lands on the picker while a reauth (`ACCT_REAUTH_DIR` set) lands on the sub step;
  make `acctFlowPaint` reveal the sub step for an in-flight sign-in.

## Key decision: the #2420 ordering constraint

Shipping this connect UI makes api-key Claude account **rows** user-reachable. Their
removal engine is a separate #2420 slice (Pete's `apikey-remove-2420`), not yet merged, so
a live Sign-in-again / Disconnect / Delete-and-remove on such a row only errors today.

**Decision:** suppress those three controls on api-key rows in this PR (render a disabled,
focusable `aria-disabled` Disconnect stating removal is coming instead), and gate the
disabled-Disconnect handler's "Sign in again above" remedy on the row actually having a
reauth control. Subscription rows are unchanged.

- **Rejected** waiting for Pete's slice (violates beta merge-on-green + don't-wait) and
  shipping the live-but-broken controls (a real first-impression defect on a fresh-Mac
  test). Rejected rendering no control at all (leaves the row with no removal signal).
- **Weakest premise:** that a disabled "coming soon" Disconnect is preferable to no button.
  If Josh/Pete prefer no button, it is a one-line change. When Pete's removal slice merges,
  flip these rows back to live. Confirmed the contract + this approach with Pete directly.

## Validation

- New hermetic browser-check `docs/browser-checks/render-claude-connect-choice-2433.js`
  (file://, no server): picker paint + toggle, gold connected box on a pasted-key add (key
  cleared), reauth bypass, api-key row suppression with a subscription-row CONTROL. Wired
  into `tools/browser-checks.sh`, the reason-grep counts, and the README.
- `web.reauth-1492.test.js` updated in lockstep with the broadened suppression condition.
- Full `run-tests.sh` gate + 2390 node tests green.

## Out of scope

- The engine removal path (Pete, #2420 slice).
- First-run connect choice (OpenAI's is settings-only; matching that).
- A real green with a real key needs an operator to paste an `ANTHROPIC_API_KEY` (no Claude
  key on this box; the fleet runs on subscriptions).
