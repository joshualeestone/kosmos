# gskills-callout-4450: a light-gold "Ask your agent" note at the top of Global Skills

Card: joshualeestone/kosmos#4450. Josh, #admin 2026-09-28 19:56 CDT: "On the global skills page in
settings, I'd love to have a call out at the top possibly in our light gold that says something
like 'ask your agent "what skills should we install?"'". Routed by Splinter, claimed by Angel.

## Finished looks like
Opening Settings > Global Skills shows, under the "Global skills" heading and above its hint, a
flat light-gold note reading: Ask your agent: "What skills should we install?". It is readable
(AA) in light and dark, fits a phone width, and is a note, not a control. A browser check pins
all of that, and screenshots in both themes go to Mona.

## Decisions
- A note, not a button. Josh took the gold buttons out the same afternoon (#4407), and the card
  says so. It is a `<p>`: no role, not focusable, nothing inside to press, no pointer cursor.
- Placement: first thing under the heading (the card allows "above the heading's hint").
  Rejected above the heading: a panel over its own section title reads as a banner for the page.
- Colour: a tint of `--gold-bright` (14%) with a `--gold-edge` border at 55%, text in `--k-ink`.
  Rejected gold text: plain `--gold` is 2.25:1 on white (the stylesheet records it). Ink on the
  tint measures 7.54:1 light and 13.41:1 dark in the check.
- New class `.gs-ask` rather than reusing `.swwarn` (a warning with an icon disc) or `.dwarn`
  (untinted ink text): neither is a plain light-gold note.
- Copy is Josh's words, with the question in bold and curly quotes. No extra sentence.
- The browser check runs on the shared read-only board in tools/browser-checks.sh (the one with
  first run completed), and is listed in gated.txt, b8-board.txt (that board's roster) and the README.
- Text size matches the hint below it (.9375rem), so the note does not read smaller than the body.
- The reason-grep count is unchanged, measured: its emit lines start with a condition, the uncounted shape the #2164
  check it is modelled on also uses.

## Weakest premise
That "light gold" means a tint of the brand gold rather than a solid pale-gold fill. Mona owns
the look and may prefer another strength; the tint percentage is one number to change.

## Verified
- Browser check: 38 PASS, 0 FAIL across light/dark x desktop/phone, plus the contrast-helper
  control. Negative control: with the note's line removed, all four runs report FAIL.
- Screenshots (headless) in all four combinations looked right by eye.
