# Plan: #2020 step 3 - flip the notify send default to ON

## Ruling (unblocks this)

#2020 parked THREE steps; only step 3 (flip the defaults to ON - data leaving the
machine) was genuinely gated on Josh. Josh ruled it 2026-09-03 (card title:
"on, and they can turn it off"). Splinter confirmed 2026-09-07 the ruling covers
the notify default, and that the `#1843 needs-decision` label is stale for this
piece. So step 3 is buildable now, decide-and-continue.

## What was already done (steps 1-2, and the ping half)

- The Settings opt-out control for notify already exists AND is already a switch:
  `#notify-row` / `#notify-toggle` (`role="switch"`) in web/index.html, with
  `/api/notify-setting` GET/PUT wired to `notify.setOn`, painted by
  `paintSwitch('notify-toggle', ...)`, and 403-safe reads (a gated GET draws
  could-not-read, never a false Off). So #1843's switches-not-checkboxes is
  already satisfied for notify, and step 1 (restore the control) + step 2
  (disclosure copy: "Let the Kosmos team know when an agent posts or answers
  you") are done.
- The created-agent PING default was already flipped ON (#2283, #2020/#2013).

## The change (small, as scoped)

The ONLY remaining piece is the default flip in `engine/notify.js` `read()`,
mirroring `ping.js`:
- ENOENT (never-asked machine): `{ on: false }` -> `{ on: true }`.
- parsed: `on: parsed.on === true` -> `on: typeof parsed.on === 'boolean' ? parsed.on : true`
  (a missing/non-boolean field is the never-asked default ON; only an explicit
  `false` turns it off, so a person's opt-out is honoured exactly).
- KEPT: a malformed/unreadable pref file still fails to OFF (the safe direction
  for a body leaving the Mac; only the never-asked ENOENT case is ON).

Tests updated to the new default:
- `engine/notify.test.js`: the "off by default" test rewritten to "ON by
  default; opting out stops the send"; the step-3 gate assertion flipped
  OFF->ON (the ruling now exists); the control-present+default pairing comment
  updated to "both default ON, each with its restored switch" (#2013 rule:
  never a default-on without a control - both controls are present).
- `server.test.js`: the `/api/notify-setting` route test now asserts default ON
  and round-trips both ways (on -> off -> on).

## Why this is safe / the honesty rule

- The send is EVENT-ONLY (who, what, which project, when, install id; never the
  words), which is why default-on is low-privacy - the same rule as the ping.
- The opt-out switch is present (never a default-on without a control - the
  exact "removed opt-out" state #2013 exists to prevent).
- The relay endpoint does not exist yet; the send is fire-and-forget, so
  default-ON is harmless today and correct-by-default when the relay lands.

## Decisions

- Mirror ping exactly rather than invent a new default mechanism - the two
  telemetry sends should behave identically (both default ON with a switch).
- Did NOT touch the disclosure copy or the switch (already present + honest);
  scope is only the default flip Josh ruled.

## Closes

This is the last piece of #2020. Per Splinter it also completes #1843 (Josh's
Top-10 rank X: items 1-3 shipped, item 5 interval #2393, #2020 the last piece).
Reference #1843 in the PR.
