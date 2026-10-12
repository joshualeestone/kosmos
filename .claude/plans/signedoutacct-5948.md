# signedoutacct-5948: a signed-out account stays listed (kosmos#5948 step 2)

## Problem
Josh's report: the signed-out provider was "missing from `kosmos accounts` entirely". The keyed account lists
(openaiaccounts, geminiaccounts, grokaccounts) list a folder only when it holds a credential (a key file, or a sign-in
file; `rowFor` returns null otherwise), so an account whose sign-in lapsed and took its file with it vanished instead
of reading signed out.

## Change
- `engine/signedoutaccounts.js` (pure): from the board's cards and each agent's job, one row per NAMED account folder
  (job.configDir) that a codex/gemini/grok agent uses and that no row of that provider lists. The runner is read from
  the job first, since a stopped agent's card has none. Shape: an account row with `signedOut: true`, `usedBy` (the
  agents), and `connection: { state: 'none', badge: 'signed_out', because }`.
- `GET /api/accounts` sends them as `signedOutAccounts`, APART from `accounts`: eight page consumers read `accounts`,
  two of them account pickers, and a folder with no credential must not be offered to a new agent.
- `engine/accountline.answer` (both CLIs' words) prints them after the listed accounts, so `kosmos accounts` shows
  "Grok: <name>: not signed in: its sign-in or key is no longer on this computer, and <agent> uses it".

## Not done here
- Settings > AI Models does not show them yet (the page reads `accounts` only). A follow-up can paint them with a
  Sign in again action; the field is there for it.
- A DEFAULT-account agent (no configDir) is not looked at: no keyed provider lists its default folder, by design, so its
  absence says nothing.

## Weakest premise
That the lapsed account's folder still exists and the job still names it. If the folder itself was removed, the row
still appears (the job names it) and says the credential is gone, which is true; if the job names no folder (default
account), nothing appears, as before.
