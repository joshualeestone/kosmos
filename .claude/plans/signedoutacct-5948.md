# signedoutacct-5948: a signed-out account stays listed (kosmos#5948 step 2)

"Review N" below is challenge-loop iteration N on this branch.

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
  row says so instead: `{ state: 'unknown', badge: 'unlisted' }`, printed "not checked by Kosmos" (the file may be unreadable, or the folder outside the
  one the list scans). So is a folder Kosmos cannot look into at all: the file is READ, and only ENOENT or ENOTDIR (a path
  component that is a regular file, so no folder) counts as missing; existsSync was not used, since it answers false
  for a permission error. "We cannot tell" is never written as "gone" (reviews 1, 3).
- A gemini/grok folder whose own key is gone while this computer's secrets/env door holds that provider's key
  (GEMINI_API_KEY / XAI_API_KEY: the supervisor's door allowlist carries those two; not OPENAI_API_KEY, review 17) is also `unlisted`: the agent may still be working on the
  shared key, so "not signed in" would be confidently wrong (review 9). A door that cannot be read counts as unsure.
- When Kosmos could not look (a locked folder, an unread door), the row says that, never that a file or a shared key
  is there (review 13). A failed check, or a walk that could not read the roster, the profiles (review 14) or the job of a card that could hold a keyed account (reviews 15, 18), sends
  `unlistedComplete: false`; the CLI then does not say "none set up", and adds a line saying the list may be short.
- A signed-out row says how to fix it: add the key or sign in again in Settings > AI Models. It does not name a folder
  to re-add under: whether a name lands in the same folder depends on env overrides and label cleaning (review 11).
- The agents walked are the same set the account guard walks (`knownAgentNames`, factored out of
  `enumerateAgentsOnAccount`): the roster's cards plus known profiles not on it.
- `GET /api/accounts` sends them as `unlistedAccounts`, APART from `accounts`: eight page consumers read `accounts`,
  two of them account pickers, and a folder with no credential must not be offered to a new agent.
- `engine/accountline.answer` (both CLIs' words) prints them after the listed accounts, so `kosmos accounts` shows
  "Grok: <name>: not signed in: its sign-in or key is no longer on this computer, and <agent> uses it".

## Not done here
- The field is `unlistedAccounts` (review 4): it carries unreadable rows (`signedOut: false, unreadable: true`) as
  well as signed-out ones, so each row's own `signedOut` / `unreadable` says which.
- A credential file a provider module starts reading later is not seen here until its name is added to
  `PROVIDER_OF_RUNNER.files`; the review-2 test pins today's names to the modules' own path functions (review 4,
  deferred: only grokaccounts has a presence helper, and it uses existsSync).
- One shared runner-to-provider map: this module carries its own, as server.js accountForAgent and create.js do.
  Folding the three together touches two callers outside this change; left for a follow-up (review 1, deferred).
- Settings > AI Models does not show them yet (the page reads `accounts` only). A follow-up can paint them with a
  Sign in again action; the field is there for it.
- The provider's DEFAULT folder is not looked at, whether a job names it or names none: a default account can run on
  this computer's own key from the environment (e.g. XAI_API_KEY), so a missing file there proves nothing (review 3).

- The module's Windows behaviour (drive letters, case folding in realpath) is not tested: its test file is excluded
  from the Windows job (POSIX fixture paths).

- A stopped agent whose job predates the `runner` field (no runner on job or card) is skipped.

## Weakest premise
**A key the launch inherits from its own environment is not seen (review 13).** The shared-key check reads Kosmos's
secrets/env door only. An `XAI_API_KEY` / `GEMINI_API_KEY` inherited by the launching process would let an agent run
while its row says "not signed in". Not measured how often a launch inherits one.

**A logged-out credential file may read "not checked", not "not signed in" (review 5).** "Unlisted" is decided by a
credential file with content being THERE (an empty or whitespace-only one counts as gone, reviews 10, 11), not by the provider recognising it. If
a CLI's logout leaves auth.json with content but no usable entry (e.g. no auth.x.ai key) rather than deleting it, the row says Kosmos could not check it, which is the cautious
side of the line but not the words Josh needed. Not measured: what `grok logout` / `codex logout` leave on disk.

That the lapsed account's folder still exists and the job still names it. If the folder itself was removed, the row
still appears (the job names it) and says the credential is gone, which is true; if the job names no folder (default
account), nothing appears, as before.
