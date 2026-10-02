# #4979: Settings' nav pills no longer slide under the app header

**Done looks like:** on the Settings tab, every section, scrolled anywhere, at any desktop width and
with either layout saved, every nav pill sits below the app header and a click on the first one lands
on it while the nav is stuck; when the window is too short to hold the whole nav below the header
(including a header grown by a bar or a notice), the nav scrolls with the page instead of hiding
pills; and in the consolidated view (Settings opened from the user menu, inside Projects) the nav
sticks where it did before.

## Cause
`.snav { position: sticky; top: 16px; }` (#350). On the Settings tab the app header (`.apphead`) is
sticky at the top too and drawn above the page (z-index 20), so the stuck nav sat under it. Found
while fixing #4961 (c).

## Change
- web/index.html CSS: `body:not(.consolidated) #s-nav { top: calc(var(--apphead-h, 0px) + 16px); }`.
  Unmeasured, it is the old 16px. Not in the consolidated view (body.consolidated): Settings is its
  own scroll box inside Projects there and the header is static, so the nav keeps its 16px from the
  panel's top. Below 56rem `.snav` is static, so a phone is unchanged.
- `html.snav-loose body:not(.consolidated) #s-nav { position: static; }`: when the whole nav does not
  fit below the header, it scrolls with the page.
- One small script beside the #s-nav click handler measures the header's and the nav's border boxes:
  it writes the header's height into `--apphead-h` and sets `snav-loose` on the root when
  header + nav + 32px is taller than the window. Observers on both boxes and a window resize
  recompute it, so a header that wraps, or gains the Kosmos+ bar or an update or offline notice,
  is followed. It skips anything without a real numeric size (two web.* harnesses run the page
  against a stub document).
- docs/browser-checks/render-snav-head-4979.js (+ README row, gated.txt).

## Rejected
- A fixed top (51px + 16px): the header is 77px at 900px wide, where it wraps, so a fixed value still
  hides the first pill there (measured, both engines, with either layout saved).
- A fixed short-window threshold (`@media (max-height: 35rem)`, an earlier round of this branch): the
  header grows with the Kosmos+ bar and with notices, so a fixed height still let the nav hide pills
  on taller windows (the +100px header arms red on it, measured).
- `max-height` + `overflow-y: auto` on the nav: any overflow but visible clips the pills' focus rings
  at the nav's edges on every window, a keyboard regression.
- Making the Settings nav static like the agent page's (#4961 c): Settings has nothing below its nav,
  so a sticky nav costs nothing there once it clears the header.
- Zeroing the offset from the script when the header is not sticky: the header's position flips with
  the body class, which no resize reports, so the CSS keys on the class instead.

## Evidence
- Header height on the Settings tab, measured: 51px at 1100, 1440 and 1800px wide; 77px at 900px;
  the same with either layout saved, on both engines. The nav is 434px tall (11 pills).
- Consolidated view, measured on main: the nav sticks 40px below the panel's top (24px padding + 16)
  at the top and scrolled to the end. An unscoped offset moved it to 91px and 70px.
- The check, with the change: all pass (109 PASS lines, re-measured after the last arms).
- Controls, each measured red in exactly its arms: main (32, the Settings-tab placement and click
  arms, no consolidated arm); an offset not scoped to body:not(.consolidated) (the 4 consolidated
  arms); a fixed `top: 67px` (the 900px arms); no ResizeObserver (the 2 resize arms); the fixed 35rem
  threshold instead of the measured fit (the 4 header +100px arms); no fit rule at all (the 8 short-
  window and the 4 header +100px arms).

## Weakest premise
That the app header is the only thing drawn above Settings at the top. A new sticky bar between the
header and the content would need its height added. And that `body.consolidated` is the only state
where the header does not stick above Settings: the agent page's Talk view also makes it static, but
#s-nav is not on that page.
