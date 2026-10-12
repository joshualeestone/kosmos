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
