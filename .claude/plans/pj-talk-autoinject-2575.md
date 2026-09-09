# #2575 (display half) — collapse/dismiss the Projects-page "Talk to one of them" waiting area

## Josh's complaint (live on 0.6.50)
On the Project page, the per-agent "Talk to one of them" section (`#pj-thread`) auto-surfaces below the project composer: it shows an agent's waiting-on-an-answer question + a SECOND composer, appears "very often" (any time an agent has a pending needs_you), and has **no way to collapse or dismiss**.

## Root of the auto-surface (found)
`pjApplyEngMode` (web/index.html ~18484): in the DEFAULT (Off) mode the box is folded away, BUT a waiting agent overrides the fold — `asking = !#pj-question.hidden; box.hidden = !ENG_ON && !asking`. The code comment (#370/#2146) marks this "safety, not chrome": a waiting agent's question MUST surface in Off so the user can answer it (a number). So the auto-surface is intentional; removing it reintroduces the false-calm the design prevents.

Pete owns the ENGINE half (#2575): a stale reported needs_you that the agent never self-cleared is what surfaces here (his `POST /api/agent/<sessionName>/clear-selfreport` clears it). His route has NOT landed on main yet.

## The fix (DISPLAY, this PR) — collapse/dismiss WITHOUT losing safety
Give Josh the dismiss control he asked for while preserving the safety surface:
1. A **dismiss/collapse control** in the `#pj-thread` header (next to "Talk to one of them").
2. Per-session state `PJ_THREAD_HIDDEN` (module var; reset on reload — a dismiss is a "not now", not a permanent silence).
3. `pjApplyEngMode` respects it: `box.hidden = !ENG_ON && (!asking || PJ_THREAD_HIDDEN)` — so a dismissed box stays hidden even while an agent is asking.
4. **Safety breadcrumb (load-bearing):** when the box is hidden BUT an agent is asking (`!ENG_ON && asking && PJ_THREAD_HIDDEN`), show a compact one-line affordance ("An agent is waiting — show") that clears `PJ_THREAD_HIDDEN` on click. This is what keeps the dismiss from becoming the false-calm the design forbids: the user is never blind to a real waiting agent, they have just collapsed the full panel + second composer.

## Why B (collapse+breadcrumb), not A (show only when the user opened a talk)
A would REMOVE the auto-surface, i.e. remove the safety: a genuinely-waiting agent would not surface unless the user happened to open that agent's thread. That is exactly the false-calm #370/#2146 exists to prevent, and this display layer cannot tell a STALE needs_you (Pete's engine concern) from a real one. So B keeps the safety and gives Josh the control. Exact behaviour is Josh's UX call (Pete's note); B is my recommendation and the reversible default — if Josh prefers A, it is a one-gate change.

## Not in scope
- Clearing the underlying stale needs_you STATE = Pete's engine route (blocked on his merge). The dismiss-STATE button that calls it is a follow-on once his route lands; this PR is the pure-UI collapse only.
- No change to the question content, the answer-by-number mechanism, or ENG-mode behavior.

## Verification
- Node suites (web.* that pin #pj-thread / pjApplyEngMode), browser-check selectors/index/surface guards.
- Manual/served (routed to claude-fe): a waiting agent surfaces the area; dismiss collapses it to the breadcrumb; "show" restores it; a reload re-surfaces (dismiss is per-session).
