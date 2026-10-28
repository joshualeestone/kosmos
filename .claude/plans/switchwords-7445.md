# #7445: a switch between two non-Claude providers says the conversation does not come across

## Done when
1. A non-Claude to non-Claude switch (Codex to Gemini, Gemini to Grok, ...) says the conversation does not come across,
   in the dialog (web/index.html switchCrossesFamily / switchFamilyNote) and in the result sentence (engine/create.js
   switchCarryWords, via carryClaudeNotes / switchLosesConversation), and the dialog offers "Write handoff, then switch".
2. A switch where the conversation does come across keeps today's wording.
3. Tests for each pair kind, with controls.

## The design call: OpenAI <-> Qwen (one runner, Codex) KEEPS the conversation, so it keeps today's wording

Evidence, measured from the code:
- The account home is not where Codex keeps its conversations. bin/agent-supervisor.sh ~1016-1131 (#4592) gives every
  Codex agent a private, persistent runtime home, `codexruntime.forSession(SESSION)` = `<data>/codex-homes/<session>`
  (engine/codexruntime.js:17), and launches Codex with `CODEX_HOME` set to THAT (supervisor ~1131-1132). The account
  home (`~/.codex[-label]` for OpenAI, `~/.kosmos-qwen-<label>` for Qwen, qwenaccounts.js:7 and :41-44) only supplies
  the credential: `auth.json` is symlinked in for OpenAI, the endpoint arguments are read from it for Qwen and the
  stale `auth.json` link is removed (supervisor ~1041-1110).
- Codex keeps its sessions under `$CODEX_HOME/sessions` (codexsession.js:11, :55), and the board reads an agent's
  rollouts from the same private home (status.js ~6706, codexlimits.js:10). So the Qwen account's CODEX_HOME at
  create.js ~2671 (the job's account dir) differs from the OpenAI one, but the home Codex actually runs in and keeps
  its history in is the same folder before and after the switch.
- Round 3, said plainly: the Mac supervisor never resumes a Codex session, on any restart (there is no resume in
  bin/*.sh or in engine/codex*.js). Every restart of a Codex agent, a switch or not, starts a new Codex conversation.
  So OpenAI <-> Qwen keeping the old sentence rests on the shared private home (its past history stays in the one
  folder the board reads, exactly as after any restart), not on Codex resuming anything.
- So OpenAI <-> Qwen is the same as any restart on Codex: its past stays readable in the same place. The old sentence
  is true for it. switchLosesConversation returns false for it, carried stays null, and the old words stay.

Rejected: "the CODEX_HOME written into the job differs, so the conversation is lost". That reads the account home as the
runner's home, which #4592 stopped being true; it would warn on a switch that keeps everything.

Weakest point (traced in round 1): the call is true on a Mac only. On Windows win32launch.childEnv sets CODEX_HOME to
the ACCOUNT folder (engine/win32launch.js ~140, no private home), and win32codexsup keeps the codex thread id in memory
only (engine/win32codexsup.js:135, :194-206). So on Windows OpenAI <-> Qwen WOULD lose the conversation. It cannot
happen today: a switch to Qwen is refused on Windows (create.js REFUSE_QWEN_WIN32). The refusal and both twins now
carry a comment saying that lifting it needs a private Codex home on Windows first, or the rule becomes wrong there.

What would change my mind: the supervisor (or the Windows Codex path) giving each ACCOUNT its own runtime home instead
of each agent, or codexruntime.forSession taking the account into its key. Then OpenAI <-> Qwen loses it too, and
both twins drop their `alibaba -> openai` runner fold.

## Every pair kind and its wording

| From -> to | Loses the conversation? | Dialog (switchFamilyNote) | Result (switchCarryWords) |
|---|---|---|---|
| Claude -> non-Claude | yes (#7410) | notes copied into its folder | notes copied / why not |
| non-Claude -> Claude | yes (#7410) | "Any notes in its folder stay there; ..." (#7445 rounds 1-2) + "Any notes X saved for it stay behind with X." (round 4) | notes in its folder stay (if pointed) + "Any notes X saved for it stay behind with X." (round 4) |
| Claude <-> DeepSeek | yes (#7410) | notes stay behind with X | notes stay behind with X |
| non-Claude -> another non-Claude RUNNER (Codex/Qwen, Gemini, Grok, Antigravity, Muse) | **yes (#7445, new)** | "Its conversation does not come across: Y cannot read X's history. Any notes in its folder stay there; anything it only remembers from talking is lost. Any notes X saved for it stay behind with X." | "Y it is. It keeps its name, its instructions and its files, but its conversation does not come across: Y cannot read what it said on X." + "Anything it only remembered from talking is lost." (or, when its instructions point at notes an earlier switch left: "The notes in its folder stay there for it to read, and anything ...") + "Any notes X saved for it stay behind with X." |
| OpenAI <-> Qwen (both Codex) | no | '' (old sentence, Switch and restart, no handoff button) | "Y it is. Everything it knows and everything it has done stays." |
| same provider | not a switch (refused earlier) | '' | n/a |
| Claude -> non-Claude, and the carry THREW (round 2) | yes | as Claude -> non-Claude | conversation clause as above + "We could not check its saved notes; any it had are still where Claude keeps them, and anything it only remembered from talking is lost." (notes 'unchecked-error'; a throw on the other kinds keeps their own sentence) |

Shape: carryClaudeNotes returns, for the new case, the usual object with `notes: 'none-kept-by-runner'` and an extra
`between: true` field, set ONLY in that case, so every Claude case keeps its exact shape (the #7410 deepEqual tests
pass unchanged). Nothing is copied (there are no Claude notes to copy); the pointer step still runs, so notes an
earlier switch put in memory/claude-notes/ stay pointed at, and a pointer with nothing real behind it is taken out.

Round 4 correction: "none of these runners keeps notes of its own" was wrong. What the code shows, per runner:
- Gemini: its home is the ACCOUNT's, set as GEMINI_CLI_HOME (engine/accountenv.js:18-25), storage
  `<account>/.gemini` or `~/.gemini` for the default account (create.js geminiStorageHome / defaultAgentGeminiHome,
  ~3274-3290). There is no private per-agent Gemini home. Gemini CLI's save_memory tool writes its saved notes into
  that home (its GEMINI.md). That is Gemini CLI's own behaviour, not something this repo shows or switches off (no
  save_memory anywhere in engine/ or bin/), and I did not run Gemini here to measure it. So: notes kept PER ACCOUNT,
  shared with every agent on that account.
- Codex: Codex has a `memories` feature: orgchartcodex.js:48 lists it among the features switched off for that
  module's own one-shot reads, which shows the Codex Kosmos runs has it. Nothing switches it off for agents
  (bin/agent-supervisor.sh has no memories flag). If it writes, it writes into CODEX_HOME: the agent's private home on
  a Mac (per agent), the account folder on Windows (win32launch.js ~140). Whether it is on by default is not shown here.
- Grok (GROK_HOME = account folder, accountenv.js:26), Antigravity, Muse: nothing in this repo says whether they keep
  saved notes or where. Ambiguous.
Call: Kosmos copies none of these, so every switch LEAVING a runner that is not Claude Code (to another one, or to
Claude) says "Any notes X saved for it stay behind with X.", in the dialog and in the result. "Any", because whether
it saved any is not known; true for all five. OpenAI <-> Qwen is not a switch that loses anything (one runner, one
home) and says nothing new. Rejected: per-runner wording (only Gemini's location is clear, and only from Gemini CLI's
own behaviour); saying nothing (false for Gemini).

Twins: switchLosesConversation (engine) and switchCrossesFamily (page) each name the other; web.switchwords-7445
checks they agree on every provider pair the menu offers.

## Tests (controls)

- engine/create.switchwords-7445.test.js (11): 8 fail on the pre-change code 958acd2421 (every non-Claude runner pair,
  Codex -> Gemini state and sentence, pointer kept/taken out, end to end Claude -> OpenAI -> Gemini through setProvider,
  the carry-throws test, which also fails on 85337e54ef since round 2 asserts its whole sentence, the round 3
  provider-read-throws test, the round 4 runner-notes test, and the round 4 DeepSeek -> Claude read-throws test; the
  last three also fail on 7ffea55935, and both read-throws tests fail on b62e51d47b).
  3 pass on it by design: they are the keep-today's-wording controls (OpenAI <-> Qwen and the #7410 rule, the old
  sentence for carried null, the Claude cases' exact shape).
- web.switchwords-7445.test.js (6): 4 fail on the pre-change page (every non-Claude pair warns, the new note's words,
  and round 4's two: leaving a non-Claude runner for Claude, and the dialog and result saying the same runner-notes
  line for every pair leaving one; 3 fail on 7ffea55935). 2 pass on it: the keep-today's-dialog control, and the page/engine agreement check (both copies were wrong the same
  way before; it guards future drift).
- web.switch-family-7410.test.js: its OpenAI -> Gemini "no warning" assertions encoded the bug; replaced by OpenAI ->
  Qwen (6 tests, pass). Its back-to-Claude dialog assertion is updated deliberately to the round 1-2 words.
- tools/windows-tests.js ALSO gains the new engine test (it branches on a win32 host for its .cmd stand-ins).

## Log
- Round 0 (build): rule, carried state, sentence and dialog built; tests above; policy tests run (see commit).
- Round 1: no blockers. [WARNING] dialog said "Notes in its folder stay" to an agent with none while the result named none --> FIXED ("Any notes", between and to-Claude; #7410 test updated deliberately); [NIT] OpenAI <-> Qwen reasoning is Mac-only (Windows CODEX_HOME is the account folder) --> FIXED (comments at REFUSE_QWEN_WIN32 and both twins, weakest point rewritten); [NIT] forAgent(x) === forAgent(x) proved nothing --> FIXED (dropped, supervisor lines cited); [NIT] web test restated the alibaba fold --> FIXED (reads engine providerRunner); [NIT] missing space in `?'The notes` --> FIXED; [NIT] person-like fixture name in the new web test --> FIXED ('Helper'); [NIT] a carry that throws said everything stays --> FIXED (setProvider falls back to lostConversationCarried, the one base shape carryClaudeNotes also starts from; new test stubs backupsessions.ownedClaudeMemory to throw, red on the round 0 commit). An off-Claude throw reads "It had no saved notes to copy", which may be untrue; the conversation wording is right, the notes clause is the residual.
- Round 2: no blockers. [WARNING] a carry that threw on a switch off Claude said "It had no saved notes to copy", maybe untrue (review 3 rule) --> FIXED (notes 'unchecked-error', its own sentence; the whole sentence asserted, red on 85337e54ef); [NIT] dialog "stay there for it to read" promised a pointer that can fail --> FIXED ("Any notes in its folder stay there", between and to-Claude; both tests updated); [NIT] plan counts and quoted dialog words stale --> FIXED.
- Round 3: no blockers. [WARNING] the throw fallback read jobProvider again, so a throw in it (isQwenHome / vendorOfName) left carried null and "Everything it knows ... stays" --> FIXED (the provider it leaves is read once, floored at its runner's provider, and passed to both; new test stubs qwenaccounts.isQwenHome, red on b62e51d47b); [NIT] unchecked-error sentence true only because every copy step catches --> FIXED (comment); [NIT] plan did not say Codex is never resumed --> FIXED (evidence point); [NIT] source-regex check in the new web test --> FIXED (dropped; #7410 file has the behavioural test). server.js "could not start it again" branch left for the coordinator's own card.
- Round 4: no blockers. [WARNING] the round 3 floor made a throwing read on a DeepSeek agent look like Claude, so DeepSeek -> Claude said everything stays --> FIXED (setProvider reads the provider it leaves once, before anything is written, holds it as `leaving`, and the vendor/Qwen record and the carry and its fallback all use it; no second read, no floor; round 3 test now asserts no second read; new DeepSeek -> Claude test stubs anthropiccompat.vendorOfName; both red on b62e51d47b and 7ffea55935); [WARNING] "no runner here keeps notes of its own" was false for Gemini (save_memory into its account home) --> FIXED (every switch leaving a non-Claude runner says "Any notes X saved for it stay behind with X." in dialog and result, kept in lockstep and tested per pair; comment and Shape paragraph corrected with per-runner findings); [NIT] forAgent basename assertion --> FIXED (dropped, citation kept); [NIT] mem.files || [] --> FIXED; [NIT] crossesFamily header --> FIXED.
