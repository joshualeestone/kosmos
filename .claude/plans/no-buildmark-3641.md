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
- render-talk-fill-2622.js A1n (found while running it here, not part of the removal): the Chromium
  precondition required a 15px gutter reservation on a page that does not scroll, which only holds with
  classic scrollbars. This Mac is on Automatic with no mouse (overlay): measured element scrollbar 15px,
  root reservation 0, and the check went red on main although the header held still. It now accepts 0
  or 15 and prints a NOTE that the edge arm is a guard where it is 0. Kept in this PR because this PR
  already edits the file and the .93 cut runs this check on this Mac.
- server.js / server.sourcechannel-2066.test.js: comments only; sourceChannel stays (the federation
  gate reads it).

## Rejected
- Leaving the element hidden: a hidden element is a removal waiting to be undone by a style change.

## Weakest premise
That nothing outside web/index.html renders the marker (the native app's WKWebView shows the page;
the Swift side draws no version badge). Checked by grep: no "beta build" in native-app/.

## Gates
Removing the #3497 Talk-view override deletes a line naming d-sec-talk, which
render-agentpage-fullwidth-2012 declares; that check is not stale (the line only positioned the
marker), so the commit carries its Browser-check-surface override trailer. render-build-marker-2066
carries no surface annotation (an absence has no live id; the coarse gate covers it).
