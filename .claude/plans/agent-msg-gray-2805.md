# Plan: kosmos#2805 -- agent messages get a very light gray bubble

## The request

Josh, testing 0.6.56, 2026-09-11: "This dialog box is looking better with the
blue for me. Let's put a very light gray for messages from the agent." The blue
already lives on the person's own messages (#2660); he wants the agent's side of
the DM view to read as its own light-gray bubble, blue staying for the user.

## Where it lives

The "Talk to <agent>" DM view (`web/index.html`, `#d-dmthread`, rows drawn by
`dmRow`). A person's message is `.dm.mine .dm-b` (royal-blue `--usermsg-tint`,
from #2660). An agent's message is `.dm.theirs .dm-b` -- created when a stored
message carries a `from` field -- and since #2660 it has been `transparent`.

This is the only surface with both a user bubble and an agent bubble: in the
project room the agent side is read live off the pane and is not stored, so
`.pj-msg` there is user-only and needs no change.

## The change

`.dm.theirs .dm-b { background: var(--k-sunk); }` -- restoring the exact agent
tint #2660 removed. Rationale:

- `--k-sunk` is the system's subtle neutral inset gray, defined per theme in the
  same four blocks as `--usermsg-tint` (5% light, 6% dark, 8% navy), so one rule
  covers light/dark/navy, mirroring the blue rule.
- NOT `--k-bg` (the #2711 file-card gray): #faf9f7 sits on the now-white
  (`--k-surface`) DM panel and is all but invisible on it -- the dissolve trap the
  file's own note already records (a `.theirs` fill that took the surface colour
  had no visible bubble). #2711 made the dialog white precisely so a light-gray
  agent bubble reads.
- Inner code pills (`.mdc`/`.mdcb`, themselves `--k-sunk`) stay visible: their own
  fill composites over the bubble's and lands a shade darker, not equal.

Two stale comments are corrected: the `.dm-b` default note ("agent side carries
NO fill") and the "there is no rule for `.theirs`" note (which argued against
adding one -- now superseded by #2805, with the dissolve reason preserved as the
reason `--k-sunk` and not `--k-bg`/`--k-surface` is the right token).

## Guard

`docs/browser-checks/render-agent-msg-gray-2805.js` (wired into
`tools/browser-checks.sh`, listed in the README). It renders an agent row beside
a person row and asserts, in light and dark, that the agent bubble is filled (not
the transparent #2660 state), is distinct from the person's blue, reads against
the DM panel (did not dissolve), and is a neutral gray. It asserts the
relationship, not a literal rgba, so a retune of the gray stays green while a
regression to transparent/blue/surface reds it. Verified headless both themes;
negative control (rule -> transparent) reds it on 4 arms.

## Rejected

- `--k-bg`: too close to the white surface for a borderless bubble (dissolve).
- A dedicated `--agentmsg-tint` token: redundant -- `--k-sunk` is literally the
  gray this row wore before #2660, and adding a token duplicating its per-theme
  values is over-engineering.
- Changing the shared `.dm-b` default instead of scoping to `.dm.theirs`: less
  precise; an explicit `.theirs` rule mirrors the `.mine` rule and leaves any
  non-message `.dm-b` neutral.
