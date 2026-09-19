# type-to-focus-3283 — first keystroke routes into the composer

Card: kosmos#3283 (Josh, via Splinter 2026-09-19). Lane: app-rendering (renettilley).

## The ask
On the agent-conversation view AND the project view (both grid and consolidated),
when the user starts typing with **nothing focused**, the keystrokes go straight
into the composer / dialog input — no click into the field first. Josh: nothing
else on those screens catches key commands, so a keystroke should just start
populating the message input.

Three surfaces, each with one composer to receive the first keystroke:
1. Agent conversation view (`#panel-detail`, Talk section) → `#d-say`
2. Project GRID view (tabs layout) → `#pj-post`
3. Project CONSOLIDATED view (same DOM, CSS mode) → `#pj-post`

## Design (web/index.html, one global keydown handler + one helper)
- `activeComposer()` returns the ONE composer the current surface should receive
  the keystroke, or `null` when the surface has no composer (settings, create, the
  projects LIST, a closed project):
  - `#panel-detail` visible → `#d-say` (Talk) if rendered, else `#d-term-say`
    (Advanced/Terminal quick line). They are never co-visible (section-switched).
  - `#panel-projects` visible → `#pj-post` (room composer; SAME element in grid and
    consolidated). Explicitly prefer it over `#pj-say` (which is only visible in
    Engineering mode with a project open, the one co-visible case).
  - else → `null`.
  - "rendered" = `getClientRects().length > 0 && !disabled`.
- Global `document.addEventListener('keydown')`: fire only when
  - not IME composing (`e.isComposing || e.keyCode === 229`),
  - no modifier (`!ctrl && !meta && !alt`),
  - a single printable char (`e.key.length === 1` — excludes Enter/Tab/arrows/
    Escape/Backspace/F-keys),
  - and `document.activeElement` is `body`/`documentElement` (nothing focused).
    A focused field/button/link, or a focus-trapping modal (firstrun, rm/rst/mem),
    makes activeElement something else, so the handler bails and never steals their
    keys — this one guard covers the modal cases for free.
  Then `activeComposer().focus()` **without** `preventDefault`, so the browser
  retargets the triggering character into the now-focused composer.

## Why this shape
- Focus-on-keydown-without-preventDefault lands the char: verified in Chromium
  (spike: typing "ab" with nothing focused → composer focused + value "ab").
- No existing global keydown handler does printable-key work; all others bail on
  non-Escape/non-Tab, so there is no conflict.
- JSDOM-inert: `getClientRects().length` is 0 in JSDOM, so `activeComposer()`
  returns null there and the handler does nothing — no node-test regression risk.

## Verification
- `docs/browser-checks/render-type-to-focus-3283.js` (headless, self-spawning
  sandboxed board + fixture agent; NEVER the live fleet board): drives all three
  surfaces, asserts the setup control (nothing focused first), that typing focuses
  the surface's composer AND the chars land, and a NEGATIVE arm (a focused button
  is not hijacked). Proven-can-fail: neutering the handler reds the 6 focus/land
  arms while setup + negative stay green.
- Wired into `tools/browser-checks.sh` (the self-contained for-list), indexed in
  the browser-checks README, and the reason-grep emit-site count updated (+1).

## Scope / not doing
- Not touching `#pj-say`, `#d-term-say` behavior beyond the fallback, the ladder
  media-query pair, or any existing keydown handler.
- The task-view composer (`.tk-inp`, not `.cinput`) is out of the three named
  surfaces and is deliberately not caught.

Reversible (decide-and-build, Josh reviews in the running app). PR self-mergeable
on green per the Kosmos beta ruling; addresses #3283 (non-closing).
