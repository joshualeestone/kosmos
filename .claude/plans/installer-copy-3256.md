# installer-copy-3256 -- Setting-up + Summary screen copy + dark-mode white-on-white

Addresses #3256. From Josh in #chaoskosmos-design, 2026-09-18, on the shipped 0.6.77 installer.

## Intent

Two installer pages, both bundled in the payload-free .pkg (which release.sh rebuilds and ships with the app cut):

1. `install/pkg-resources/welcome.html` (the "Setting up Kosmos" / Introduction pane): rewrite the copy to Josh's exact text AND fix the dark-mode white-on-white he still sees.
2. `install/pkg-resources/conclusion.html` (the "Kosmos is ready" / Summary pane): replace the three-paragraph body with Josh's exact two lines.

## Verbatim copy (Josh; build it verbatim, do not reword)

welcome.html:
- Headline: `Setting up Kosmos` (unchanged; Josh kept it)
- Body (line breaks between the three sentences):
  - `The latest version of Kosmos will be downloaded and installed.`
  - `This may take a minute or two.`
  - `When setup is complete, the Kosmos app will open automatically.`

conclusion.html:
- Headline: `Kosmos is ready` (unchanged; Josh quoted only the body)
- Body:
  - `Kosmos has been installed successfully and should open automatically.`
  - `If it doesn't open, you can find Kosmos in your Applications folder.`

## The white-on-white fix, and why it is by construction (not another media query)

#3232 gave both pages `<meta name="color-scheme">` + a `@media (prefers-color-scheme: dark)` override. Josh's dark-mode screenshot (0.6.77, with #3232 shipped) proves the macOS Installer webview does NOT reliably honour that media query: the `.wait` callout kept its explicit light background (`#f3f1ec`) and its text went white-on-white, while the plain paragraphs above/below it (no explicit background) rendered light and readable because the installer force-lightens un-backgrounded text.

So the readable-vs-broken split is exactly "no explicit background" vs "explicit light background". The fix removes every explicit-background element:
- welcome.html: drop the `.wait` callout div and both its rules. Josh's new copy has no callout anyway.
- conclusion.html: drop the `code` rule (unused by the new copy).

The remaining CSS (body light floor + dark override, meta opt-in) is kept identical to #3232 because the screenshot proves it is compatible with readable text (the shipping file has it and the plain paragraphs read fine). But nothing now depends on the media query firing: every line is a plain h1/p with no explicit background, so it renders like the paragraphs that already read correctly, whether or not the webview honours prefers-color-scheme.

## Verification

- Guard `web.machine-absence-claims.test.js` (reads welcome.html) passes; the new copy makes no machine-absence claim and uses no "Mac"/"computer".
- No em dashes.
- No served-marker pins the old welcome/conclusion copy (checked served-markers.json).
- Headless renders (light + forced-dark) confirm the copy and clean layout in both appearances.

## Verification boundary (self-disclosed)

I cannot run the .pkg in dark mode from a bot session, so I cannot certify the real macOS Installer render. #3232's media-query approach looked right and shipped and still failed exactly this way. This fix rests on Josh's own screenshot (which proves un-backgrounded text force-adapts), not on an untested media query -- a stronger footing -- but the true visual confirmation is Josh on the next .pkg cut. Real-installer confirmation rides that cut.

## Not in scope

- The installer's own chrome (top-bar "Welcome to the Kosmos Installer", the left step list) is macOS Installer / Distribution, not these HTML files. Josh gave exact copy only for the headline + body, so that is what changes.
- The two technical errors Josh reported (installer not launching the app; "installed for another user" + blank window) are engine install-flow, routed to Splinter as #3254 and #3255. Not this PR.
