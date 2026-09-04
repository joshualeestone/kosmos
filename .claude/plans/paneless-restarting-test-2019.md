# Plan: arm the paneless-restarting guard with a test (#2019 follow-up)

Branch: `paneless-restarting-test-2019`. Card: kosmos#2019. Lane: design/content (Mona Lisa).
Test-only follow-up to the merged #2019 presentation (PR #2111, squash 7ef97503).

## Goal

Lock the core #2019 scenario: an agent mid-restart whose tmux pane is GONE (the tmux gap) still
renders as restarting, never "Not running" / gone.

## Why (an untested guard is an unarmed guard)

#2111 added the offline early-return guard `a.running === false && a.state !== 'restarting'` at TWO
render sites, card() and lrow(), precisely so a paneless (running:false) restarting agent is not
swallowed by the offline "Not running" path. (The members list uses a DIFFERENT construct for the
same intent, `(m.present || m.state === 'restarting')`, gated on `present` not the running===false
early-return, and it renders via pjMember, not card/lrow -- arming its test belongs in the pjMember
suite and is deliberately OUT OF SCOPE here.) Now that #2105 (engine) emits `state='restarting'` for
a paneless agent (reconcileReport + the disruption record), that path is live. But the #2111 browser
check only ever used running-not-false fixtures, so the running:false early-return path was never
exercised at either site: the guard was unarmed by a test.

## Change (test-only, docs/browser-checks/render-restarting-2019.js)

- Add a paneless arm at BOTH sites: card() and lrow() for `state:'restarting', running:false`
  (only `running` is load-bearing; presence comes from CARD_ST.restarting.pres, not a `present`
  field) assert the restarting render (card class `restarting`, pill `st-restarting`, the K present,
  the "Restarting agent" label) and NOT "Not running", in both themes.
- Add a CONTROL: the SAME `running:false` with a non-restarting state (`idle`) MUST still render
  "Not running". This proves the paneless pass is the guard doing its job, not a globally-defeated
  offline early-return (an assertion that passed either way would mean nothing).

## Test plan

Run the check headless; both new arms + the control pass on origin/main (the guard is merged). The
control is the discriminator: it renders "Not running" for a non-restarting running:false agent,
confirming the early-return still fires and the restarting exemption is specific. No product code
changes; not a web/ product change beyond the check file; no em dashes.
