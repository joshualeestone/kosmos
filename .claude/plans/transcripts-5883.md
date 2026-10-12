# transcripts-5883: each agent's transcripts from its OWN provider home (kosmos#5883 slice 1)

Stacked on backuptick-5535 (itself on the #5535 stack). Rebuilt from main when they land.

## What
engine/backuptick.js inputsHere: sessionsFor is given, per agent, the Codex and Gemini homes its own launch job names,
by the helpers the status reader uses (status.readCodexSession / readGeminiSession), so a backup and the board can never
read different folders:
- Codex: the agent's private runtime home (codexruntime.forAgent, #4592) when it exists, else its account home
  (job.configDir = CODEX_HOME), else create.defaultAgentCodexHome().
- Gemini: create.geminiStorageHome(job.configDir) (<account>/.gemini, or the default).
- Any other agent, or a job that cannot be read: the defaults, as before.
Claude needed nothing: status.configRoots already scans every ~/.claude* config root.

## Not in this slice (#5883 stays open)
Grok: backupsessions has no Grok reader. Needs where Grok keeps a session and how to tell this agent's apart.

## Rejected
- Passing every account home to sessionsFor and letting `belongs` filter: one root per home per agent, most empty, and
  a Codex runtime home is per agent anyway.

## Weakest premise
That the job's runner is the provider whose transcripts matter. An agent switched from Codex to Claude keeps its old
Codex rollouts; after the switch they are no longer read here (its Claude ones are). Those rollouts stay on disk.

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
