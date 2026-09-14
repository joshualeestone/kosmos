# Plan: machine-check badges read as status, not checkboxes (#2963)

## Source
Out of #2955 (relayed by Splinter, 2026-09-12). The Settings > "Keeping agents
running" machine checks - including "Agents made here automatically restart
themselves / They come back on their own after this computer restarts"
(engine/machine.js restartCheck) - render as a rounded-SQUARE badge with a
checkmark (`.chk-m`, glyph from `CHK_MARK = { ok: '✓' }`). A rounded square with a
checkmark reads as a toggleable checkbox, but these are read-only machine-STATE
readouts (green when the login jobs are registered; no user toggle). Josh read the
restart one as a control and found it "checked" while the behaviour was broken
(#2955) - a control implying a capability it lacks, the same honesty class as ICK's
#2957 mislabel.

## The change
`web/index.html`, one property on the shared `.chk-m` rule:

```css
.chk-m { ... border-radius: 50%; ... }   /* was 8px */
```

A circle with a checkmark is a universal "verified / status: good" badge and never
a toggle; a rounded square with a checkmark is a checkbox. Changing the shape makes
the badge match what it is.

## Why the whole class, not just the restart row
All six machine checks (app-location, installed, labels, restart, sleep, autostart)
share `.chk-m` and all are read-only status readouts - none are toggles. Fixing only
the restart row would leave the same false-checkbox on its siblings and make the set
inconsistent (why is restart a circle but sleep a square?). One rule, whole class.

## What it must not break
- The three states (`.chk.ok` ✓ / `.chk.att` ! / `.chk.unk` ?) keep their colour
  treatments; only the corner radius changes, so the ! and ? badges become circles
  too, which is correct (they are the same status readout in another state).
- No markup or JS change; the badges were already non-interactive divs, so this is
  purely the visual signal.

## Verification
- Headless (pw-runtime, Chromium): `.chk-m` computed border-radius is 50% (a circle,
  not the old 8px square) and the ✓ glyph still renders. PASS.
- The final look is Josh's in-app josh-review.

## Rejected alternatives
- Change only the restart row: inconsistent; siblings keep the false-checkbox.
- `<input type="checkbox" disabled>`: still reads as a disabled toggle, not a status.
- A "status" word only: the square-✓ is the stronger visual signal and would still
  mislead.

## Weakest premise
That a circle-✓ reads as status and not as a radio button. A radio is hollow or
dotted; a circle WITH a checkmark is a success badge, so this holds. Josh's in-app
review is the final say.

## Delivery
kosmos web (agent-workforce). CSS-only, so the #1720 browser-check gate is satisfied
with a `Browser-check:` trailer documenting the headless check. Self-merge on green;
leave josh-review for the visual read.
