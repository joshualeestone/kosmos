# welcome-copy-breaks -- installer setup copy: blank line between the three lines

Josh's small installer tweak (2026-09-18, #chaoskosmos-design): "add some breaks on this copy
currently they do break to the next line but i would like there to be a space between lines."

## Change (install/pkg-resources/welcome.html)
The three setup lines were a single `<p>` joined by `<br>` (line breaks, no vertical gap). Split
into three separate `<p>` elements so the page's existing `p { margin: 0 0 12px }` rule renders a
blank-line space between them. That is the whole change.

## Constraints honored
- Copy is VERBATIM, unchanged (Josh's copy is verbatim; no rewording).
- Dark-mode by-construction fix (#3256) holds: no element sets its own background, so all three
  paragraphs adapt to the installer's dark pane like the plain paragraphs already did. Rendered
  light + dark to confirm the spacing and the dark readability.
- The macOS Installer webview does not reliably honour prefers-color-scheme, which is exactly why
  the fix is by construction (three plain paragraphs) rather than any new styled element.

## Weakest premise
That "space between lines" means paragraph spacing (a blank line), which is what the render shows.
If Josh wants a larger gap, it is a one-value change to the `p` margin.
