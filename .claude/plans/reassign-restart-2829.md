# Plan: #2829 rename/reassign save pops the restart modal

Branch: `reassign-restart-2829`
Card: kosmos#2829 (Josh, 0.6.57 live review)

## What Josh asked for (verbatim)

> If i rename an agent, or assign him to report to someone right now it says "Saved.
> Takes effect when it next starts. It is running now on what it read at boot." but we
> should pop up a modal that says it was saved but needs to be restarted to take effect
> with a restart button. then while it restarts we show the animated K turning into a
> circle for like 2 seconds, then automatically send a "hello" to the agent and tell the
> user to go say hello as well.

## The decision

Reuse the existing restart modal (`rst-modal`) and its `rst-go` handler, which ALREADY
plays the branded K-into-circle loader (`RESTART_BUSY_HTML` + `startKLoader`, held on
`RESTART_HOLD_MS`) and auto-sends a hello with the say-hello nudge (shipped in #2831 /
#2686). Building the restart visual once and using it from both triggers is exactly what
the card's "Relation" section asks for.

Changes:
1. `openRestartModal(btn, name, opts)` gains an optional `opts.saved` variant: the title
   becomes "Saved. Restart X to use it now?" and the small line leads with a saved-context
   sentence before the in-flight cost. The list, memory-consequence sentence, buttons, and
   the rst-go flow are unchanged.
2. New `popRestartAfterSave(forAgent, lead)` helper: ensures a "Restart now" fallback
   button exists in the role dialog message line (`d-role-msg`, carrying `data-restart-agent`
   + `data-restart-note` so `rst-go` can run the restart and land the auto-hello receipt),
   then opens the modal in the saved variant.
3. Wire it into both save-success paths in the role dialog:
   - report-to `told` + still running: replace the passive "takes effect when it next
     starts" line with `msg = "Saved."` + auto-pop.
   - rename that changed the file + still running: keep the existing message line and
     auto-pop (reusing the button it already builds, or appending one on the text-only
     branch where the engine did not return the old name).

## What I rejected

- A brand-new lightweight "saved, needs restart" modal: would duplicate the tested restart
  visual + auto-hello flow, exactly what the card says to avoid. Reusing `rst-modal` keeps
  one restart path and one set of tests.
- Keeping the rename path as an inline "Restart now" button only (no auto-pop): the card
  says "pop up a modal", so both triggers auto-pop for parity.

## Weakest premise

That auto-popping the full restart modal (with its memory-loss warning) on every
rename/reassign is the right weight. The warning is truthful (a restart does lose in-flight
memory), and Josh explicitly asked for a modal, so this ships as asked; it is reversible and
staging-gated, and Josh reviews live. If it reads as too heavy he can ask for a lighter
variant, which the `opts` seam already makes cheap.

## Files
- `web/index.html`: `openRestartModal` opts, `popRestartAfterSave`, two call-site wires.
- `docs/browser-checks/render-reassign-restart-2829.js`: new hermetic check (9 assertions),
  drives the real `popRestartAfterSave` + `openRestartModal`.
- `tools/browser-checks.sh`, `docs/browser-checks/README.md`: registration.
- `browser-checks-reason-grep.test.js`: EXPECTED_SITES 102 -> 103 (per-problem FAIL loop);
  EXPECTED_CATCH_SITES stays 72 (multi-line catch, no launch catch).

## Verification
- New check passes 9/9; proven to FAIL when the saved variant is disabled.
- Registry tests (reason-grep, indexed) green.
- Full unit suite green.
