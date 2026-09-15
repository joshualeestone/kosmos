# #2808 class-1 (c) ARMED: wire the invisible auto-handle into the board

Splinter routed this: Angel's class-2 (#3092, by passthrough + stateReportedBy) is on main, so the
(c) wire-up I documented is unblocked. 0.6.66's cut is gated on Josh's vercel re-auth, so there is
time to ARM (c) into this cut. Josh LOCKED 2026-09-14 16:49: "auto-handler #1 invisibly."

## What this arms
The merged (c) core (#3093) shipped the decision + executor + dry-run, unarmed. This branch wires it
into the board so a Claude Code technical permission/trust prompt is auto-handled invisibly.

## The change
- engine/class1-autohandle.js (my merged module) gains the armed-sweep layer:
  - `standingFromAgent(agent)`: adapt a reconciled roster card ({name, state, stateReportedBy}) to
    the `standing` shape. Reads the RECONCILED state, not the raw self-report - a safety choice:
    stateReportedBy is set ONLY for a self-reported state (a scraped-only needs_you is null -> stays
    red), and a conflicting/superseding scrape is already reconciled before the card, so firing
    cannot restart an agent that moved past the prompt.
  - `recordAttempt(attempts, name, now, opts)`: append a handle timestamp to the cross-tick Map,
    pruning old ones. The loop-guard's persistent memory.
  - `sweepOnce({roster, attempts, now, trustAgentFolder, restart, RESTARTED, opts, log})`: one armed
    tick - plans each agent, runs runClass1Handle on the trust-and-restart ones (recording every
    attempt so a persistently-stuck agent ESCALATES rather than looping), leaves none/escalate
    untouched. Deps-injected, best-effort per agent, never throws out.
- server.js: a new always-on sibling sweep (next to the #185 nudge / #1724 autohandoff / #1722
  heartbeat sweeps): own ~1-min unref'd best-effort timer, reads safeRoster(), calls sweepOnce with
  create.trustAgentFolder + remove.restart + remove.OUTCOME.RESTARTED, carrying an in-memory
  class1Attempts Map across ticks (heartbeat-style).

## Safety (safety is the whole risk of this feature)
- Fires ONLY on reconciled state needs_you + self-reported by:'auto'. NEVER on by:'agent' (class 2,
  the agent's own question - de-alarmed by #3092, kept VISIBLE; auto-clearing it would drop a real
  request and stall the fleet), operator, legacy null, or a pane-scraped needs_you (stateReportedBy
  null -> red).
- Write-key + restart, NO send-keys (the manual /trust-and-restart path), so no keystroke ever
  enters a live pane.
- Loop-guarded across ticks: after maxAttempts (2) in the window (10 min) a still-standing prompt
  escalates (left red, the divergence signal) instead of restarting forever.
- Gated on the board's live-execution opt-in (liveExecutionAllowed), which the board sets on the
  real-start path only - so the sweep is INERT under `node --test` (no test can trigger a real
  restart or trust write) and active in production. remove.restart independently enforces the same
  gate, so the executor is doubly protected.
- ALWAYS ON in production (Josh: invisible, not a user setting), with
  AGENT_WORKFORCE_CLASS1_AUTOHANDLE_OFF=1 as an operator emergency brake.

## Scope decision + weakest premise
Decided: read the RECONCILED roster (safeRoster), not raw selfreport - the reconciliation is exactly
the staleness/scrape-conflict protection an auto-restart needs. Decided: in-memory attempts Map
(heartbeat-style), not an on-disk store - it persists across ticks (the loop-guard's need); a board
restart resets it, after which a genuinely-stuck agent gets a fresh bounded 2-per-window before
escalating, which is acceptable and simpler/lower-risk than a new on-disk store.
Weakest premise, named: an escalated (divergent) agent is re-tried after the 10-min window prunes,
so a truly-unfixable-by-restart agent sees ~2 restarts per 10 min indefinitely (bounded, cheap, and
it shows red on the board the whole time as Angel's #3092 safety net). A sticky "escalated, stop
until reset" flag is a possible follow-up if real divergence is observed at scale; the bounded retry
is the safe first cut. What would change my mind: an observed agent that restart cannot fix accruing
cost - then make escalate sticky.

Full challenge-loop before PR (this arms auto-restart in production; the review is the point).
Addresses #2808 (class 1).
