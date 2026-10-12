# #5957 slice 2: an agent whose working rules are far behind says so on its card

**Branch:** `rulesbehind-5957` · **Card:** kosmos#5957 (slice 2 of 3; slice 1 is dupname-5957, slice 3 the archive offer).

## The defect
Josh's Windows QA (10-12): a stale "Gemini" had working rules v15 against a current v28 and no community section, and
nothing on the board said so. The agent's own page has the update note (#539, `d-doctrine-note`) and Settings has the
fleet dialog, but both need the person to go looking; the card, where an agent is seen, says nothing.

## The rule
A card says it when the agent is FAR behind: its recorded rules version (`profile.doctrineVersion`) is at least
`RULES_FAR_BEHIND` (5) versions below the current one (`DOCTRINE_VERSION`), AND the agent's own page would offer the
update (doctrine.status says `refresh`, not `current`), AND the person has not said Not now to this version (the page
hides its note then too). The last two keep the card and the page agreeing: a person who edited the rules by hand reads
`current` there, and the card must not send them to an update the page will not offer.

## Where it is computed
`doctrine.status` reads and plans the whole instructions file, too heavy for every card on every poll. So the server
computes `rulesBehind` (a number, or null) per tied row, CACHED on (the instructions file's path, mtime and size,
the recorded version, Not now). An agent not far behind returns before touching any file; a far-behind one costs finding
its file (its job record) and one stat per poll, and the whole plan only when something changed. Null when the version is unknown (an agent made
before the version was recorded) or the file is missing: no claim from a missing record.

## What the card says
Through `stateReason`, on a CARD only and only when the agent is idle or stopped (the update restarts it, so a working
agent is not pointed at it mid-task), as the last rule (anything more urgent wins): "Its working rules are N versions behind. Open it
to update them." Plain words, no new badge or colour: the card's look is unchanged (the same posture as #5154 slice C).

## Not in this slice
A Settings list of every agent's rules version, last run and summary freshness (the card's last sentence) is a later
slice; this one makes the far-behind agent visible where agents are seen.

## Tests (as built)
- engine/doctrine.rulesbehind-5957.test.js: far behind and offered gives the number; the threshold edge (5 counts, 4 does
  not); no record and Not now give null; rules already current in the file give null (the card agrees with the page);
  the file changing, the profile alone changing and a later Not now each recompute; five unchanged polls read the file
  once; no file is null.
- engine/status.rulesbehind-5957.test.js: status.snapshot() carries it on a real fleet card (13, and null as control).
- server.world-offline-rows-1704.test.js: a STOPPED agent's offline row from /api/status carries it (13, null control).
- web.rulesbehind-5957.test.js: an idle or stopped CARD says it; the agent's own page header does not; working,
  needs-you, question, blocked, sign-in, connection, restarting and unknown do not; anything more urgent wins; only a
  whole positive number is said.
- Mutants, each red then restored on a clean tree: threshold off by one; the refresh condition dropped; the cache never
  invalidating; no cache at all; the card flag ignored; the row field dropped.
- The golden agent card (#2519) carries the new key; nearby files (279) green, 6130 pass.

## Review iterations 5 and 6
- The offline card and list row return early with no task line, so they draw the sentence themselves through the same
  helper (rulesBehindLine): the card as a small muted line in its own class (arules: .75rem, the second ink, like the
  community line; not atask, which #855's card-order guard keeps after the model line in card(); not ameta, which is
  the bold role line; not the padded note box, which would change the card's look), the list
  row in its existing ltask cell. Not in the "could not check" split (launchd says a process may be running).
- Project rooms' member rows do not carry it: a room is not where an agent's rules are kept up to date; the board's
  card and list are.
- Deferred: a per-name cache of the file path (each far-behind agent still finds its file and stats it per poll;
  measured cheap, and only far-behind agents pay), and a route-level assertion for live rows (the route spreads the
  snapshot row today; the golden card and the snapshot test cover the field).
- Review 7: the number is the recorded gap; a hand-edited later block can make it overstate (said in rulesBehind's
  comment). The phone's list view hides .ltask, so there only the grid card shows it, as every task-line sentence.
  An offline card does not consult stateReason, so it shows the note beside nothing more urgent (offline cards draw no
  crash sentence). Every test that lifts card() or lrow() was found by name and run (the first sweep missed two).
