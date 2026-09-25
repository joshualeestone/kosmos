# plus-wizard-3796: the in-app Kosmos+ sign-in wizard matches login.kosmosplus.com (kosmos#3796)

Josh, 2026-09-25 13:57 and 14:00 (his words are on the card). Settings, Kosmos Plus, state 2 (the wizard).
- Card: the site's card (26rem, 2rem padding), vertically centred in the settings content area on every
  step. The area is only as tall as its content, so plusSiMeasure writes the room from the section's top to
  the window's bottom into --plus-avail; CSS applies it (min-height, centred) only while state 2 shows (:has).
- Email step: "Sign in to activate Kosmos+"; the "You have Kosmos+..." line removed; label "Enter your
  Kosmos+ account email address"; the field 75% wide.
- Code steps: one short line ("We sent a code to <email>."); a compact, centred, monospace six-digit field
  (12ch, one-time-code, numeric); the visible label kept for screen readers only; a Kosmos+ blue primary;
  resend as a small "Didn't get it? Send again" link (held with aria-disabled during the cooldown).
- Fields: the site's dark field (#16223e, #5c78a6 edge, light ink, coral error border) in the wizard only;
  the enrol flow (#plus-flow) keeps #3596's white field. Secondary buttons get a 1px stroke.
- "Not now" becomes "Sign out", and it signs out: POST /api/remote/signin-cancel -> remote.signinCancel()
  drops whatever the engine holds (session token, phone challenge, enrol-only token); the fields clear.
Tests: engine (cancel drops all three kinds, with a control), server route (register refused after cancel),
a page test for the link's countdown hold, and render-plus-signin-3478 / render-plus-blue-1615 arms.
