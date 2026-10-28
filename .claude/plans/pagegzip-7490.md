# pagegzip-7490: the board sends its page compressed

Card: joshualeestone/kosmos#7490 (found in #7489: Josh's New Project form took over a minute on his phone).
Owner: PigeonPete. Decision and measurements are on the card.

## Problem
`GET /` (web/index.html, about 5.8 MB, stamped per request) is sent with no content-encoding even when the
request accepts gzip and br. Over Kosmos+ it crosses the tunnel and the relay to a phone.

## Where compression belongs: the board, the page only
- The relay cannot: the tunnel ends TLS on the computer, so the relay only carries encrypted bytes.
- The tunnel's proxy passes Accept-Encoding and Content-Encoding through untouched (drops only hop-by-hop
  and Host), so the board's encoding reaches the phone with no relay change.
- Only the page: API answers carry caller text beside tokens and tickets (BREACH). Same rule the relay keeps.

## Build
- `engine/pagecompress.js`: `pickEncoding` (br, then gzip; q=0 refuses; `*` counts), `makePageCompressor`
  (one-page cache keyed on the exact served bytes, since the page is re-read and stamped per request, #271),
  `sendPage` (vary: accept-encoding always, content-length, HEAD without body, falls back to plain if
  compression fails).
- `server.js` page route uses it.
- Brotli quality 9 (about 0.25 s once per page content; 11 costs 6.8 s for 130 KB more).

## Tests
- `server.pagecompress-7490.test.js`: real server over node:http (fetch decompresses on its own): plain
  when not accepted, br and gzip decode to the plain page byte for byte, HEAD, /api/health stays plain,
  pickEncoding cases, the cache recompresses a changed page and not an unchanged one.
  Also pins `pageCompress.sendPage` to exactly one call site, inside the page route (BREACH is structural).
- Source-reading tests that moved with the change: `web.win32-board-copy.test.js` (the stamped page is what is
  sent), `web.stale-page.test.js` (the page still says no-store), `engine/win32-separator-guard.test.js` and
  `engine/windows-coupling-audit-1732.test.js` (a classified row for the Accept-Encoding `split(';')`).

## Measured (sandboxed boards, Chromium, network throttled, 4x CPU)
4G 9 Mbit/s: 5.7 s before, 2.0 s after. Slow 4G 1.6 Mbit/s: 30.0 s before, 9.2 s after. Parse after the
last byte is 0.2 to 0.4 s, so the time was the download. Over Kosmos+ itself: after the release.
