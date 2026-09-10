# view-agent-buttons-0644 — Trust & Restart button (View-Agent Terminal tab)

## Source
Splinter routed the two View-Agent buttons (0.6.44, keep-cranking): "Trust & Restart" (#5
one-click insurance) + "Open Terminal". This PR ships the FIRST, "Trust & Restart"; "Open
Terminal" is a follow-up once Pete hands its route contract (he is building that route now and
will not hand a shape he has not implemented). Both ride 0.6.44, no deadline between them.

Route contract (Pete, FINAL + tested): POST /api/agent/:name/trust-and-restart, name
URL-encoded, no body needed. 200 -> {outcome:"restarted", because, steps, trusted}; 400 refused
-> {outcome:"refused", because}; 400 bad name -> {error}; 500 -> {error, detail}. The restart is
the verdict; trusted.wrote is best-effort/informational. Copy (Mona Lisa): label "Trust &
Restart", hint "Approves this agent folder so it can start without the Terminal question."

## The feature
An agent stuck at the terminal trust question ("do you trust the contents of this directory")
cannot start. "Trust & Restart" writes the folder-trust key + restarts in one click, so the user
can unblock it from the page instead of hunting for the terminal.

## Placement (my call, reversible)
In the Terminal tab (#d-sec-term), an action bar ABOVE the window-capture box (#d-window-box).
Deliberately above the capture box: that box HIDES when the capture cannot land, which is exactly
the stuck state where this button is needed, so it must not live inside a box that hides then.
The trust prompt is a terminal thing (Mona's helper says "the Terminal question"), so the Terminal
tab is its home. Pete noted "next to the /restart button" for auth/casing consistency (matched),
not a placement mandate. Josh/Mona can move it; moving a button is trivial.

## What finished looks like
- A "Trust & Restart" button in #d-sec-term posts to /api/agent/<encoded name>/trust-and-restart
  (POST) and surfaces the route's `because` on 200 and on a 400 refusal; a bad-name/500 shows the
  `error`; a network throw shows a friendly fallback.
- The receipt cannot land under a different agent if the person switches mid-POST (capture-and-
  recheck, like the neighbouring d-save handler).
- A browser check (render-trust-restart-0644.js) pins the button + route + method + messages, with
  a control (no button -> reds; wrong route/method -> reds). Registered in browser-checks.sh +
  README + reason-grep counts (65->66, 40->41).
- Full node suite green.

## Design decision + weakest premise
Trust & Restart is a DIRECT one-click action (per Splinter's "one-click INSURANCE"), NOT gated by
the restart confirm modal the regular Restart uses. Rationale: the scenario is a STUCK agent (no
valuable in-flight session to warn about), and Pete's 400-refused covers "not running". WEAKEST
PREMISE: a user who clicks it on a BUSY working agent restarts it with no confirm (session loss).
If Josh wants a confirm there, routing the click through openRestartModal (with a trust flag) is a
small add. Flagged for his call.

## Scope / coordination
Renet confirmed disjoint: his #6 switch-modal is the Kosmos switcher (#worldsw ~6444,
#world-switch-modal ~7650, worldsw* JS ~16560-16930); my agent-detail region (#d-sec-term ~6759,
handler by d-save ~24789) does not overlap. He pings on his merge; my rebase should be clean.

## UPDATE: Open Terminal (button #2) added to this same PR
Pete handed Contract #2 (FINAL, built+tested; amended: env failures moved 400->503). POST
/api/agent/:name/launch-terminal, name URL-encoded, no body. 200 -> {ok:true, session};
400 refused (agent not running / unconfirmable) -> {ok:false, because}; 503 environment failure
(HEADLESS board with no desktop / osascript / tmux -- expected, not a bug) -> {ok:false, because};
bad name -> {error}; 500 -> {error, detail}. The frontend treats ANY non-200 the same (show
`because`), so 400 vs 503 need no special-casing. It attaches a Terminal.app window to the agent's live tmux
session -- READ-ONLY about the agent (adds a viewer; does NOT restart it). Copy (Mona): "Open
Terminal", helper "Opens this agent's Terminal window on this computer." (the "on this computer"
hints at the desktop requirement; the headless case surfaces via the route's `because`).

- web/index.html: "Open Terminal" button + handler in the same #d-term-actions bar, placed FIRST
  (it is the lighter, read-only action). On 200 shows an opening confirmation; on ok:false shows
  `because`; friendly fallback on a throw; same capture-and-recheck guard.
- render-open-terminal-0644.js: pins button + URL-encoded route + POST + 200-confirmation +
  refusal `because` + throw fallback, with a control. Registered (browser-checks.sh + README +
  reason-grep 66->67/41->42).

So this PR ships BOTH buttons. NOTE: the box is held by the 0.6.43 cut until ~02:00 CDT; the
browser checks + full suite + challenge-loop will run AFTER the box frees (running them during a
cut corrupts both). Both buttons were built (non-box) during the hold.
