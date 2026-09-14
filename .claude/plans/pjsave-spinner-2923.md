# Plan: Project settings Save changes - inline spinner, then "Saved." to the LEFT of the button (#2923)

## Source
Josh, 6.59 QA notes 2026-09-12 (verbatim): "If I go into project settings and make a change and hit Save Changes, it pops some text down on the bottom left of the button. That's real easy to miss and says 'Saved'. Let's put that up. Let's do this: let's inject our spinner when you hit Save Changes (our little inline text one). It makes it spin and then prints 'Saved' to the left of the button so that people know something happened and then it was saved."

## Decision (make-the-call, Josh's standing ruling)
- The "little inline text one" spinner is the **Sweep** dots-trail (#2236, my own, Josh chose it 2026-09-05) - the canonical inline loader used for "Adding…" / connect. Inline the literal `<span class="spin spin-sweep" …>8×<i></i></span>`, matching frPaintConnect/frPaintOpenai (no helper; `.spin`/`.spin-sweep` CSS already in page).
- **Add a dedicated status element to the LEFT of the Save changes button** for the save-action feedback: spinner while the PUT is in flight → "Saved." on success. `.sfoot` is a right-justified flex row, so a span placed before the button sits immediately to its left.
- **Keep `#pjs-msg` (the after-button slot) for the field-refusal / no-op / engine-error messages.** The `.fmsg` note (web/index.html ~929, kosmos#1303 G) says the after-button slot "stays that way for success and for anything not about one field"; but Josh is explicitly moving the *success* confirmation up, so success migrates to the left status while refusals (which point "above") stay below. Rejected: moving ALL messages left - long engine-error sentences beside a "big" button read badly, and the #1303 G refusal-pointer design keeps them below on purpose.
- Spinner is injected **after** the "Nothing has changed." early-return, right before the fetch - so a no-op click shows no spinner (the spin represents a real save in flight).

## Changes (web/index.html)
1. **CSS** (near `.sfoot`, ~1108): `.sfoot-live { align-items:center; gap:var(--space-4); }`, `#pjs-save-live { margin:0; min-height:0; }`, `#pjs-save-live:empty { display:none; }`.
2. **Markup** (~11318): `.sfoot` gains `sfoot-live`; add `<span class="fmsg" id="pjs-save-live" aria-live="polite"></span>` BEFORE the `#pjs-save` button.
3. **Handler** (`#pjs-save` click, ~36584): add `const live = …('pjs-save-live')`; clear it at top; inject the Sweep spinner into `live` right before the fetch; clear `live` at the top of the `!res.ok` block and in `catch`; on success set `live.textContent = 'Saved.'` (was `msg.textContent = 'Saved.'`) and leave `#pjs-msg` empty.

## Guard updates
- `docs/browser-checks/render-pjsettings.js:82` - the save round-trip now waits for "Saved." in `#pjs-save-live` (not `#pjs-msg`), asserts it sits to the LEFT of the button (status.right ≤ button.left), and asserts `#pjs-msg` is NOT also "Saved." (no duplicate). Line 91-92 (no-change → "Nothing has changed." in `#pjs-msg`) unchanged. This file uses `die()` + one top-level catch, so the browser-checks emit-count registry is unaffected.

## Out of scope
- `web.desc-error-1303g.test.js` counts (error-path strings) - untouched, verified the added lines don't add "Nothing saved."/"There is something to fix above." and stay within its char windows.

## Done-condition
On a real save, the Sweep spinner appears to the left of Save changes, then is replaced by "Saved." to the left of the button; no "Saved." below; no-op and refusal messages still appear below. Full suite green, render-pjsettings green, CI green.

## Weakest premise
That splitting feedback (success left, refusals below) is clearer than one slot. Mitigated: the two never co-occur (success clears, refusal shows below with its own "fix above" pointer), and Josh explicitly asked for the success case to move up.
