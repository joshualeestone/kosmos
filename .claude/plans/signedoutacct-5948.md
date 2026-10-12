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
  agents, the first three named), and `connection: { state: 'none', badge: 'signed_out', because }`. When one of the
  provider's credential files IS in the folder (the list left it out because it could not read or recognise it), the
  row says so instead: `{ state: 'unknown', badge: 'unchecked' }` (the file may be unreadable, or the folder outside the
  one the list scans). So is a folder Kosmos cannot look into at all: only ENOENT counts as missing (statSync, not
  existsSync, which answers false for a permission error). "We cannot tell" is never written as "gone" (reviews 1, 3).
- The agents walked are the same set the account guard walks (`knownAgentNames`, factored out of
  `enumerateAgentsOnAccount`): the roster's cards plus known profiles not on it.
- `GET /api/accounts` sends them as `signedOutAccounts`, APART from `accounts`: eight page consumers read `accounts`,
  two of them account pickers, and a folder with no credential must not be offered to a new agent.
- `engine/accountline.answer` (both CLIs' words) prints them after the listed accounts, so `kosmos accounts` shows
  "Grok: <name>: not signed in: its sign-in or key is no longer on this computer, and <agent> uses it".

## Not done here
- One shared runner-to-provider map: this module carries its own, as server.js accountForAgent and create.js do.
  Folding the three together touches two callers outside this change; left for a follow-up (review 1, deferred).
- Settings > AI Models does not show them yet (the page reads `accounts` only). A follow-up can paint them with a
  Sign in again action; the field is there for it.
- The provider's DEFAULT folder is not looked at, whether a job names it or names none: a default account can run on
  this computer's own key from the environment (e.g. XAI_API_KEY), so a missing file there proves nothing (review 3).

## Weakest premise
That the lapsed account's folder still exists and the job still names it. If the folder itself was removed, the row
still appears (the job names it) and says the credential is gone, which is true; if the job names no folder (default
account), nothing appears, as before.
