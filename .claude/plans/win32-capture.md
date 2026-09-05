# win32 live-state source (setPaneCapture analog) (#570 / #253)

The third win32 slice, after the roster (#2171) and the create-side record-write
(#2174). Supplies each win32 agent's live STATE to the board.

## Problem

On a Mac, `status.snapshot` reads an agent's state by SCRAPING its tmux pane text
(`capture-pane` -> `classify`), fed by the `setPaneCapture` seam. Windows has no
pane. `claude agents --json` reports a per-session `status` for interactive
sessions, observed to be `busy` or `idle` -- so that is the win32 scrape-equivalent.

## Decision

`engine/win32capture.js` `make({run, record})` returns a `setPaneCapture` provider.
For a win32 pane it answers the session's live status token; `status.js`'s new
win32 arm of `classify()` maps it: `busy` -> WORKING, `idle` -> IDLE, else UNKNOWN.

### Join on the sessionId, not the name

The roster emits Kosmos's RECORDED name (what create filed the session under);
`claude agents --json` reports the session's LIVE name (Claude derives it from the
cwd, e.g. `pigeonpete-50`), a different string. The only stable link is the session
UUID, so the capture joins: recorded-name -> (win32sessions record) -> sessionId
-> (agents --json) -> status. Reading status by name would miss every agent whose
live name differs from its recorded name (all of them). The join re-applies the
same `validId`/`validName` gates and the same `win32roster.flat` the roster uses,
and keys on `flat(name)` -- the exact value the roster emits -- so the two agree by
construction (one definition, two call sites).

### This is the scrape-equivalent, NOT the whole state

It supplies only the coarse working/idle the live list can see. `needs_you` and
`blocked` are NOT in `agents --json` (measured on this Mac: a waiting session reads
`idle`, indistinguishable from idle -- see kosmos#570) and come only through the
SELF-REPORT path, which `reconcileReport` OUTRANKS this scrape with -- exactly as it
does over a Mac pane scrape. So a win32 agent that self-reports needs_you shows red
regardless of this arm; this arm only answers for one that is not reporting.
`STOPPED` is decided by the roster (a gone session stops being emitted), not here.

### Refuse honestly

A failed/absent `agents --json` read, an unrecognised status token, and an absent
join all collapse to null -> UNKNOWN ("we could not read its state"), never a
guessed idle/working off a look that did not land -- the same discipline as a
failed `capture-pane`.

### One read per tick

`snapshot` calls the capture once per pane; a short-TTL memo collapses a tick's
per-pane calls to one `agents --json` read (the roster does its own separate read
for the source seam -- two reads per tick total, still fewer than the Mac path's
one-`capture-pane`-per-pane).

### Inert on Mac, dormant until the flip

The classify arm is gated on `pane.command === win32roster.WIN32_COMMAND`
("claude.exe"), a value tmux never emits on the Mac, so it cannot affect any
Mac/codex pane. Like the roster and the record-write, it is NOT gated behind
`platform.js` SUPPORTED (still `['darwin']`) -- it is readable/dormant until the
final port step flips SUPPORTED to include win32.

## Rejected

- **Synthesize fake screen text** for the existing Claude classify path to scrape:
  couples the capture to classify's Claude-screen regexes (fragile). A structured
  win32 arm keyed on a status token is cleaner and parallels the existing codex arm.
- **Carry status through a new PANE_COLUMNS field**: changes the positional
  tmux-format contract shared with the Mac path for no gain over the capture seam.

## Port order (this lane)

roster (#2171, DONE) -> create.js record-write (#2174, DONE) -> **win32 live-state
(this PR)** -> Gap-B report/self-report win32 wiring (windows-orchestrator's arm;
supplies needs_you/blocked via reconcileReport) -> LAST flip platform.js SUPPORTED.

## Known follow-up for the wiring arm

Name-uniqueness among live recorded sessions is assumed: two sessionIds with the
same recorded name (a stale record never `forget()`-ed before a same-named session
is re-created) would collide on the map key, later-iterated wins. Unreachable until
the win32 create/restart flow is wired into create.js; a guard belongs there.
