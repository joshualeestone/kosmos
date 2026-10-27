# #7206 follow-up: DeepSeek named as DeepSeek where it shows (branch dsnames-7206)

Four of the shared plan's "before the switch is turned on" items (`.claude/plans/anthrocompat-7206.md`, slice 1b
reviews 4 and 5), plus what reviews of this branch found. Every site is unreachable while the switch is off.

## Decisions
- The rollup's MODEL_ID pattern is left alone: Qwen's model ids are not in it either, so a DeepSeek model goes as
  null like Qwen's. Widening that privacy-reviewed pattern is its own decision.
- The coordinator stores any provider name (relay org.rs checks only length; its own test sends "p"), so the board
  can send 'deepseek'.

## Review 1
- WARNING FIXED: a stopped DeepSeek agent whose job was lost went to the coordinator as anthropic (a guess). The
  rollup's providerOf reads a claude agent's vendor off its profile when it has no job, as the codex arm does for Qwen.
- WARNING FIXED: the world overview counted a DeepSeek agent under Claude; the route tags it, worldview keys its row,
  the page has the word.
- NIT RECORDED: accountproblem's DeepSeek sentence reads the job only (no profile fallback); a running card has a job.

## Review 2
- WARNING FIXED: a DeepSeek guide's fallback said "choose Sign in again"; it now says to check the key.
- NITS FIXED: MODEL_WORDS names DeepSeek; worldview keys any tagged word.
- Also fixed: round 1 broke web.qwen-agent-5977's exact-text pin on WV_PROVIDER (I had not run it).

## Review 3: CONVERGED, no blockers, no warnings
- NIT 1 RECORDED: the overview route reads the job only, so a jobless STOPPED DeepSeek agent is counted in Claude's
  `stopped` count (it cannot set paused or sign-in failed). Same gap as review 1's accountproblem nit.
- NIT 2 RECORDED, AND IT MATTERS FOR GLM AND MINIMAX: the page names DeepSeek by name in four places, while the
  engine goes by the vendor table: the guide fallback (`p === 'DeepSeek'`), the team map family word
  (`account.provider === 'deepseek'`), the account qualifier ternary, and WV_PROVIDER. Each needs touching per vendor
  until the board sends the vendor's kind and name instead (for example a `providerKind: 'key'` from guideFailure and a
  name on the overview row). Adding a vendor without them shows its raw id and tells its guide to sign in.
- NIT 3 TAKEN: a comment in the worldview test names the overview route as the only producer of providerWord.
- NIT 4 NOT TAKEN: "Its DeepSeek key" matches the Qwen branch's "Its Qwen endpoint".
