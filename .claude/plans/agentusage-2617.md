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
  (`row.cwd`).
- A completed day's folder split freezes to `${day}.folders.v1.json` beside the
  per-model `${day}.v2.json`. The per-model file stays authoritative and is never
  rewritten: a day frozen before this shipped keeps its total, and only its
  folder split is filled from the transcripts still on disk.
- `usage.byAgent()` (pure) gives a folder to the agent whose own folder it is,
  compared after realpath: the exact match status.js requires. Subfolders are
  not claimed, so an agent recorded on a broad folder (`~`) cannot absorb the
  person's own sessions. A folder two agents share goes to `shared`, not to
  whichever name sorts first. Folders no agent owns go to `elsewhere`.
- Checked per day against the per-model total: `unattributed` (a day's total
  beyond its folders, from transcripts pruned after the total froze) and
  `overcount` (the reverse) are both reported, so they cannot cancel.
- `/api/usage` adds `byAgent: { agents, elsewhere, shared, unattributed,
  overcount, rosterRead }`, or `null` if the split fails (the per-model page
  must not blank). The per-folder split is NOT sent: it names every folder a
  session ran in. Folders, the roster
  come from `register.known()` (stopped agents included), folders from
  `create.workerDir()`, names from `register.shownName()` (now exported).

## Rejected
- Bumping the per-model file to v3 with an agent dimension: re-deriving past
  days from today's transcripts would silently shrink totals already shown.
- Keying on the `projects/<flattened>` directory name: two real paths can
  flatten to one name; the recorded cwd, canonicalised, cannot.

## Weakest premise
An agent is its own folder, exactly. A session an agent ran from a different
folder, including a subfolder of its own, counts as `elsewhere`, not as that
agent. Exact matching was chosen over containment so a broad recorded folder
cannot claim the person's sessions. What would change my mind: a transcript field naming the Kosmos agent.

## Tests
- engine/usage.test.js: folder split dedups like the model total and agrees
  with it; byAgent ownership (subfolder and prefix sibling not claimed, shared
  folder, no-folder agent, ordering, elsewhere, unattributed); a short day and
  an over day do not cancel; a folder recorded through a symlink matches the
  real path; a frozen per-model day is not rewritten while its folder split is
  filled and frozen. Perturbed red: identity canonicalisation, first-sharer
  wins, net-over-window gap, forced model rescan.
- server.usage.test.js: the route returns byAgent with the agent's tokens and
  the non-agent session in elsewhere, and no folder path leaves (perturbed red
  by sending the whole result).
