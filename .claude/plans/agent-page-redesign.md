# Agent view page redesign (#3385, Josh mock 2026-09-21)

## Request (Josh's "Leo Hart" mock)
Move the identity into the left column above the nav (avatar+ring, name, title, status bubble);
the name never wraps and shrinks to fit the column; drop the provider/account/model line; keep the
5 nav buttons + rule + Remove; expand the talk dialog to fill 100% of the height, flush with the
context ring. Also resolves #3382 (dialog too small). Overnight: build + merge for the morning cut,
render for the record, no okay-gate (Josh asleep, per Splinter's steer).

## Change
- Markup (ruling-safe move): `.dhead` + `#d-nav` wrapped in a new `.dleft` grid column inside
  `.dbody`, preserving every element's relative order (the #1841/#569/#986 move pattern). `#d-meta`
  (title) moved into `.dnamerow` after `#d-name` so DOM order = name -> title -> status (correct SR
  sequence, not CSS `order`). Text block got a `.dtext` class for a fixed width.
- JS: `#d-meta` simplified to the TITLE only (roleLine), dropping provider/account/model (#2833).
  The #684 machine-name disclosure is KEPT as a muted `.dmeta-note` line under the title. New
  `fitDetailName()` measures the name's nowrap width vs the column and scales `--dname-size` down
  (floor 0.55rem + ellipsis for pathological 40-char names).
- CSS: `.dhead`/`.dnamerow`/`.dtext` vertical centered; `.dbody` left column 176->220px; `.dleft`
  flex column; `.dname` nowrap+shrink+ellipsis; `#panel-detail .dhead` margin 30->16px. The 100vh
  fill chain is unchanged -- moving `.dhead` out of above-`.dbody` is what makes the talk column
  start flush with the ring and fill the height.

### Rejected
- CSS `order` to reorder name/title/status: breaks screen-reader sequence (1.3.2). Did a DOM move.
- Dropping the #684 name-disclosure: Josh only asked to drop provider/account/model; #684 is a
  ruled surface. Kept it as a muted sub-line.
- No floor on the name shrink: a 40-char name would be illegibly tiny. Floor 0.55rem + ellipsis.

### Weakest premise
- The shrink floor (0.55rem) + ellipsis means a pathological 40-char name truncates rather than
  showing fully. Realistic names fit; Josh can ask for a lower floor. Rendered both (Leo + a 40-char
  torture name) headless; both contained, no bleed.

## Verification
- Rendered the detail headless (normal + long name), dark mode: identity in the left column, title
  under the name, status bubble, notes contained, talk panel full-height. Matches the mock.
- render-detail-header-1841 (title-only #d-meta), the #2833 meta-line test (title + #684 disclosure,
  no provider/model), render-talk-fill-2622 (bigger injected question for the taller box) updated +
  passing. web.agent-nav (sectionOf d-name null still holds) + dbox-nesting green. Surface + coarse
  gates green; no em dashes.

## Files
- web/index.html - markup move + .dleft/.dtext/.dhead/.dnamerow/.dname CSS + fitDetailName + #d-meta JS.
- docs/browser-checks/render-detail-header-1841.js, render-talk-fill-2622.js - updated.
- server.test.js - #2833 meta-line test rewritten for title + #684 disclosure.
