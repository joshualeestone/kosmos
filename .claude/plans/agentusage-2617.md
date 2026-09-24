# Token Usage per agent, engine and route slice (kosmos#2617)

Josh (#2617): the Token Usage page used to be graphical and "broken down by
per-agent token usage". The graphical view is restored and served (#2638, then
the #2840 value view, in 0.6.90). The per-agent split was deferred as "engine
work": engine/usage.js totals by model per day and nothing else.

## Measured first
Git history has no per-agent usage view to restore: `git log -S` over web/,
server.js and engine/ for usage-by-agent shapes returns nothing, and
engine/usage.js has keyed by model alone since #854. So this is new work, not a
restore.

## Call (this PR: engine + route; the page is the next PR, for Mona's review)
- scanUsage splits the same deduplicated rows by the folder the session ran in
  (`row.cwd`), the same key status.js uses to find an agent's transcripts.
- A completed day's folder split freezes to `${day}.folders.v1.json` beside the
  per-model `${day}.v2.json`. The per-model file stays authoritative and is never
  rewritten: a day frozen before this shipped keeps its total, and only its
  folder split is filled from the transcripts still on disk.
- `usage.byAgent()` (pure) assigns each folder to the agent whose folder
  contains it, deepest first and separator-bounded, so `/w/annex` is not
  `/w/ann`'s. Folders no agent owns go to `elsewhere`. What the per-model total
  holds beyond every counted folder is `unattributed` (transcripts pruned after
  the total froze), stated rather than dropped.
- `/api/usage` adds `byAgent: { agents, elsewhere, unattributed, rosterRead }`,
  the roster from `register.known()` (stopped agents included), folders from
  `create.workerDir()`, names from `register.shownName()` (now exported).

## Rejected
- Bumping the per-model file to v3 with an agent dimension: re-deriving past
  days from today's transcripts would silently shrink totals already shown.
- Keying on the `projects/<flattened>` directory name: two real paths can
  flatten to one name; the recorded cwd, canonicalised, cannot.

## Weakest premise
An agent is its folder. A session an agent ran from a different folder (a
project checkout it `cd`'d into at launch) counts as `elsewhere`, not as that
agent. What would change my mind: a transcript field naming the Kosmos agent.

## Tests
- engine/usage.test.js: folder split dedups like the model total and agrees
  with it; byAgent ownership (subfolder, prefix-sharing non-agent sibling,
  no-folder agent, ordering, elsewhere, unattributed); a frozen per-model day is
  not rewritten while its folder split is filled and frozen. Perturbed: dropping
  the path separator and forcing a model rescan each go red.
- server.usage.test.js: the route returns byAgent with the agent's tokens and
  the non-agent session in elsewhere.
