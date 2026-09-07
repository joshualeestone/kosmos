# spinner-sweep-0642 — swap the Choose-a-Model loading spinner to Mona's "Sweep" dots

## Source
Josh 0.6.42 fresh-macOS re-test (2026-09-06 ~11:13 PM CDT), item #2, routed by Splinter.
Spec: `Josh-Brain/Projects/kosmos-0.6.42-install-flow-retest-feedback-2026-09-06.md`.

Josh, verbatim: *"On all of the spots where I thought there was going to be the loading
indicator of the dot thing that Mona Lisa created, it was inserting a tiny picture of the
Kosmos icon... These should be the spinners that Mona Lisa created."*

## Root cause (a defect in my own #11 work, PR #2372)
#11 injected a loading spinner on the Choose-a-Model connect states, but used `.kspin` —
which renders `/icons/kosmos-32.png`, the **Kosmos mark** (used for agent *restart*), not a
loader. So every loading state showed a tiny Kosmos icon instead of Mona's loading dots.

Why it shipped: my #11 browser check (`render-model-spinners-2365.js`) asserted only that *a*
spinner (`.kspin`) was present — "a spinner exists" was true, so the wrong asset passed. Josh
caught it by eye.

## The correct component
Mona Lisa's **"Sweep"** dots-trail loader (Take D), the one Josh chose 2026-09-05 over the
retired "Lively". Source of truth: `installkosmos.com/design/loading-indicators` (variant D).
Markup: `<span class="spin spin-sweep" style="--sz:16px"> ` + eight `<i></i>`. The dots light
one after another around a ring; gold by default, reduced-motion calms to a single pulse.

Note: Mona's first HEADS-UP named "Lively, turning"; I caught that the design page she cited
says Sweep is chosen and Lively is retired ("could look broken"), built Sweep, and flagged it —
she then corrected herself to Sweep independently. Converged.

## What finished looks like
- The four SYSTEM-working connect states (downloading, installing, signin-launching,
  signin-completing) and the OpenAI "Adding..." validate render `.spin.spin-sweep` (8 dots),
  and NO `.kspin` icon.
- The user-action wait (signin-browser-open) renders NEITHER (unchanged — it waits on the
  person, not the system).
- The `.kspin` Kosmos mark is untouched for its legitimate use (agent restart glyph, `kGlyph`).
- The browser check pins the SPECIFIC component so the wrong-asset defect cannot recur.
- Full node suite green; browser check green with a negative control proving it reds on the
  pre-fix icon page.

## Changes
1. `web/index.html` `<style>`: add a reusable `.spin` / `.spin-sweep` component (lifted
   byte-faithfully from the design page: base + 8-dot ring + sweepLite keyframe + reduced-motion
   calmPulse), with a default `--sz: 16px` so the stylesheet defines every custom property it
   references (server.test.js "no undefined custom property" guard).
2. `web/index.html` `frPaintConnect`: the inlined `spin` const → `.spin spin-sweep` (feeds all
   four system-working states). Inlined literal (no helper call) because the connect painters
   are eval-extracted by the test harnesses.
3. `web/index.html` OpenAI validate: "Adding..." spinner → `.spin spin-sweep`.
4. `docs/browser-checks/render-model-spinners-2365.js`: rewritten to assert `.spin-sweep`
   present + exactly 8 `<i>` dots + NO `.kspin`, in each system-working state and the OpenAI
   Adding state; control asserts signin-browser-open has neither. Emit-site shapes preserved so
   `browser-checks-reason-grep.test.js` counts (65/40) stay stable.

## Scope guard
`.kspin`/`kGlyph` is NOT changed — it is the restart mark, a separate deliberate component,
not flagged. Only the #11 loading-state injections (the three spots Josh named + the parallel
OpenAI validate) are swapped.

## Verification
- `render-model-spinners-2365.js`: green on the fixed page; negative control confirms it reds on
  the pre-fix `.kspin` page (sweep=false, icon=true).
- Full node suite: green (fixes the one `--sz` undefined-custom-property failure caught mid-build).
- `browser-checks-reason-grep.test.js`: 5/5 pass (emit-site counts unchanged).
- Rides Josh's next 0.6.42 re-test for the live visual.

## Weakest premise
That Sweep at `--sz:16px` reads well in the `fr-ctitle` title line (I matched #11's 16px
footprint; verified in headless render, not yet on Josh's live headed screen). If Josh wants it
larger/smaller in a title vs inline, `--sz` is the one number to change.
