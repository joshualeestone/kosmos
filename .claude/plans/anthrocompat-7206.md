# anthrocompat-7206: DeepSeek, GLM and MiniMax on the Claude runner (#7206)

Decided by Splinter (card comment 6423093110, 2026-10-26 12:40 CDT): one shared mechanism, slices DeepSeek, GLM,
MiniMax. This plan is slice 1: the mechanism and DeepSeek.

## Design call: a provider of its own, not a Claude key account
A survey of every path that judges a Claude account (card comment to follow) found 22 that misread a Claude key account
pointed at another vendor. The worst: adding the key checks it against api.anthropic.com/v1/models, which refuses a
DeepSeek key AND receives it. So a DeepSeek account is NOT a `~/.claude-<label>` key account. It is its own provider,
the way Qwen (#5977) is its own provider on the codex runner:

- An account is a folder `~/.kosmos-deepseek-<label>` holding `kosmos-vendor.json` (mode 600):
  `{ "provider": "deepseek", "baseUrl": "https://api.deepseek.com/anthropic", "model": "...", "key": "..." }`.
  The folder is the agent's CLAUDE_CONFIG_DIR. There is no `.claude.json` sign-in and no apiKeyHelper.
- One table (engine/anthropiccompat.js) names each vendor once: id, display name, base URL, models, where to get a key.
  GLM and MiniMax are rows added in slices 2 and 3; nothing else changes per vendor.
- The supervisor, for a claude-runner job whose home is an endpoint home, sets ANTHROPIC_BASE_URL and
  ANTHROPIC_AUTH_TOKEN from the file, UNSETS any inherited ANTHROPIC_API_KEY / ANTHROPIC_MODEL / ANTHROPIC_BASE_URL
  first (the survey found the tmux global env and Windows' whole-env copy can leak them into every Claude pane), and
  passes the vendor's model with --model (the supervisor's --model would otherwise send a claude-* id to DeepSeek).
- The key's live check asks the VENDOR's endpoint, never Anthropic's.

This leaves the Claude-account paths (key add, live badge, auth status, machine banner, usage, Settings row grouping,
`kosmos accounts`) untouched by construction: they iterate Claude account folders, and this is not one.

## What still needs an exception (runner-keyed, from the survey)
- engine/status.js authprobe / liveAuthForAuthFailed (`claude auth status` on the folder; Qwen is excluded at 8785/8805):
  exclude endpoint homes the same way.
- engine/signedoutaccounts.js:72 (excludes Qwen homes on codex): exclude endpoint homes on claude.
- engine/accountproblem.js providerOf: name the vendor, not "Claude", and no "Sign in again" advice.
- Screen classification and StopFailure reports (status.js, kosmos-report-hook.js): a vendor 401 must read as "the key
  was refused", not "its Claude sign-in". Wording only in slice 1; classification unchanged.
- Model list for the provider (create.js modelsFor) and the provider word (status.js MODEL_WORDS, worldview.js).

## Weakest premise, split in two
1. Kosmos side: that every runner-keyed path is found. Proved by tests on each exception with an endpoint home, and a
   test that a stub endpoint home never reaches api.anthropic.com from any check.
2. Claude Code side: that `claude` with ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN in an empty CLAUDE_CONFIG_DIR runs
   with no login prompt, no onboarding stop, and no anthropic.com traffic. NOT measured: a probe of the real binary
   against a local stub was refused by this session's permissions (12:4x 10-26). Claude Code documents base-URL
   gateways, so this is reasoned, not proven. It must be measured before the UI ships to anyone.

## Order
1. engine/anthropiccompat.js: the table, account folders (list/create/forget), read/write endpoint file, launch env.
2. Supervisor launch for endpoint homes on claude, with the env scrub.
3. The runner-keyed exceptions above, each with a test.
4. Server routes + Settings/setup Connect row for DeepSeek (key paste), live check against the vendor.
5. Browser check for the row.

## Progress (10-26 13:0x, paused for the 0.7.70 cut)
Done and pushed: the module and table (13 tests), the supervisor launch with the env scrub (6 tests, Qwen's 27 still
green), the stale-401 exclusion (red with it removed). Reverted: an exclusion in signedoutaccounts.js, whose table has
no claude runner at all, so it could never run.
Next: provider identity. create.jobProvider must return the vendor for a claude job on a vendor home, and
agentProvider / codexJobProvider read a job only for codex agents today. Extending that to claude agents means a job
read per claude agent per tick (memoized 2 s), which is most agents, not a few: measure the cost, or carry the
provider on the card from the launch, before choosing. Its 10 callers' provider tables (providerLabel, modelsFor,
failover families) must each learn the vendor or be shown not to need it.
MEASURED 13:3x: create.readJob costs 0.023 ms per call on this Mac (400 reads over 3 real agent jobs), and the board
already reads a job per agent on the five-second poll (accountForAgent). So agentProvider reads the job for claude
agents too (memoized as for codex); the cost is not a reason to carry the provider on the card.
DECIDED: jobProvider learns the vendor in step 4, together with the switch and move flows. Most of its callers
(create.js 2174 "already runs on", 2523/2673 the switch, worldstarts 531, server 3605) are those flows, and returning
'deepseek' before switching to it exists would send a provider those flows cannot handle.

## Windows launch: not in slice 1
engine/win32launch.js copies the board's whole environment into a Windows agent, and this slice changes only the Mac
supervisor. Until the Windows launcher applies launchEnv the same way, a vendor account is Mac only (the Settings row
must say so or be hidden on Windows).

## Known untested guard
readAccount refuses a file whose vendor differs from its folder's name. With one vendor in the table no file can reach
that line (another vendor is refused first as unknown); a mutant removing it survives. Slice 2 (GLM) adds its test.

## Not in this slice
GLM and MiniMax rows (slices 2, 3). Usage or cost reading for vendor accounts (none exists for Qwen either).

## Slice 1a review 1 (2026-10-26 14:0x)
No blockers. FIXED: the add route now reclaims an abandoned claim (ported from the Qwen add); a key with a character
a header cannot carry is refused; the launch also removes CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY and
CLAUDE_CODE_OAUTH_TOKEN and sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1; the key's temp file is removed by the
EXIT trap; the inherited-variable test now asserts every set variable is a -e pair and every other is removed, and
says what the fake tmux cannot show; the 404 test uses a real Claude folder. Each fix red-checked with a mutant.
Accepted, not changed:
- redirect:'manual' has no test (every test uses setFetcher). Defence in depth: fetch drops Authorization on a
  cross-origin redirect anyway.
- If the launch-secret handoff cannot be built, the supervisor says so and launches without the key (the vendor then
  refuses the agent's first request). No leak; the same behaviour every other launch secret has.
- keyTail (the key's last four characters) is in /api/accounts, as for every other key account.
- Proxies (HTTPS_PROXY) are left alone: a person's proxy is theirs to set.

## Slice 1a review 2 (2026-10-26 14:1x)
No blockers. FIXED, each red-checked by a mutant unless said: vendor lookups by the table's own keys (a file naming
"constructor" took GET /api/accounts down for every provider; red); the reclaim renames the leftover aside, atomic with
one winner (the race is not reproducible in a test; the test pins that nothing visible is left); a vendor launch whose
key handoff cannot be built is refused (red); CLAUDE_CODE_SUBAGENT_MODEL set, ANTHROPIC_BETAS removed.
Kept and untestable: list() builds each row inside a try. With own-key lookups nothing in rowFor throws today, so a
mutant removing it survives; it stays as cheap defence for an endpoint every provider shares.
Accepted: the launch's variable list is fixed, not derived from Claude Code's documentation; a lockstep test keeps the
module and the supervisor in agreement, and the base URL is set explicitly whatever else is present.

## Slice 1a review 3 (2026-10-26 14:1x)
No blockers. FIXED: DeepSeek rows are kept out of GET /api/accounts in 1a (the page names an unknown provider as
Claude, acctProvider; red when put back); the reclaim checks the moved folder is still the old leftover and puts a
fresh claim back (a two-add race cannot be staged in a test); the supervisor checks the key itself is queued as a
launch secret; the add route refuses on Windows; the module comment names exactly which file cannot redirect the key.
SLICE 1b NOW OWNS: listing vendor rows in GET /api/accounts together with acctProvider (web/index.html) learning the
vendor, and a page test with a deepseek row.
Accepted: an agent's own work-folder settings can set Claude Code's environment (as for any agent); the agent already
holds its key, so that is no new exposure.

## Slice 1a review 4 (2026-10-26 14:2x)
No blockers. FIXED: GET /api/accounts no longer runs the hidden DeepSeek check (it sent keys to the vendor for rows
nobody sees; pinned that the vendor is not asked); a REAL-tmux test now proves the scrub end to end (a private tmux
server's global environment carries stray ANTHROPIC_* and Bedrock values; a stand-in claude records its environment:
the vendor's address, key and model arrive and none of the globals do; red with env -u removed, "tmux's global
ANTHROPIC_API_KEY reached the pane"); one link check in readAccount for every reader.
Accepted: the provider-switch list is fixed (recorded in review 2).

## Slice 1a review 5 (2026-10-26 14:2x): converged
No blockers, no warnings. Taken: the live cache keys on a hash (no second copy of the key in memory); the real-tmux
test removes its socket from where its server actually puts it. SLICE 1b ALSO OWNS: the setup guide's masked-by-value
set (engine/knownsecrets.js ACCOUNT_DIR) learning .kosmos-<vendor>- folders (Qwen's are missing from it too).
Accepted: a vendor model list that answers 200 without the table's model reads NONE (the add is refused with a clear
reason); the launch would fail on that model anyway, and a live run with a real key is still to be measured.

## Slice 1b map (branch anthrocompat-7206b, from 1a's head f0932ade30)
Mirror every Qwen ('alibaba') site with the vendor ('deepseek'), on the claude runner instead of codex:
- engine/create.js (about 25 sites): runnerFor(provider) ('deepseek' -> 'claude'), jobProvider (a claude job on a
  vendor home -> its vendor), agentProvider / the memo for claude agents too (0.023 ms per job read, measured),
  providerLabel, the create path (provider accepted; a named account required; Windows refused; models from the
  table; the profile records the account), the switch path (setProvider: onto and off a vendor account; "already runs
  on"), the move between vendor accounts, accountConnectable (live check through anthropiccompat, never the Claude
  sign-in), policyAllows, the model gate (the vendor's models only).
- server.js (about 6): accountForAgent marks a claude agent on a vendor home with provider 'deepseek'; isKeyedRow;
  the switch route; the roster's providerWord; GET /api/accounts lists and checks vendor rows (moved here from 1a).
- web/index.html (about 31): ACCT_KEYED_ROUTE (deepseek -> 'compat' routes), acctProvider, switchKeyedWord, the
  Add a provider menu (DeepSeek no longer "coming soon"; Mac only), the key-only connect form, the account row (no
  Sign in again; Check now through /compat/check; delete through /compat), the create form and switch picker (the
  vendor's models), PROVIDER_ORDER, providerOf, the agent-page provider word.
- engine/knownsecrets.js: mask .kosmos-<vendor>- endpoint files by value for the setup guide.
- engine/accountproblem.js: name the vendor and the key, never "Claude sign-in".
- Tests per site; design shots for the connect row (light/dark, desktop/phone); a browser check for the row.
GATE: 1b does not merge until the Claude Code premise is measured (asked of Splinter 14:2x).

## Slice 1b progress (2026-10-26 14:4x)
Done, each red-checked unless said: the default-off switch (enabled(): AGENT_WORKFORCE_COMPAT_PROVIDERS=1 or the
compat-providers-on marker; Mac only) gating the add route and GET /api/accounts/compat; provider identity
(providerRunner, providerLabel, jobProvider, agentProvider/claudeJobProvider); setProvider onto a vendor (gated, named
account, job on its folder, vendorAccount recorded); model change refused; Repair rebuilds on vendorAccount or refuses.
Not separately tested: the vendorAccount write BEFORE the job moves (the write after it records the same, so a mutant
removing the first survives); it guards a switch that fails mid-move, as Qwen's does. The account file was renamed to
kosmos-vendor.json in 1a (it collided with Qwen's marker).
Next: the create path (a new agent on DeepSeek), the page (Settings and setup rows, behind GET /api/accounts/compat),
the every-route-hidden test, knownsecrets, accountproblem wording, design shots and a browser check.

## Slice 1b review 1 (2026-10-26 15:1x)
No blockers. FIXED, each red-checked by a mutant: the check route obeys the switch (it sent a stored key to the vendor
with the switch off); Repair obeys the switch (it would rebuild and launch a vendor agent); setAccount keeps the
provider (a DeepSeek agent moves between DeepSeek accounts only, through setVendorAccount, mirroring setQwenAccount; a
Claude agent never lands on a vendor folder; both leave job and profile agreeing); compatAsk shares one request, reuses
an answer for 5 s, keeps the last answer on a failed ask, and puts the form away (clearing a pasted key) only on a
definite off.
Accepted, not changed:
- The failover (assigner providerOf) counts a DeepSeek agent as its own provider, so stalled work may go to an idle
  DeepSeek agent. That is how Qwen behaves, and it can only happen while the switch is on, which is after the
  measurement: the switch, not the failover, is the gate on unproven paths.
- "Name (optional)" in the form becomes the account's label (its folder name, cleaned), not a separate display name:
  the vendor module has no display name, and the label is what the row shows.

## Slice 1b review 2 (2026-10-26 15:3x)
BLOCKER FIXED: my vendor block in setProvider was inserted inside Qwen's account block, so a switch onto Qwen lost its
codex trust write and a switch onto DeepSeek wrote a codex config.toml into its (Claude Code) folder. Restored; pinned
by a test that is red with the misplacement put back. (The test also needs its own runner stub: setRunner(null) in an
earlier test turns dry-run back on, which skips the Qwen block silently.)
FIXED: the switch is a kill switch (launch-env refuses while off, so an agent made while it was on does not start with
its key; pinned in the supervisor and CLI tests); the dialog puts the DeepSeek form away on "Choose a provider" and on
close; "The DeepSeek account names the model"; vendorAccount written only when a vendor is involved.
DONE 15:4x (was open): the agent page treated a DeepSeek agent as
Claude (server accountForAgent provider, page providerOf, RUNNER.deepseek and CURRENT.account), so switching it back to
Claude from the page is disabled and the account picker lists Claude accounts (setAccount refuses them, safely).
Accepted: the hidden test's ON controls prove the gate opens, not that the full vendor path works (the engine tests do).

## Slice 1b review 3 (2026-10-26 15:4x): no blockers; two warnings, DECIDED, being fixed
1. The env-var half of the switch is broken by design: AGENT_WORKFORCE_COMPAT_PROVIDERS=1 reaches the board but never an
   agent's launchd job (the plist carries a fixed env), so create succeeds and launch-env then refuses every restart. My
   supervisor and CLI tests hid it by setting the variable in the child's env. DECISION: the MARKER is the only on-state
   (enabled() reads only `compat-providers-on` in the data folder; the variable is dropped). Tests write and remove the
   marker in THEIR data root (in-process: store.ROOT; supervisor/CLI children: pass AGENT_WORKFORCE_DATA=<sandbox> and
   write the marker there, never the real folder). Weakest premise: that an agent's launch resolves the same data folder
   as the board (the plist does not pass AGENT_WORKFORCE_DATA, so a board on a non-default data root would disagree;
   acceptable: the default data root is the only shipped one).
2. The agent detail panel treats a DeepSeek agent as Claude for its model picker and account-move list (dead-end
   controls; the engine refuses). Fix: treat account.provider === 'deepseek' like isQwen in paintDetailModel, add
   'deepseek' to acctMoveWorld's keyedProvider, the runsOnWord map and the model-name display.
Nits to take: import (worldstarts firstStartOfImport) refuses a vendor entry while off; the test message "the marker does
not turn it on" is inverted; one sentence that the variable is gone and the marker only turns it on.
