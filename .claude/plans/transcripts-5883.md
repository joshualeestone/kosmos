# transcripts-5883: each agent's transcripts from its OWN provider home (kosmos#5883 slice 1)

Stacked on backuptick-5535 (itself on the #5535 stack). Rebuilt from main when they land.

## What (as built; the first design read ONE home, review 1 replaced it)
engine/backuptick.js inputsHere gives sessionsFor, per agent, every home its sessions can be in, from its launch job,
each under a root named for its FOLDER (review 2): the agents' default Codex / Gemini home as `codex` / `gemini` for
every agent (review 3), a Codex agent's runtime home (#4592) as `codex-runtime`, and a named account's home as
`codex-a<8 hex of its true path>` / `gemini-a<...>` (review 4). engine/backupsessions.js sessionsFor takes them as
moreHomes, one root per folder per agent, each filtered to this agent's own files.
Claude needed nothing: status.configRoots already scans every ~/.claude* config root.

## Not in this slice (#5883 stays open)
Grok: backupsessions has no Grok reader. Needs where Grok keeps a session and how to tell this agent's apart.

## Rejected
- Passing every account home to sessionsFor and letting `belongs` filter: one root per home per agent, most empty, and
  a Codex runtime home is per agent anyway.

## Weakest premise
That the job's runner is the provider whose transcripts matter. An agent switched from Codex to Claude keeps its old
Codex rollouts in the default home, which every agent's `codex` root still reads (filtered to its own files), but its
old NAMED account and runtime homes are no longer named once the job says claude. Those rollouts stay on disk.

## Tests
backuptick-inputs.test.js: a Codex agent on a named account is backed up from that account's sessions (a real rollout,
the real sessionsFor), control with no job; a Gemini agent is given geminiStorageHome of its account, control.
## Mutants
Measured 20:34 CDT from `date`: T1 Codex home always the default: red. T2 Gemini home always the default: red. (T1's first run never happened: its pattern held '||', which my '|'-split broke; rerun alone.)

## Review 1 (opus, blind, on 68fa0b4a): one must-fix, three nits, all fixed
1. MUST-FIX: I copied the BOARD's choice of one Codex home, but the board needs the current session and a backup owes
   every one. Once a runtime home existed, the account or default home's earlier rollouts dropped out of new snapshots
   (the old code had read the default home). FIXED in backupsessions: sessionsFor takes moreHomes, each named by KIND so a
   name never moves between snapshots: codex (account home), codex-runtime, codex-default (beside a named account: what
   it kept before moving); gemini and gemini-default likewise. All filtered to this agent's own files. Stated residual:
   a move between two NAMED accounts leaves the first account's sessions unread (#5883 stays open for it and Grok).
2. FIXED: the Gemini test's control depended on a folder an earlier test made; it makes its own and passes alone.
3. FIXED: the runtime branch is tested (account, runtime and default homes, each one root with its own file).
4. FIXED: the input doc names the new call shape (dir, rootSegment, storedName).
Mutants (20:37 CDT from `date`): R1 no runtime home: red. R2 no default home: red. R3 the one-folder check in
sessionsFor removed: SURVIVES, equivalent today: inputsHere never passes a home that resolves to one already read (the
default is added only beside a named account).

## Review 2 (sonnet, blind, on 205ef933): one must-fix, two nits, all fixed
1. MUST-FIX: my "a name never moves between snapshots" was false. `codex` meant "the account home", so the folder behind
   it changed when the agent changed account, and the same rollouts were stored again under another name. FIXED: each
   root is named for its FOLDER, never its role: the default home is `codex` / `gemini` (its name before this change),
   the runtime home `codex-runtime`, a named account `codex-a<8 hex of its path>` / `gemini-a<...>`. Test: one folder
   keeps one name across an account move, with a control that both homes are read after it.
2. FIXED: backupsessions had no moreHomes test. Added: a bad tag, a home equal to the primary, an unknown provider, a
   linked sessions folder (refused, never followed). My first bad-tag case reused a folder the one-folder rule already
   dropped, so the tag rule never ran (R4 survived); the bad tag now has a folder of its own.
3. FIXED: a Gemini agent's default arm is create.geminiStorageHome(null) (the board reader's), the same on both paths.
Mutants (20:40 CDT from `date`): R3 one-folder check removed: red. R4 any tag accepted: red (after the fix
above). R5 the account home named codex: red. R6 a role tag (-default) instead of the folder's: red.

## Review 3 (opus, blind, on 878f0c45): no must-fix; it ran 40,000 generated names through rootNameProblem (all pass).
1. FIXED: `codex` / `gemini` named the agents' default home for Codex/Gemini agents but the BOARD's CODEX_HOME /
   GEMINI_CLI_HOME for the rest, so the folder behind the name moved with the runner. Now the agents' default
   (create.defaultAgentCodexHome / geminiStorageHome(null)) for every agent; the board's homes stay protected. Test sets
   CODEX_HOME so the two really differ (it ran, not skipped). Mutant Q1 (the board's home again) red.
2. FIXED, NOT TESTED: the runtime lookup and the named-account push each have their own try, so a throw in one cannot
   drop the other. No test makes codexruntime.forAgent throw.
3. NOTED on #5883: Antigravity agents (Gemini on a Google subscription) are not read here either, as before.
Tests 37 -> 38.

## Review 4 (sonnet, blind, on 588b3d6e): no must-fix; two nits, both fixed
1. FIXED: the review-3 test changed the environment before its try, so a throw there would leak into later tests.
2. FIXED: acctTag hashed the path as spelled; one account folder named through a link or another spelling got two
   names and its rollouts were stored twice. Now hashed on the true path. Test with a control (another folder, another
   name). Mutant U1 (hash the spelling again, 20:43 CDT from `date`): red. Tests 38 -> 39.

## Review 5 (opus, blind, on b1fc81d9): no must-fix; three documentation nits, all fixed
The header's "data root not covered" now names its one exception (each Codex agent's runtime rollouts); its gap list
names all three (Grok, Antigravity, a move between named accounts); the plan's What and Weakest premise describe the
current design, not the first one.

## Review 6 (sonnet, blind, on 2bc24b09): NO NEW ISSUES. Converged at 6.
