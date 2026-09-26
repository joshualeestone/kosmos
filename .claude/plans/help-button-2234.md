# #2234 (app half): the help link on Add a provider

## Finished looks like
- Settings, AI Models, Add a provider shows, under the Provider picker, Josh's words verbatim:
  "Help - I'm confused about selecting a provider", linking to https://installkosmos.com/help/connect-provider
  in a new tab. That URL is stable; the site redirects it to the current help (a written page now,
  a video later; chaoskosmos-site branch help-links-2234), so changing the help needs no release.
- The page's own quiet button (readable in light and dark), no new colours.
- render-provider-order-3651 asserts the words, the placement, that it shows with the dialog open,
  the URL, and the new tab.

## Calls (recorded on #2234)
- One context first (connect a provider). Other screens get a link when their help exists.
- A button, as Josh asked ("help button"): an <a> in the page's quiet-button style, since it opens the
  browser; a screen reader hears "(opens in your browser)".
- Weakest premise: the site half must be live before the button helps anyone. Merge the site PR
  (chaoskosmos-site help-links-2234) first so both ride the same release cut, then confirm
  /help/connect-provider answers 307 to the page.
