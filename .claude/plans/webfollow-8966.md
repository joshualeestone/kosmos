# webfollow-8966: what #8953's review left for the iPhone web-page viewer (kosmos#8966)

## Done on this branch
- Item 3: Board.bareType. isWebDocument, webFileKind and fileName read a MIME type without its parameters, so
  "text/html; charset=utf-8" is a page by type as "text/html" is, and such a file opens in WebFileView (saved as
  x.dat.html). Logic tests: the old check that pinned the parameter case as "not a page" is rewritten to the new rule; a
  control that a page type after the ';' ("text/plain; x=text/html") is a parameter, not the type.
- Item 4: didFail and didFailProvisionalNavigation route to the can't-show card: not for a navigation the delegate
  refused (Board.isDeliberateCancel: NSURLErrorCancelled, WebKit 102 "frame load interrupted"; domain-exact), and not once
  the page has drawn (every later navigation is one the delegate refuses). The page process ending draws the page again if
  it had drawn since the last time (iOS ends a background app's page process to free memory, and can do it each time the
  app is away), at most WebPageState.maxRedraws (3) times so it cannot loop; before a draw, the card. All of it is
  Board.WebPageState, a value the coordinator only reports WebKit's events to, stepped by the logic tests. WebKit's own
  side (that the content rule applies to a restarted page process, that the error codes are these) is not driven by any
  test: a UI test cannot make WebKit fail or end its process on demand.
- The same bare-type reading for savedName, fileWord, isPreviewableImage and fileAnswerAccepted (review round 1): a file
  typed "application/pdf; charset=binary" is saved as report.pdf. A malformed ";text/html" (any number of leading ";") reads as text/html, the safe
  side for both the viewer and the fetch gate (review round 2).
- Item 1: WebFileUITests' fixed sleeps replaced by Probe.stays(at:for:), which watches the connection count through each
  window and fails on the first connection. A window is still needed: "nothing came" can only be shown over time. The
  settle sleeps before screenshots are gone. Control arm (content rule off): the test fails at the first window.

## Not done here, and why
- Item 2 (Content-Disposition over the relay path): needs a phone opening a web page through the relay. Left on the card
  for a device check after this merges.
- The small edges (a UTF-8 cut at 256 KB can end in one replacement character; the HTML card's word "Text" mirrors the
  board's pjFileWord) are left as they are, as #8966 itself says.

## Weakest premise
That NSURLErrorCancelled and WebKit 102 are the only codes a deliberately cancelled navigation reports BEFORE the page has
drawn. After didFinish nothing counts, so the page's one-second refresh no longer tests the codes; WebFileUITests guards the
drawn path, and the codes themselves are pinned only by logic tests. A cancelled navigation before the first draw would show
the can't-show card if it reported another code.

## Tests
- ios/LogicTests/run.sh PASS (count in the proof file); a mutation (WebPageState.processEnded without its started reset) fails a check.
- WebFileUITests passes on iOS 27 with all three changes; control arm fails as it should.
