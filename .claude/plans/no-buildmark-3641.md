# #3641: remove the corner "beta build" marker

Josh, 2026-09-24 16:06 CDT, #admin: "lets just kill the Beta Build line.. you can still get the current
version in settings". For 0.6.93 with the help work; it also frees bottom-right for the assistant bubble
(#3034).

## Finished looks like
No view, Mac or Windows, tab or consolidated layout, board or agent page, shows the corner version
marker. The version still reads in Settings > Updates (#build). Checks that asserted the marker now
assert its absence, with the Settings line as their control.

## Changes
- web/index.html: the #buildmark element, its CSS (and the #3497 Talk-view override that moved it
  left), paintBuildMark() and its two calls. Comments that described it are updated.
- web.build-marker-2066.test.js: now pins the absence (element, selector, painter, the words) and the
  Settings version line's wiring (control).
- docs/browser-checks/render-build-marker-2066.js: now an absence check on a sandboxed board in both
  layouts after the status poll, with the Settings version as the control.
- render-talk-fill-2622.js: A1h (marker clear of the box) retired; A2f keeps its composer arm.
- server.js / server.sourcechannel-2066.test.js: comments only; sourceChannel stays (the federation
  gate reads it).

## Rejected
- Leaving the element hidden: a hidden element is a removal waiting to be undone by a style change.

## Weakest premise
That nothing outside web/index.html renders the marker (the native app's WKWebView shows the page;
the Swift side draws no version badge). Checked by grep: no "beta build" in native-app/.
