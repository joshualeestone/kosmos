# anthrocompat-7206: DeepSeek, GLM and MiniMax on the Claude runner (#7206)

Decided by Splinter (card comment 6423093110, 2026-10-26 12:40 CDT): one shared mechanism, slices DeepSeek, GLM,
MiniMax. This plan is slice 1: the mechanism and DeepSeek.

## Design call: a provider of its own, not a Claude key account
A survey of every path that judges a Claude account (card comment to follow) found 22 that misread a Claude key account
pointed at another vendor. The worst: adding the key checks it against api.anthropic.com/v1/models, which refuses a
DeepSeek key AND receives it. So a DeepSeek account is NOT a `~/.claude-<label>` key account. It is its own provider,
the way Qwen (#5977) is its own provider on the codex runner:

- An account is a folder `~/.kosmos-deepseek-<label>` holding `kosmos-endpoint.json` (mode 600):
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

## Windows launch: not in slice 1
engine/win32launch.js copies the board's whole environment into a Windows agent, and this slice changes only the Mac
supervisor. Until the Windows launcher applies launchEnv the same way, a vendor account is Mac only (the Settings row
must say so or be hidden on Windows).

## Known untested guard
readAccount refuses a file whose vendor differs from its folder's name. With one vendor in the table no file can reach
that line (another vendor is refused first as unknown); a mutant removing it survives. Slice 2 (GLM) adds its test.

## Not in this slice
GLM and MiniMax rows (slices 2, 3). Usage or cost reading for vendor accounts (none exists for Qwen either).
