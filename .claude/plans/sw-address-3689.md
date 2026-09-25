# sw-address-3689: the board's notification tap opens only a sibling Mac

Card: kosmos #3689, the BOARD half (`web/sw.js`). The coordinator half (kosmos-relay
`coordinator/src/sw.js`) is Ice Cream Kitty's. Owner: Johnny Cage.

## Finished means
- A push whose `address` is not exactly one host label under the board's own domain opens this
  board (`/`), not the address. `evil.example`, a two-deep name, punycode, and our domain used as a
  prefix are all refused; a host one label under the domain (`<mac>.<domain>`) and this Mac itself
  open.
- A board with no relay domain (localhost, an IP address, a two-label host) opens itself on every tap.
- The label rule is the iOS app's (`PushBridge.isHostLabel`: RFC 1123, no `xn--`), with a domain of
  at least two labels. This keeps a tap on Kosmos-owned hosts; it does not prove the host is one of
  this person's Macs (another person's Mac or a service host like `login.<domain>` has the same
  shape). Two differences from iOS's `isMacHost`: the domain comes from the worker's own host, and
  the coordinator host is not excluded, since the board does not know it.
- web.sw-718.test.js pins both arms; each part of the rule has a mutation that turns it red.
- docs/browser-checks/render-push-718.js, whose board runs on 127.0.0.1, now expects the tap to open
  the board itself.

- Rebased onto Kano's #3696 (main b852201c), which added the agent query to the same function
  (Liu Kang m679): the host is decided first, then `?tab=detail&agent=<session>` goes on whichever
  base that leaves. An allowed host plus a session opens `https://<host>/?tab=detail&agent=<s>`; a
  disallowed host plus a session opens `/?tab=detail&agent=<s>` on this board. Both are tested.

## Decisions
- **Sibling of the worker's own host, not a pinned address.** The card offered two fixes: a suffix
  allowlist for the Kosmos domain, or pinning the address the subscription was made for. The board
  does not know "the Kosmos domain" as a setting, but the worker runs on `<mac>.<domain>`, so its own
  parent domain is that domain for this board, including a nonprod relay. Pinning to this Mac alone
  was rejected: a push about another of the person's Macs is legitimate and would lose its target.
- **Dormant today.** Nothing subscribes on the board's origin (the subscribe flow was removed in
  #3510; phones subscribe on the coordinator's site), so no one sees a behaviour change now. This
  keeps the handler safe if a board-origin subscribe comes back.
- **The browser check keeps its payload** (`study.kosmos.example`) and now expects `/`: on 127.0.0.1
  that is the right answer, and the title and body still tell the mapped notification apart from
  the old payload reader. The Mac click-through is pinned in the node test.

## Weakest part
The node test drives `boardUrlFor` with a stub `self.location`; the real worker's `location.hostname`
is what a browser gives it, which the browser check only exercises for 127.0.0.1. A board on a real
`<mac>.<domain>` host with a real push has not been run here.
