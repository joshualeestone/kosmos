# The per-agent activity-liveness primitive (#1930 + #2146 + #2019)

One coordinated build (Pete's architecture catch): #1930, #2146, #2019 share ONE primitive.
Design pass + options; seam agreed with Pete (his how-the-board-knows-state area), render half
of #2146 is Angel's. No cut pressure - rides a follow-up cut.

## The one defect all three share
The board derives an agent's state from the PRESENCE of text in pane scrollback, with no
timestamp/liveness, so it cannot separate happening-NOW from happened-and-STALE.
- **#1930** haunted: a FIXED agent still shows its stale 401.
- **#2146** suppressed Working: a sticky needs_you HIDES an actively-working agent's Working line.
- **#2019** disruption: a deliberate restart reads as "this agent doesn't exist".

## The primitive: activity-liveness, REPORT-FIRST
`lastActivityAt(agent)` = the FRESHEST of, in priority order:
1. **last self-report** (kosmos report/needs_you, notify.js vocab) - `engine/liveness.js`, ALREADY
   BUILT (`seen`/`read`, reporter 60s cadence, 180s stale, returns null-not-false for no-record).
   Report-freshness works on ANY runner (Windows/OpenAI-Codex - the populations this exists for).
2. **last MEANINGFUL pane-content change** - the fallback for agents that do not report. NEW work.
3. **last probe** - authprobe/codexauthprobe (#2093), already async/TTL/per-account.

🔑 Report-FIRST is the non-negotiable (Pete): pane-first re-breaks on Windows/OpenAI and re-forks
the self-report vocabulary. Pane-change is fallback only.

### Contract (Pete's, locked)
- **reconcileReport STAYS STATELESS.** Cross-tick pane-change memory lives in a SEPARATE sibling
  store (shaped like liveness.js); reconcileReport READS a freshness verdict, never holds memory.
- **False-calm is default-safe.** `lastActivityAt==null`/no sample = assume LIVE/fresh, NEVER
  stale. "is this stale?" requires POSITIVE evidence of absence-since-the-condition, not a missing
  sample. (liveness.js already does this - null not false.)
- **Meaningful change, not a raw hash.** A raw pane hash churns on the spinner/clock -> everything
  reads perpetually live. Strip volatile rows (the WORKING_LINE timer @status.js:1791, spinners)
  before hashing, OR expose per-pattern freshness ("is THIS match still producing NEW lines").
- **Reuse, do not re-derive.** `alive` = existing STRUCTURE signal (stopped-at-STRUCTURED, rule 2).
  `responsive` = existing authprobe/codexauthprobe. Fold in; do not build a second probe.

## What already exists (scope is EXTEND + WIRE, not build-from-scratch)
- `engine/liveness.js` - the report tier (above). DONE.
- `engine/disruption.js` - #2019's RESTARTING record: begin/read/active, fresh-window fold,
  self-heals on pane return, snapshot() clears on first live read. Record layer DONE.
- `engine/authprobe.js` / `engine/codexauthprobe.js` - the `responsive` probe (#2093). DONE.
- STRUCTURE signal (rule 2) - `alive`. DONE.
⇒ New work: (A) the pane-content-change fallback tier, (B) the freshest-of composer, (C) wire the
3 consumers, (D) the #2019 UI/messaging gap.

## OPEN OPTIONS (what this design pass surfaces for Splinter/Pete to weigh)

### Option 1 - the pane-change fallback signal shape
- **1a. Strip-then-hash:** strip volatile rows (WORKING_LINE, spinner glyphs, clocks) from the
  pane tail, hash the rest, store {hash, at}; a changed hash on the next tick = activity at now.
  Simple, gives ONE global lastActivityAt per agent. Risk: a too-narrow strip list churns anyway;
  a too-wide one misses real change.
- **1b. Per-pattern freshness:** expose "is THIS match (e.g. the auth-error region) still producing
  NEW lines" - count lines matching a pattern, store the count; count increasing = that condition
  is LIVE. Precise for #1930's guard; does not give a general lastActivityAt by itself.
- **RECOMMEND: BOTH, layered.** 1a for the general `lastActivityAt` fallback tier (feeds #2146's
  activeWhileWaiting + #2019's alive-vs-stuck); 1b for #1930's specific "no NEW error since healthy"
  guard. They answer different questions; #1930 needs the per-pattern one.

### Option 2 - where the pane-change store lives
- **2a. Extend liveness.js** with a pane-change record type. Con: liveness.js is deliberately
  report-only ("NO STATE HERE"); mixing a best-effort pane signal into the reliable report store
  muddies the "report is authoritative" boundary.
- **2b. New sibling `engine/activity.js`** shaped like liveness.js (record last-meaningful-change +
  read a freshness verdict), and a small `freshestActivity(agent)` composer that reads
  liveness.read + activity.read + probe. Keeps the report store pristine.
- **RECOMMEND: 2b** (sibling + composer). Matches Pete's "separate sibling store" and keeps
  liveness.js's report-authoritative contract intact.

### Option 3 - #2019's remaining gap
disruption.js (record) + `alive` exist. VERIFY what the web already renders for a disruption
record (the animated-K state may be partially wired). The likely remaining work: the animated-K
in-progress UI backed by the liveness check (success = alive+responsive OR process-alive per the
card's "hello needed" distinction), a real timeout with an honest "restarted, not back yet"
message, and the honest failure path (never fall back to "this agent doesn't exist"). Confirm
against #2019 acceptance before building; part may be Angel's/web.

## Per-card wiring (Pete's seam)
- **#1930:** a freshness GUARD on the existing HEALTHY-suppression at `status.js:4127` - suppress a
  scraped auth_failed only if activity confirms NO NEW error since the account went healthy (Option
  1b). Refinement, not a rewrite; fail-safe (unknown -> do NOT suppress).
- **#2146:** an ADDITIVE `activeWhileWaiting` flag on the row (fresh activity AND state in
  needs_you/blocked), NEVER a state/count change. needs_you STAYS counted (no false-calm). Angel's
  web render surfaces active-working AND the pending needs_you together (coexistence). This is the
  #2146 non-negotiable: NOT working-beats-needs_you (that reintroduces false-calm since agents work
  the next card while needs_you pends).
- **#2019:** disruption-record + `alive` -> restart-in-progress (animated K) vs stuck; per Option 3.

## Weakest premise
That the pane-content-change fallback can be made "meaningful" cheaply enough to not churn on the
spinner AND not miss real change, on the FIRST cut. Mitigation: it is only the FALLBACK tier
(report-first is authoritative and already reliable), and false-calm-default-safe means a
mis-tuned fallback fails toward showing a red, never suppressing one. What would change the shape:
if per-agent pane reads at the poll cadence prove too costly, lean harder on report-freshness and
make pane-change opt-in per-condition (1b only).

## Verification
Engine unit tests (freshest-of ordering; null-safe/false-calm; strip-then-hash ignores the timer
line; per-pattern count-increase; #1930 guard suppresses only on confirmed-no-new-error with a
control that returns the dangerous answer; #2146 flag additive, needs_you still counted). The
#2146 web coexistence render is Angel's (browser-verified). #2019 disruption UI end-to-end is a
clean-machine pass (needs Josh). Build through the gated chain per lane; coordinate #2146 render
with Angel; ping Pete to review this doc before flagging Splinter.
