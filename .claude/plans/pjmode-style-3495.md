# #3495: restyle the new-project page's Create / Join toggle

Josh, 2026-09-24 17:50 CDT (#admin 1552814526875967551), after testing 0.6.92 staging: "I dig the
functionality for creating a project and joining an external project but this is hideous. It looks
like a wireframe. This doesn't match anything graphically on the site... It's basically almost like a
segment controller... It should just match our styling better." Behaviour approved, look rejected.

## Finished looks like
The Create a project / Join an external project control is the app's own segmented control: the
.laypick / .viewtoggle values (0.5px separator border, radius-control, elevated ground), the chosen
side gold (--gold-bright) with #14161a ink in light AND dark, two equal halves spanning the form's
width on their own row below "All projects". The fields under it have no rules between them, as in
Project settings. Behaviour is unchanged: native radios in a fieldset, arrow keys, the Plus gate on
Join. Before/after screenshots posted to Josh in #chaoskosmos-design 18:57.

## Decided
- Gold for the chosen side, not ink. The old comment said ink so it would not compete with the gold
  Create project button; Josh's 2026-08-17 "selected is gold" ruling outranks that, and the ink fill
  flipped to white in dark mode, which inverts what "selected" means. Rejected: keeping ink.
- No bounding box around the form. Josh's #750 ("just like the new agent", no bounding box) still
  stands; the wireframe look came from the toggle and the rules, not from a missing card.
- 14px semibold labels, 36px tall: one step up from the 13px body because it is the screen's
  top-level choice, far smaller than the 17px bold it replaces.

## Weakest premise
That removing the field rules is part of "match our styling" rather than a change Josh did not ask
for. It matches Project settings (#750), which he did ask for, and it is one CSS rule to put back.

## Verification
docs/browser-checks/render-pjmode-style-3495.js, light and dark: gold chosen side with #14161a ink,
unfilled other side, equal halves, spans the Name field width, own row below All projects, hairline
border, no rule on any create field, and Join takes the gold after switching. Against main's
pre-restyle page 16 of its 20 assertions fail. Existing: render-fed-plus-gate and the three unit
tests that read .pj-mode (web.fed-plus-gate, web.add-project, web.federation-3312) pass.
