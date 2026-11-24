# webfollow-8966: what #8953's review left for the iPhone web-page viewer (kosmos#8966)

## Done on this branch
- Item 3: Board.bareType. isWebDocument, webFileKind and fileName read a MIME type without its parameters, so
  "text/html; charset=utf-8" is a page by type as "text/html" is, and such a file opens in WebFileView (saved as
  x.dat.html). savedName is left as it is (it names every file; out of this card's scope). Logic tests: the old check that
  pinned the parameter case as "not a page" is rewritten to the new rule; a control that a parameter naming a page does not
  make a PDF one.
- Item 4: didFail and didFailProvisionalNavigation route to the can't-show card. A navigation the delegate cancelled
  (NSURLErrorCancelled, WebKit 102 "frame load interrupted") is not counted, so the page's own refresh and frames, which
  are cancelled on purpose, do not flip a good page (WebFileUITests passes with them on the page).
- Item 1: WebFileUITests' fixed sleeps replaced by Probe.stays(at:for:), which watches the connection count through each
  window and fails on the first connection. A window is still needed: "nothing came" can only be shown over time. The
  settle sleeps before screenshots are gone. Control arm (content rule off): the test fails at the first window.

## Not done here, and why
- Item 2 (Content-Disposition over the relay path): needs a phone opening a web page through the relay. Left on the card
  for a device check after this merges.
- The small edges (a UTF-8 cut at 256 KB can end in one replacement character; the HTML card's word "Text" mirrors the
  board's pjFileWord) are left as they are, as #8966 itself says.

## Weakest premise
That NSURLErrorCancelled and WebKit 102 are the only codes a deliberately cancelled navigation reports. If another code
appears, a good page would show the can't-show card; WebFileUITests (refresh and frames on its page) is the guard.

## Tests
- ios/LogicTests/run.sh PASS 2257/2257 (bareType and fileName checks).
- WebFileUITests passes on iOS 27 with all three changes; control arm fails as it should.
