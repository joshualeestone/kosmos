# receipt-5153: a change receipt on a closed task (slice 1: Claude agents)

Card: kosmos#5153. Routed by Splinter 2026-10-03 15:08 ("take the next step in the same spirit as Josh's 'start and see
how far we get'"); merges after Monday. LOE on the card: slice 1 of 4.

## What finished looks like
A closed task's page shows a receipt under its activity: for each agent that held a part, which files it created or
edited, how many shell commands it ran (a COUNT, never their text), the tokens it used per model and an "at API prices"
figure (unpriced models named, never guessed), and how many times the task was put back or handed on. No undo: it names
the agent's folder and the files so a person knows where to look. An agent on another provider says the receipt is not
available for that provider yet.

## Scope held back for Josh (needs-decision stays on the card)
- Listing commands' text (crosses the report hook's no-logging rule): count only.
- Undo: none.

## Design calls
- Computed when the task page asks, from the task's own activity and the agent's transcripts, NOT in the close path
  (the LOE proposed a record at close). The close path a new user touches on day one is unchanged. Kept on disk once the
  task has been closed a few minutes (transcripts are flushed), keyed by its close time, so it is read once.
- Each agent's work is counted only while it held a part: from being given it (created with it, assigned it, a part
  added for it) to the part being handed on, closed, or the task closed; put back reopens it. Overlapping holds merge.
  The receipt says this basis: work on other tasks inside that time is included.
- Transcripts: the agent's Claude folder(s) as status.js finds them (configRoots x flatten(canonical dir) and the raw
  spelling), subagent transcripts included; a file last written before the first hold is not read. Tokens: four
  buckets per model, one message counted once (message id), synthetic rows skipped (usage.js's rules). Files: Edit,
  Write, MultiEdit file_path and NotebookEdit notebook_path; commands: Bash tool calls; each tool call once by its id.
- Dollars on the page from usageApiCost (the one price table), labelled "at API prices".
- Provider from create.recordedRunner; anything not Claude says "not available for <provider> yet".

## Weakest premise
That an agent's Claude transcripts for a task sit in its own folder's project directory. An agent that ran its session
from another folder (a worktree launched by hand) is not seen, and the receipt then reads "no Claude Code activity found
in this time", never a zero presented as fact.
