# whatsnew-7411: release notes an agent can read for every version, and which fixes need a restart (kosmos#7411)

## Ask
An outside user (about 35 agents): no way for an agent to read what changed in an update (web/whats-new.json covers the
latest list only), and fixes that take effect only when an agent starts looked broken until a manual restart.

## Decision
- The source is release/whats-new-pool.json (every highlight with the version it shipped in). The app never ships the
  pool: it holds `held` items (features held or dropped) and pending ones newer than a build. engine/releasenotes.js
  notesFor(pool, version, platform) keeps only what that build contains (not held, `since` at or before it, and for
  its platform: an item tagged mac or windows is for those only, so a Linux build drops the Mac-only notes) and only
  the readers' fields (version, title, line, platforms, restart).
- Every build (Mac bundle, Linux, Windows) writes app/release-notes.json with `whats-new-pool.js notes <version>
  --platform=<its own>`, right after checking its version, so it is in the signed manifest. A source checkout derives
  the same list. The Mac builder checks it has node first (it had no node dependency before).
- A pool item may carry `restart: "agents"` (readPool refuses any other value): a running agent keeps the old
  behaviour until it restarts. Set beside the item's words by whoever writes the fix.
- `kosmos whats-new [--since <version>] [--json]`, on the Mac and Linux CLI and the Windows one alike: both call
  releasenotes.render(), so they cannot drift. The notes newer than --since (default: the newest version's own notes,
  whatever number came before it; Mac and Windows share one numbering), one block per version, a restart line where
  needed; --json for agents; errors on stderr.

Rejected: shipping the pool (leaks held features); parsing versions.html (the site's prose); a commit changelog.

Not in this branch (the card's step 4): after an update, the board naming running agents that started before it when
an item since the previous version needs a restart. Separate, after this.

Weakest premise: that highlights are the right granularity; a restart-needing fix too small to be a highlight goes
unsaid. Remedy if it matters: pool entries never shown in What's New but listed here.

## Tests
engine/releasenotes.test.js (12): the filter (held and future excluded, with a control), since and its refusal, the
format and its single restart line, the built file vs the source fallback, the pool's restart check and the `notes`
command, the real pool ships no held item, all three builds call `notes` after their version and none copies the
pool, the CLI end to end (text, --json, a bad --since), the platform filter, the newest-version
default (an x.y.0 too), render's error sentence, and the Windows CLI. Mutants (no held filter; one build's call removed) red.
Guards run by hand: windows-kosmos-cli-verbs-parity, engine.reachable, windows-coupling-audit-1732, windows-tests-1777, every-test-runs, What's New tools.
