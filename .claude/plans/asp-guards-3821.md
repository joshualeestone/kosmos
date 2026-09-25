# #3821 guards: two check arms for the open guide chat's place

#3834 (tmnt-windows) merged the fix for #3821 first. My PR #3835 had the same change and is closed as superseded.
Its two check arms cover cases #3834's own arms (B3, B17) do not, and they pass against #3834's code.

## Finished looks like
render-assistant-bubble-3034 fails if:
- B31: on Settings, with a wide control in the bottom band (Josh's "+ Add a provider"), the open chat's bottom-right
  is not the bubble's, or its top runs under the header, at 1520x858, 1280x720 or 1280x1200. CONTROL: the folded bubble
  keeps one corner, 16px from the bottom (the right offset depends on whether this machine draws a scrollbar).
- B32: a chat opened on an agent's page (the bubble lifted over Send) does not come down to the corner when the page
  under it changes to Settings.

## Negative controls (measured on #3835's equivalent code)
The old panel lift fails B31 (the chat 174px up); measuring the bubble only while it shows fails B32 (it stays at 80).

## Verification
81 pass against main with #3834.
