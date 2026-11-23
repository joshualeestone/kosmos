# launchsecrets-8930: launch-secrets/ written into a source checkout (kosmos#8930)

## Measured
- The card's two named scripts (tools/test-supervisor-env.sh, tools/test-supervisor-codex-isolation-4592.sh) do NOT
  make the folder: run by hand in a fresh worktree both pass and leave nothing. Each runs a COPY of the supervisor in its
  own sandbox, and every call sets AGENT_WORKFORCE_DATA. Angel confirmed she had named them by reasoning; the folder
  appeared at 05:03 during a full validation run in her worktree.
- I ran each of the 30 node tests that spawn and name bin/agent-supervisor.sh, one at a time, checking the worktree root
  after each. Six leave an empty launch-secrets/ (mode 700) there, all passing: supervisor.adopt-grok-3953,
  adopt-linked-8724, adopt-runner-linked-8724, muse-launch-3939, provider-key-inject-3296, qwen-endpoint-5977. Each
  spawns the REAL supervisor with a fresh env that has AGENT_WORKFORCE_HOME but no AGENT_WORKFORCE_DATA, so
  ${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets is <checkout>/launch-secrets. The other 24 are clean.

## Changed
- .gitignore: a root-anchored /launch-secrets/, so a broad `git add` can never commit secrets a source-checkout board
  (with real values) or a test writes there.
- The six tests set AGENT_WORKFORCE_DATA to SANDBOX/data next to AGENT_WORKFORCE_HOME. Rerun one at a time: all pass
  (5, 2, 2, 4, 22, 5) and none leaves the folder.
- gitignore.launch-secrets-8930.test.js: the supervisor still writes to ${AGENT_WORKFORCE_DATA:-$_app}/launch-secrets
  (so the rule is still needed), the rule is present, and git ignores a secret there; CONTROLS: a note named after the
  folder, and the same name below engine/, are not ignored.

## Decided
- Not changing where a source-checkout board keeps launch secrets: the $_app fallback is read by the launch guard
  (#5516 KOSMOS_GUARD_CONFIG_DIRS) and the keychain tests (#4491); moving it is a design change for its own card.
- No source scan for future tests that omit the data root: it would match only spellings it knows. The .gitignore
  rule is the guard that holds whatever writes there.

Weakest premise: that these six are all the makers. They are all among the 30 node tests that spawn the supervisor by
name; a test that reaches it another way (through a helper) would not be in that list. The .gitignore rule covers it.

## Round 1 (opus, blind): no blocker; one should-fix and two nits taken
- Should-fix, MEASURED by the reviewer: the same six also wrote <checkout>/runs/<key>.log (record_run with no
  AGENT_WORKFORCE_DATA). *.log caught the logs but not a .log.tmp a killed trim leaves. Added a root /runs/ rule; the
  data-root fix already stops the writes. I removed the 16 leftover logs from my own before-fix sweep (all named for the
  six tests' agents, untracked). Re-swept all 30 supervisor-spawning tests one at a time for BOTH folders: all pass,
  none leaves either (this covers the 24 unchanged tests for runs/ too).
- Nit taken: the notes/launch-secrets.md control could not fail (a folder rule never matches a file). Replaced with a
  root FILE named launch-secrets (fails if the trailing slash is lost) and engine/runs/x.log.tmp (anchoring). With both
  rules made unanchored and slashless, the check goes red.
- Nit taken: the skip check reads a missing git's stdout safely.
- Unchanged: adding the data root moves the store root to SANDBOX/data/Kosmos, which none of the six reads a fixture
  from, so what each measures is the same (reasoned by the reviewer, one file measured).
