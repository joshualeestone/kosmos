# barelinks-7239: bare web addresses in messages are links (kosmos#7239)

## Finished looks like
In a DM and a project room, example.com, example.com/path and https://example.com are links that open in the browser
(a new window, which the Mac and Windows apps send to the system browser); notes.md, 0.7.70 and store.ROOT stay plain.

## Built
- pjBareWeb(tok): host labels ending in a known web ending (a list, not every TLD: endings that are also file
  extensions or code properties are left out: md, sh, py, app, json, info, store, page, link...), an optional port,
  path, query or fragment; the ending must be lowercase. Returns the https:// address or ''.
- pjInline (plain rows) and pjRich's token pass (DMs, the project list, the room through pjBody) link a bare address
  as they link https://, with leading "(" or emphasis and trailing punctuation kept outside. pjRich's fast path takes
  the slow path when a word is a bare address. Calls are guarded: tests lift these renderers alone.
- Code is held before linking, so nothing in a code span or block is linked; an email is not a host.

## Decided
- Opened as https:// (Josh's example is https-only), target=_blank like the #355 links. The Mac app's
  createWebViewWith sends an http(s) new window to NSWorkspace.open, the Windows app opens it in the browser: no
  native change.
- iPhone app: not changed. Its bubbles already link bare addresses through NSDataDetector, keeping web links only
  (measured: meridianworks.kosmosplus.com and example.com/path link; notes.md, 0.7.70, store.ROOT, Kosmos.app do not).
  Two small differences remain: it opens http:// (the site redirects), and it links logger.info. Weakest premise:
  that these are not worth an iPhone change on this card. Would change my mind: Josh seeing either in the app.
- A list of endings, not the full public suffix list: a full list links notes.md (Moldova) and setup.sh.

## Evidence
- web.links-everywhere: bare addresses in pjInline and pjRich, look-alikes plain, code plain, https:// control.
- render-barelinks-7239 (new, gated): a painted DM thread and a room bubble body (pjRoomBody); anchors https:// and
  target=_blank, look-alikes plain, a click opens a new window asking for the https:// address. 7 red on main.

## Review
