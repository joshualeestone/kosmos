# crashloop-5154: a crash loop is told, not hidden (bounded retries, slice A)

Card: joshualeestone/kosmos#5154. LOE posted 10:5x; Splinter 10:46: go on slice A, build today; ships in 0.7.22
only if it clears review, full validation and the browser checks before Baron pins.

## What I found first (it changed the slice)
- The connection self-heal giving up is ALREADY surfaced: `needsPerson` counts `reconnect.phase === 'gave_up'`, the
  board's Issue tile and filter include it, and the card says "Kosmos tried a few times and stopped". So slice A is the
  crash loop alone. My LOE comment listed both; corrected on the card.
- The supervisor (bin/agent-supervisor.sh) waits on the agent's tmux session and exits when it ends; launchd
  (KeepAlive, ThrottleInterval 30 s) relaunches it. A crash loop is a run of short-lived sessions, uncounted, and
  between crashes the card can read working or idle.

## Change
- **bin/agent-supervisor.sh `record_run`:** "start <epoch>" just before the watch loop when this run launched the
  session (not an adopt), and "end <epoch>" in the confirmed-gone branch. Written to `<store root>/runs/<safeKey>.log`:
  `$AGENT_WORKFORCE_DATA/Kosmos/runs` when the env is set, else this install's folder (which is the store's default
  root). Kept to 40 lines. Best-effort; set -u safe.
- **engine/crashloop.js:** `assess(runs, now, deliberateAt)` is pure. A loop is LOOP_RUNS (3) runs, each ENDED within
  SHORT_RUN_MS (2 min) of starting, all ending inside WINDOW_MS (30 min), and the newest run not long-lived. A run a
  deliberate Kosmos restart ended (engine/disruption.js startedAt inside the run, plus 10 s) is not counted. `read()`
  never throws.
- **server.js:** `/api/status` rows (named ours) and the offline rows carry `crashLoop`; so does `safeRoster`, so the
  project routes agree. A 60 s tick sends ONE needs_you phone push per loop episode (told when it starts looping,
  forgotten when it stops; phonenotify's own cooldown is a second guard), and logs "crash-loop: ..." each time.
- **engine/status.js:** `needsPerson` counts a loop. `snapshot()` states `crashLoop: null` on every row (it cannot know
  runs), so strict fixtures see a field every producer emits.
- **web/index.html:**
  - `agentNeedsAttention` (the page's copy of needsPerson) counts it;
  - `cardStOf` gives it the needs-you look;
  - `stateCopyOf` names it "Keeps stopping";
  - `stateReason` says "Kosmos has restarted it N times in the last half hour, and each time it stopped within a
    couple of minutes. Open it to see what it last showed, or stop it until you can look."
  All placed first, since the momentary state is what hid the loop.

## The threshold, and why (Splinter: "the threshold has to be right")
3 runs, each ending on its own within 2 minutes, inside 30 minutes. With launchd's 30 s throttle, a hard crash loop
trips it in about 2 to 3 minutes. Not counted: a person stopping a working agent (its run lived past 2 minutes), an
update or restart Kosmos made (the disruption record), anything older than 30 minutes. It clears once a run lives past
2 minutes.
UNMEASURED: no supervisor history survived to tune against (its log is trimmed at every start, on Agent1s and
Mortals alike). Hence the log line on every detection: the first real boards give the numbers.
Known edge that can still false-alarm: a person restarting the same agent 3 times within 30 minutes, each time within
2 minutes of the last start, if the restarts did not go through Kosmos's own restart path (which writes the disruption
record). Rare; it shows on the card and pushes once.

## Rejected
- A push for every detection (the 60 s tick would repeat): one per episode.
- Changing the card's STATE to needs_you: chat delivery refuses to type into a needs_you pane (it might answer a
  question), and a person must still be able to type to a looping agent. A separate field changes no state semantics.
- Windows: the supervisor is the Mac's. A Windows crash loop needs its own spec for Homer (said on the card).

## Weakest premise
That the 3-in-30 / 2-minute numbers separate a real loop from a healthy agent on real boards. Measured nowhere yet.

## Tests
engine/crashloop-5154.test.js (11):
- the rule's positive arm;
- each false-alarm shape;
- the deliberate-restart exclusion (with a control);
- parse;
- read from the store;
- the supervisor's real `record_run` run by bash (key rule matches store.safeKey, kept to 40);
- END TO END, the real writer's file read by the engine;
- the start/end hook placement;
- needsPerson and agentNeedsAttention agree on a table;
- the card sentence placement.
Mutations, each red: root without /Kosmos (2), no deliberate exclusion (1), needsPerson ignores it (1), recovered run
ignored (1).
Caught by existing tests on the way: web.not-running's strict proxy (offline rows lacked the field), web.pill-remembered
(snapshot rows lacked it), render-talk-goldencard (the snapshot's key set changed: re-captured with the tool).
97 related test files 2197 pass, then 73 files 1961 pass after the look and label change.
Browser: render-connlost-reconnect-3410 gains a crash-loop phase (the word, the look, the sentence, the members list).
