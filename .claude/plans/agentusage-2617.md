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
- **Keying.** scanUsage splits the same deduplicated rows by each transcript's
  launch folder: the first `cwd` it records. A subagent transcript takes its
  parent session's launch folder. A row's own cwd moves when an agent `cd`s into
  a worktree, and a subagent starts wherever its parent stood, so keying per row
  or per subagent file would move that work out of the agent. Measured on this
  Mac: 6 of the 60 newest sessions carried more than one cwd, and 6 of 400
  subagent transcripts started somewhere other than their parent.
- **Freezing.** A completed day's folder split freezes to
  `${day}.folders.v1.json` beside the per-model `${day}.v2.json`. Each half is
  kept if already frozen and only the missing half is taken from a scan, so the
  per-model total is never re-derived (it could only shrink as transcripts are
  pruned) and a corrupt half does not discard a good one. First load after this
  ships rescans every day in the window once, to fill the folder files; a
  failing freeze is logged, because it would repeat that on every request.
- **Deterministic dedup.** Transcripts are read in sorted order, so a message
  that appears in two transcripts is credited to the same folder every scan.
- **Ownership.** `usage.byAgent()` gives a folder to the agent whose own folder
  it is, both sides compared after realpath, so a link and its target match.
  Subfolders are not claimed, so an agent recorded on a broad folder cannot
  absorb sessions launched beneath it. A folder two agents share goes to
  `shared`. Folders no agent owns go to `elsewhere`.
- **Gaps.** Checked per day against the per-model total: `unattributed` (a
  day's total beyond its folders) and `overcount` (the reverse), so they cannot
  cancel across days.
- **Route.** `/api/usage` adds `byAgent: { agents, elsewhere, shared,
  unattributed, overcount, rosterRead }`, or `null` if the split fails, so the
  per-model page cannot blank. The per-folder split is not sent: it names every
  project folder a session ran in. Folders are resolved with the async
  realpath (`usage.byAgentAsync`), so the split adds no synchronous filesystem
  call per folder on the server's thread. The roster is `register.known()` (agents with
  a profile, stopped ones included), folders `create.workerDir()`, names
  `register.shownName()` (now exported).

## Rejected
- Bumping the per-model file to v3 with an agent dimension: re-deriving past
  days from today's transcripts would silently shrink totals already shown.
- Keying on the `projects/<flattened>` directory name: two real paths can
  flatten to one name.
- Containment matching (a folder inside an agent's): a broad recorded folder
  would claim the person's own sessions.

## Weakest premise
An agent is its own folder, exactly. A session launched anywhere else, a
subfolder of its own included, counts as `elsewhere`. Two residuals: an agent
recorded on the home folder itself owns every session the person launches in
`~`, and an agent with no profile (admitted from tmux only) is not in the roster,
so its work is `elsewhere`. What would change my mind: a transcript field naming
the Kosmos agent.

## Tests
engine/usage.test.js and server.usage.test.js. Each guard below was perturbed
and went red: canonicalisation, first-sharer-wins, per-day gaps, forced model
rescan, folder-half keep, sort order, launch keying, subagent inheritance, and
the route's folder leak. The sort guard is a reversed-order perturbation: the
test pins "lexically first wins" and cannot see the sort deleted on APFS, which
already lists names in order.
