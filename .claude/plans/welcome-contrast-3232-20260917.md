# welcome-contrast-3232 -- installer welcome/conclusion dark-mode readability

Card #3232. Josh (2026-09-17, #chaoskosmos-design): the .pkg installer welcome text was
unreadable ("white background and white text").

## Diagnosis
`install/pkg-resources/welcome.html` and `conclusion.html` (created 2026-08-24 c578de153, never
changed since) set `body { color:#1c1b19 }` (dark text) with NO background and NO dark-mode handling.
The installer themes for dark mode (there is a `background-darkAqua.png` asset), so on a
dark-appearance Mac the dark text sits on the installer's dark pane -> dark-on-dark, unreadable.
(Josh's "white on white" is an imprecise description of same-on-same unreadable text.)

## Fix
Give each page its OWN background in both appearances so the text never depends on the pane colour:
- Add `background:#fff` to `body` (explicit light floor).
- Add `@media (prefers-color-scheme: dark)` flipping `body` to light text on a dark bg and the light
  chips (`.wait` / `code`) to a dark tone.

Belt-and-suspenders: if the installer webview honours the media query it adapts to dark mode; if it
does not, the explicit light bg still guarantees readable dark-on-light. Either way readable.

## Scope / verification
- Two files, CSS only; NOT web/index.html, so the #1720 / #2518 browser-check gates do not apply.
- The FIX is verifiable by reading (readable colour pairs in both modes); the LIVE verification needs
  a .pkg rebuild, so it rides the next cut (coordinate with the cut owner). Not a blocker for the fix.

## Weakest premise
That the macOS Installer's WKWebView renders welcome/conclusion with the system appearance (so a dark
pane can occur). The `background-darkAqua.png` asset is the evidence. Even if it does not theme, the
explicit light bg makes the change a strict readability improvement, never a regression.

Addresses #3232
