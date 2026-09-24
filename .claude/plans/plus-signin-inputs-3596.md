# plus-signin-inputs-3596: readable fields in the in-app Kosmos+ sign-in wizard

Card: kosmos#3596 (Josh, 0.6.91 staging QA, 2026-09-24 10:17 CDT). Screenshot:
~/.cache/claude-handoffs/josh-qa-0691-2026-09-24/9.55.01-signin-email-field.png

## Cause (measured, computed styles in the real page)
The Kosmos+ skin (body.plus-active) sets light ink for its navy ground. `.tk-inp` takes its
text colour from that ink (rgb 230,235,247), while in the light theme its field stays white.
Typed text was near-white on white. In the dark theme it was light on a dark field. It
applied to all 7 wizard inputs (email, both codes, phone, secret, enrol code, name). The
button row sat flush against the email field (gap 0px).

## Change
A rule scoped to #plus-state2 (the wizard): every text input is #14161a on #ffffff, in every
theme, with a matching caret, placeholder and -webkit-text-fill-color (WebKit paints an
autofilled value with it). `.field + .frow` gets the standard gap above a button row.

Rejected: changing `.tk-inp` or the skin's ink globally. Both are shared by other surfaces
with their own contrast checks, and Josh's ask is this wizard.

## Evidence
docs/browser-checks/render-plus-signin-3478.js gains #3596 arms: every #plus-state2 input is
dark ink on a light field in light AND dark, with a control that the inputs are found (7),
and the field-to-button gap is at least 8px. All scenarios pass (12px gap). With the
pre-fix page swapped in, it fails with Josh's exact colours: rgb(230,235,247) on white, gap 0.

## Weakest premise
Josh said "black text on a white background". I read that as right for both themes, so the
wizard's fields are white even under the dark theme. If he wants dark fields in the dark
theme, that is this one rule.
