# Plan: Settings > Automation, product heartbeat with correct working/stopped detection (kosmos#1722)

Written at ctx 95% as the build spec, so a post-compaction me (or a restart) builds
from this rather than re-deriving. Card #1722, claimed by Baron Draxum. Companions:
#1723 (recommender, research-first), #1724 (Mona took instead), both claimed.

## The corrected scope (Splinter 2026-08-31 23:05 -- do NOT build the original bullet)

Josh (22:37): a Settings control to turn the heartbeat on/off and make its interval
adjustable. The heartbeat "checks which agents are working and prompts to chase anyone
stopped."

🛑 It is a PRODUCT feature over the USER's own agents, NOT a control over the dev-fleet
job. Hard constraints:
- MUST NOT read or write `~/.claude/bin`, our launchd jobs, or any dev-fleet infra.
- Do NOT test against the live fleet heartbeat (`com.stonesyndicate.builder-progress`,
  StartInterval 1020) -- it is keeping the overnight run moving; touching it is a live hazard.
- The fleet job is the REFERENCE implementation, not the thing Settings controls.

## Three parts, in build order (Mona Lisa's ordering: detection is the expensive half)

### 1. Agent working/stopped DETECTION (the hard, historically-buggy half) -- BUILD FIRST

Port the two-arm UNION design from the reference `~/.claude/bin/builder-progress-check.sh`
into the product (agent-workforce). An agent is WORKING if EITHER arm fires; STOPPED only
if NEITHER does (bias toward working: a false stop is a harmless nudge; a genuinely stopped
agent fires neither and is caught).

- Arm A -- SPINNER regex on the pane capture. The live Claude spinner carries an elapsed
  timer AND a streaming token count (e.g. `(12s · 1.2k tokens)` and a LONGER variant).
  🛑 Match the elapsed-timer/spinner form ONLY. Do NOT use `ctx [0-9]+%.*active` -- that
  matched the IDLE status footer `... ctx 83%        /rc active` and scored stopped agents
  as working (3 of 6 panes, the fleet bug). 🛑 Do NOT anchor on `tokens)` -- the spinner has
  a longer variant; the anchored form false-passed a 12-pane control as 3/9.
- Arm B -- short PANE DELTA. Capture the pane, wait ~6s, capture again; changed => working.
  (Use `-e` capture per the ghost-text bulletin if reading status content; a busy composer /
  wrapped line can false-read, so key on a short distinctive token, not a phrase.)
- REJECT the file-mtime arm: it read 0 for all known-working panes and would report the
  whole fleet idle.
- VALIDATE like the reference: against known-truth agent states, with a negative control
  (a pane that cannot exist -> stopped) and a positive control (a synthetic working pane ->
  working). This validation is the whole point of the card -- a toggle over a detector that
  cannot tell working from stopped is a control for a lie.

Where in the product: the product tracks the user's agents (server.js; panes via tmux).
The detection reads the user's agent panes ONLY -- never the dev-fleet panes. Find how the
product enumerates the user's agents/panes (server.js agent registry + AGENT_WORKFORCE_TMUX_BIN
seam used by tests, e.g. test-support/fake-tmux.sh) and detect over THAT set.

### 2. Periodic check-and-notify in the PRODUCT (does not exist today)

`HEARTBEAT_MS` (engine/connect.js:286, 5 min) is LIVENESS (a record stamped while alive),
NOT a periodic check-and-notify. Build the new periodic job: on an interval, run the
detection over the user's agents and notify about anyone stopped. It lives in the product's
own runtime (the board/server), configurable, and installs/controls its OWN schedule -- NOT
a `~/.claude` launchd job. Confirm how the product already schedules periodic work (poll
loops in server.js / the board) and follow that, machine-scoped (interval belongs to the
machine, not a project).

### 3. Settings > Automation UI (the small part)

web/index.html Settings (`#pj-settings-view`, the Settings list ~line 407). New "Automation"
section, first control the heartbeat:
- On/off toggle, distinct from the interval.
- Interval selector: Off / 5 min / 10 min / 17 min (current default) / 60 min.
- Show the interval actually IN FORCE, read from the live product job, not the stored pref,
  so a failed write is visible rather than silent.

## Testing (must not touch the live fleet heartbeat)

- Unit-test the detector with SYNTHETIC pane captures: a spinner string -> working; the idle
  `/rc active` footer -> stopped (the exact regression); a pane delta -> working; a static
  pane -> stopped. Negative/positive controls. This is red-capable for the historical bug.
- Test the Settings row drives the product interval and displays the LIVE value.
- NEVER read/spawn the real dev-fleet job or panes.

## Status / next actions for a post-compaction me

- Worktree: ~/work/agent-workforce-heartbeat-automation-1722 (branch heartbeat-automation-1722).
- Claimed on the card. Handoff at ~/.cache/claude-handoffs/BaronDraxum-2026-08-31-night.md.
- START with part 1 (detection) + its synthetic-pane test. Then part 2, then part 3.
- Run the FULL `yarn test` before any merge (a UI/detection change can break pinned tests).
- Challenge-loop + proof + PR. This is a product feature (not high-blast-radius infra), so it
  can merge on the Kosmos beta norm once green -- but confirm with Splinter given its size.

## INTEGRATION POINT (found 23:14, before compaction) -- start the detector HERE

The product ALREADY enumerates the user's agents and reads their pane content:
- `safeRoster()` in server.js (~4866, 5005) = one `list-panes` + a `capture-pane` PER agent.
- `snapshot()` (server.js ~6582) fans out a real tmux `capture-pane` over the roster.
- Tests drive pane content via the `AGENT_WORKFORCE_FAKE_PANES` / `test-support/fake-tmux.sh`
  seam (see server.connections-refresh-1649.test.js:71, server.projects.test.js:1025), and
  `AGENT_WORKFORCE_FAKE_SCREEN` for a pane's screen. This is the synthetic-pane seam for the
  detector's unit tests -- NO real tmux, NO dev-fleet panes.

⇒ The detector does NOT build pane-reading. It is a pure classifier over a pane capture
string, applied to what safeRoster/snapshot already capture:
- `detectWorking(paneText)` -- Arm A: the spinner regex (elapsed timer + token count form
  ONLY; must NOT match `... /rc active` idle footer; must NOT anchor on `tokens)`).
- Arm B (pane delta) needs TWO captures ~6s apart, so it lives in the periodic job (part 2),
  not the pure classifier: capture, wait, capture, changed => working. The classifier (Arm A)
  is pure and unit-testable now.

NEXT CONCRETE STEP for a post-compaction me:
1. Write the pure `detectWorking(paneText)` (Arm A spinner regex) as a small module, with a
   unit test: a spinner string -> working; the `barondraxum · Opus 4.8 · ctx 83%   /rc active`
   idle footer -> stopped (the exact regression, red-capable); a plain prompt -> stopped.
2. Then the periodic job (part 2) composes Arm A over the roster + Arm B (the 6s delta) and
   notifies about stopped agents, on the configurable interval, machine-scoped, in the
   product runtime -- NOT ~/.claude, NOT launchd of the dev fleet.
3. Then Settings > Automation (part 3).

## PROGRESS (23:16)
- Part 1 Arm A DONE + committed: engine/agent-activity.js (spinnerActive, SPINNER_RE) + engine/agent-activity.test.js (4 cases, red-capable vs the idle-footer regression). All pass, 0 em dashes.
- NEXT: Arm B (pane delta) + the periodic check-and-notify job (part 2) composing Arm A over safeRoster/snapshot + the 6s delta, machine-scoped, in the product runtime (NOT ~/.claude/launchd). Then Settings > Automation (part 3). Wire agent-activity.test.js into the suite. Full yarn test before merge.

## RETRACTION + CORRECTED DESIGN (23:40) -- READ THIS OVER THE PART-1 ABOVE

🛑 Arm A/Arm B port (commit 5cfcaa00) is RETRACTED (073415fe removed the files).
The product ALREADY detects each agent's state. Do NOT build a new detector.

- `classify(pane, paneText)` at engine/status.js:1927 is the board's per-agent
  detector: STATE.WORKING / IDLE / STOPPED / NEEDS_YOU / RATE_LIMITED / AUTH_FAILED,
  keyed on the Braille SPINNER in the pane TITLE + per-runner "esc to interrupt"
  chrome + marker lists. It never had the idle-footer bug -- that was the FLEET
  shell script builder-progress-check.sh, fixed separately in #1657.
- `snapshot()` stamps every board agent with that classified `state`.
  `safeRoster()` (server.js:684) = snapshot().agents minus removed agents.
- Composing this is NOT "a control for a lie": classify() is the detector the
  whole product already trusts. A SECOND spinner classifier IS the "two
  derivations of the fleet" habit safeRoster's comment calls the worst here.

### CORRECTED build (three parts):

1. DETECTION = compose the existing classification. The heartbeat reads
   snapshot()/safeRoster() and each agent's `state`. NO new detector.
   PRODUCT DECISION to settle: which states does "chase anyone stopped" cover?
   Candidates: STOPPED (Claude process gone) and IDLE (Claude up, sat at prompt
   having finished) -- both are "not working and not waiting on YOU", which is
   the "finished a step, never started the next" shape. NOT needs_you (that is
   the person's to act on and already has its own notify path). NOT working.
   Confidence-gated: only chase a state at STRUCTURED/SCRAPED confidence, never
   UNKNOWN (fail toward not-nagging). This is the ONE genuinely new judgement.

2. PERIODIC CHECK-AND-NOTIFY (new). Compose over the notify seam that exists:
   - engine/notify.js `notify.happened({kind,...})` is the off-by-default
     outbound ping, closed KINDS list {posted, replied, needs_you}. ADD a kind
     (e.g. 'stalled') so the payload's kind stays a closed list.
   - Fire once per stall EDGE (a working->stopped/idle transition), not every
     tick, or a stopped agent pings forever. Reuse the wouldping.js edge shape
     (it already suppresses re-fires: was===X returns false).
   - A new interval loop in the product runtime (server.js has setInterval
     precedent at 7381/7390), machine-scoped, whose period is the Settings value.
     NOT a ~/.claude launchd job. Off unless the Settings toggle is on.

3. SETTINGS > AUTOMATION UI (web/index.html). On/off + interval Off/5/10/17/60.
   Show the interval IN FORCE (read from the live job), not just the stored pref.

### Testing
- Unit-test the SWEEP over synthetic snapshot rows (fake classify states):
  a working->stopped edge fires once; a still-stopped agent does not re-fire;
  an UNKNOWN agent is never chased; toggle off => no fire. Use the notify
  sender-injection seam (engine/notify.js injects a sender for tests) so no
  suite reaches the internet.
- Do NOT re-test classify() here (status.test.js already owns it, round 29+).
- Settings row drives the interval + displays the LIVE value.

### Status
- 073415fe removed the duplicate detector. Next: settle the "which states"
  decision (ask the person/Splinter if unsure -- it is a product call), then
  build the sweep composing snapshot()+notify, then Settings. Full yarn test
  before merge. Challenge-loop + proof + PR. Confirm merge with Splinter (size).

## PART 3 UI -- READY DROP-IN PATCH (do NOT create the section; #1724 owns it)

🛑 Mona Lisa's autohandoff-1724 ALREADY has Settings > Automation: nav button
`data-go="automation"` and `<section id="s-sec-automation">`, and its comment
(web/index.html:9448) says "the heartbeat #1722 is a later addition to the same
section." Creating it again = conflict + duplicate. SEQUENCE: #1724 merges first,
then rebase #1722 onto main and add ONLY the control below into s-sec-automation
(a NEW sibling `<section class="dbox">` AFTER her auto-save dbox, so no edit
inside her markup). It calls my own /api/heartbeat-setting (already built+tested).

MARKUP -- new dbox inside `<section class="dsec" id="s-sec-automation">`, after her dbox:
```html
    <section class="dbox">
      <!-- #1722 (Josh, 2026-08-31): a heartbeat that checks which agents are
           working and asks you to chase anyone that has stopped. A later addition
           to the Automation section (auto-save above is #1724). Off by default;
           the interval is adjustable. -->
      <h3 class="dlab">Heartbeat</h3>
      <div class="field" style="margin-top:14px;">
        <label class="flabel" for="hb-enabled">Check on your agents</label>
        <div class="fhint">Every so often, Kosmos looks at which of your agents are working and asks you to check on any that have stopped. It asks a question, never assumes, because an agent may be mid-something. Off by default.</div>
        <div class="frow" style="align-items:center; gap:10px;">
          <input type="checkbox" id="hb-enabled">
          <label for="hb-enabled" style="margin:0;">Ask me to chase agents that have stopped</label>
        </div>
        <div class="frow" style="margin-top:12px; align-items:center; gap:10px;">
          <label class="flabel" for="hb-interval" style="margin:0;">Check every</label>
          <select id="hb-interval" aria-label="How often to check on your agents"></select>
          <button class="btn uprime" type="button" id="hb-save" aria-label="Save heartbeat settings">Save</button>
        </div>
        <p class="fmsg" id="hb-msg" role="status" aria-live="polite"></p>
      </div>
    </section>
```

JS -- beside her paintAutomation(); add `paintHeartbeat();` inside paintSettings():
```js
/* #1722: the heartbeat control in Settings > Automation. Reads the in-force
   setting (off/17 by default; the runner reads the same file, so read == in
   force) and saves {on, intervalMinutes} to PUT /api/heartbeat-setting. The
   interval choices are rendered from the server so the select and the engine
   cannot disagree about what is valid (same shape as the theme select). */
async function paintHeartbeat() {
  const en = document.getElementById('hb-enabled');
  const iv = document.getElementById('hb-interval');
  const btn = document.getElementById('hb-save');
  const msg = document.getElementById('hb-msg');
  if (!en || !iv || !btn) return;
  try {
    const r = await (await fetch('/api/heartbeat-setting', { cache: 'no-store' })).json();
    if (Array.isArray(r.intervals)) {
      const html = r.intervals.map((m) => '<option value="' + m + '">' + m + ' minutes</option>').join('');
      if (iv.innerHTML !== html) iv.innerHTML = html;
    }
    if (document.activeElement !== en) en.checked = r.on === true;
    if (document.activeElement !== iv) iv.value = String(r.intervalMinutes || 17);
    en.disabled = false; iv.disabled = false; btn.disabled = false;
    if (msg) msg.textContent = '';
  } catch {
    en.disabled = true; iv.disabled = true; btn.disabled = true;
    if (msg) msg.textContent = 'We could not read the heartbeat setting just now.';
  }
}
document.getElementById('hb-save') && document.getElementById('hb-save').addEventListener('click', async () => {
  const en = document.getElementById('hb-enabled');
  const iv = document.getElementById('hb-interval');
  const btn = document.getElementById('hb-save');
  const msg = document.getElementById('hb-msg');
  btn.disabled = true; if (msg) msg.textContent = 'Saving...';
  try {
    const res = await fetch('/api/heartbeat-setting', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: en.checked, intervalMinutes: Number(iv.value) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { if (msg) msg.textContent = out.error || 'That did not save.'; paintHeartbeat(); return; }
    if (msg) msg.textContent = out.on
      ? 'Saved. Kosmos will check on your agents every ' + out.intervalMinutes + ' minutes.'
      : 'Saved. The heartbeat is off.';
  } catch {
    if (msg) msg.textContent = 'We could not reach Kosmos to save that.';
  } finally { btn.disabled = false; }
});
```

Then a web/*.test.js mirroring web.* patterns: the control renders the server's
interval choices, PUT drives /api/heartbeat-setting, a failed save repaints the
in-force value. STATUS: markup + JS ready; blocked ONLY on #1724's section
landing on main. Backend (setting/runner/routes/29 tests) done + pushed e1c5d72b.

## STATE 00:20: UI ADDED (ADD ONLY), branch STACKED on autohandoff-1724
- Per Splinter (proceed, ADD ONLY, follow Mona's handoff): rebased
  heartbeat-automation-1722 --onto origin/autohandoff-1724 (13 commits, clean, only
  server.js overlapped and auto-merged). Added the heartbeat control as a NEW dbox
  inside s-sec-automation AFTER her auto-save control, plus paintHeartbeat + a
  paintSettings call + web.heartbeat-1722.test.js. Touched NONE of her markup/JS;
  her web test stays green (3/3). Mine: 4/4.
- SEQUENCING (the stacked-PR consequence): my branch now carries her commits until
  #1724 merges to main. So the challenge-loop + PR WAIT for #1724 on main. When it
  lands: `git rebase --onto origin/main <old-base> heartbeat-automation-1722`
  (her commits drop as already-applied), then main...HEAD = MY changes only, then
  challenge-loop + proof + PR against main. The gate-watcher (background) fires when
  s-sec-automation hits origin/main = the rebase trigger.
- Recovery: pre-stack verified tip was d3a99561 (main-based, green).

## VOICE PASS (01:14) -- supersedes the STATE-00:20 "touched none of her markup" note
Splinter authorised a section voice pass (2026-09-01 ~01:03): Mona Lisa owns the
Automation section voice, she supplied exact strings, and I FOLD THEM IN (she does
not touch my branch -- two writers on one branch during the loop is the collision we
avoided). So this branch now DOES edit #1724's auto-save copy, by design and by her
strings, on the superset branch (her voice-pass file says it lands here):
  - Automation -> Auto-save (heading), Auto-save progress -> Save your agents'
    progress (label), "You can turn this off." -> "Off by default." (hint)
  - my heartbeat label "chase agents that have stopped" -> "check on any agent that
    has stopped" (fixes the "me" ambiguity)
All four verified test-safe (no test asserts them; settings-nav asserts the nav KEY
'automation', not the heading text). The earlier STATE-00:20 "Touched NONE of her
markup" is therefore superseded: it was true at 00:20, before the voice pass was
authorised. The rebase onto merged main applies cleanly (acf7da25 changed
paintAutomation JS, not these markup lines).

## CHALLENGE-LOOP LEDGER (converged iter 5, 01:50) -- for the post-rebase proof
5 fresh blind reviewers. Fixes-per-iteration: 4 -> 2 -> 1 -> 2 -> 0 actionable.
Full suite 3408/3408. Converged: zero new BLOCKER/WARNING/CONVENTION at iter 5.

Iter 1:
- [WARNING] /api/heartbeat-setting PUT non-atomic -> FIXED (heartbeat-setting.set()
  validates both fields before any write; route + engine tests)
- [WARNING] step() wiped stall memory on a null (read-failure) roster -> FIXED
  (null preserves prev, skips the tick; test)
- [NIT] stable check_in id -> FIXED (documented the coordinator re-ask/dedup contract)
- [WARNING] notify-master-switch dependency -> DEFERRED then RESOLVED by voice-pass
  edit 5 (Mona's hb-needs-notify hint, shown only when notify is off)
- [NIT] working<->idle flicker (2-tick refinement) -> DEFERRED (documented v1 choice)
Iter 2:
- [CONVENTION] setInterval shadows global -> FIXED (renamed setIntervalMinutes)
- [NIT] double read per tick + unused intervalMs -> FIXED (read once; removed intervalMs)
- [NIT] corrupt-read message (added iter1) -> REVERTED per Splinter (copy is Mona's voice)
- [WARNING] permanent per-interval re-ask, no backoff -> DEFERRED (product call, moot
  until the relay/receipt channel ships)
Iter 3:
- [WARNING] auth_failed not chased -> FIXED (added to ASK_ON_EXIT_TO; both-direction tests)
- [WARNING] branch edits #1724 copy vs "ADD ONLY" -> DEFERRED (AUTHORISED voice pass;
  plan STATE-00:20 superseded by the VOICE PASS note)
- [NIT] interval-shortening latency -> DEFERRED (documented, bounded by one interval)
- [NIT] hb-save guard inconsistency -> DEFERRED (harmless, defensive)
Iter 4:
- [WARNING] STATE.blocked left out of the enumeration -> FIXED (named as intentionally
  not-chased: a reported wait; test)
- [NIT] first heartbeatTick blocked the listen path -> FIXED (deferred first run, unref'd)
- [NIT] check_in id can drift within an episode -> DEFERRED (no impact; no receipt channel)
Voice pass (Mona's 5 edits, all applied): Automation->Auto-save, label, hint
"Off by default", heartbeat label chase->check-on, and edit-5 notify-off hint.
Iter 5: CONVERGED. 1 NIT (hb-needs-notify trigger keys on notify-master only, shows
when heartbeat off too) -> DEFERRED (Mona's specified trigger; surfaced to her/Splinter).

NEXT (post #1724->main, per Splinter's order): rebase --onto origin/main; re-run
challenge-loop (clean rebase = unchanged code = immediate re-converge); write the proof
(.claude/plans/heartbeat-automation-1722-pre-challenge.md) with diff_hash of
main...HEAD; /create-pr. Do NOT write the proof before the rebase (hash would be stale).
Commits: e91c2a20 (iter1), 2d7c4e9c (iter2), 19bd4674 (iter3), 75296cb2 (iter4),
a6d35f3b (edit5), + plan notes.
