# homer-win-crossport-6916: the board window's session never goes to another port on this computer

**Posture:** production

Card: kosmos#6916.

## Problem (measured on the Windows box, served 0.8.15 `Kosmos.exe --window`)

The window's web profile keeps the board's session cookie, scoped to the host (127.0.0.1) and not the port. `SameSite=Strict` does not help: another port on the same host is the same site. Rig `work/trial-6916/rig.js` (adapted from the #6882 rig): a stand-in board speaking the real proof and sign-in protocol, and a second listener on another 127.0.0.1 port. Once signed in, the board page started a `fetch(..., {credentials:'include'})`, an `<img>` and a `location.href` navigation to the other port. **All three reached it carrying the session cookie.** The real board's main page sets no CSP (server.js sets one only on file previews), so nothing on the page side stops fetch or img. `NavigationStarting` cannot stop it: WebView2 has sent the request by then (#6882).

Why it matters: agents run dev sites on 127.0.0.1 ports and post links to them; a click in the window handed that site, and the agent behind it, the person's board session.

## Change

- `KosmosLauncher.RefusedLoopbackRequest(address, port)`: true for any request to this computer (`localhost`, or an IP that `IPAddress.IsLoopback` says is loopback: every 127.x and ::1) that is not the board itself (`http` on the board's port). Any scheme: the cookie has no Secure flag, so https gets it too.
- `ControllerReady`: in every mode (challenge review 1: a connect window can switch to running this computer's board while open, via RunAgentsHere or PageChoseMode, and loads it in the same view; a connect window never keeps anything from this computer in the window, since its page is https://login.kosmosplus.com and ConnectLinkDecision keeps only that and the board's own address in-app, so the check costs it nothing), `add_WebResourceRequested` + `AddWebResourceRequestedFilter` for `*127.0.0.1*`, `*localhost*` and `*[::1]*` (ALL contexts) before any page loads. Challenge review 4 narrowed this from `"*"`: WebView2 holds a filtered request's body, so `"*"` slowed a connect window's uploads to its board elsewhere for nothing. Substrings, not host patterns: an address with a user part still matches, and Chromium writes `127.1`, `2130706433` and `0x7f.1` as 127.0.0.1 before the filter sees them. Measured: all three leak the session with the original exe and are blocked with the filters; redirects to 127.0.0.1 are still blocked. A refused request gets a local 403 made by `ICoreWebView2Environment.CreateWebResourceResponse`, so it never leaves. If the hook cannot be wired, the window closes before anything is shown and the board opens in the browser (CouldNotHost); it never carries on without the check.
- The handler refuses a request it cannot read. One path is not closed: if making or setting the 403 itself throws (twice, since the catch tries once more), nothing is left to answer the request with, and it goes out. That needs WebView2's own response factory to fail. The wiring now makes one throwaway refusal, so a factory that does not work at all closes the window before anything loads (challenge review 5; review 3 first named this path). What stays open is a factory that works at start and fails later, for one request.
- Each request's COM wrappers (`args`, `request`, `refusal`) are released at once (`Marshal.ReleaseComObject`), since every request the board page makes now passes through.
- COM: `ICoreWebView2` extended through `AddWebResourceRequestedFilter`; `ICoreWebView2Environment.CreateWebResourceResponse`; the handler, args, request and response interfaces. All ids and slot orders checked against WebView2.h (1.0.4191.47 header in `work/scratch-6882/wv2sdk`).
- `Kosmos.exe` rebuilt with the pinned csc and flags, signed (Kosmos Agent Manager, Inc., timestamped), and `verify-launcher.ps1` OK, in the same PR (#6512).
- README: one bullet under the window's behaviour.

## Tests

- New `tools.win32-launcher-crossport-6916.test.js`. Source checks (every platform): wiring, ordering, no mode gate, the three this-computer filters (and no `"*"`), fail-closed paths, and COM slot order. A probe compiled beside KosmosLauncher.cs (Windows only) runs `RefusedLoopbackRequest` over the board, other ports and schemes, IPv6, 127.x and non-loopback hosts.
- `tools.win-launcher-native.test.js`: its WebView2 interface table gains the new interfaces and slots.
- Live: the rig against the signed build shows fetch 0, img 0 and navigation 0 requests reaching the other port; same-folder control with the original exe: all three YES; the board's own requests still go with the session.

## Measured in challenge review 2 (rig variants in work/trial-6916)

- **Long addresses (BLOCKER, fixed):** .NET Framework's `Uri` will not parse an address over about 65,500 characters, and Chromium sends up to 2 MB. The first version let an unparseable address through. A control against that code confirms it: a 70k `http://127.0.0.1:3000/?...` was not refused. Now an unparseable address is read by where it goes (`scheme://host:port`). Whatever still cannot be read is refused, except the window's own `about:`, `data:` and `blob:` pages.
- **Redirects:** `rig-redirect.js` runs a listener on this computer's LAN address that answers 302 to `http://127.0.0.1:<other>/`. With the original exe (control), the redirected img and fetch reached the other port WITH the session cookie. With the fix: 0 and 0. So WebResourceRequested sees redirected requests, and they are refused too. (The redirected navigation did not arrive in either run: NavigationStarting cancels it.)
- **Upload cost (accepted):** `rig-upload.js` sends a 50 MB POST from the page to the board. It took 110 ms and 139 ms with the original exe, and 753 ms and 710 ms with the fix: WebView2 buffers a filtered request's body. The filter cannot leave out the board's own port (its patterns are wildcards, and the board is on the same host), so every board upload pays this (still about 0.9 s per 50 MB with the narrowed filters, since the board is on 127.0.0.1). A connect window's traffic elsewhere no longer pays it. A 100 MB attachment takes about 1.5 s instead of about 0.3 s. Accepted for the session never leaving.
- **A clicked link to a dev site still opens in the person's browser:** NavigationStarting still runs for a refused navigation. In every fixed run the window kept showing the board page, not the 403. That is NavigationStarting cancelling it, the same decision that sends a clicked link to the browser (ConnectLinkDecision: Browser). Not driven with a real click, to avoid opening tabs in the person's browser on this box.

## Measured in challenge review 3

- **A page controlled by a service worker** (the real board installs `web/sw.js` over its origin). `rig-sw.js` registers a pass-through worker shaped like `sw.js` (other origins: no `respondWith`, so the request falls back to the network), reloads until the page is controlled, then starts the same requests. With the original exe (control): fetch, img and navigation all reached the other port with the session. With the fix: 0, 0, 0. So the worker's network fallback is seen by WebResourceRequested and refused.
- **The board's own media and downloads still work through the hook** (`rig-board.js`, a stand-in board): a `Range: bytes=100-199` fetch gets its 206 with exactly 100 bytes, and an `<a download>` request reaches the board with the session. Both are identical with the original exe and with the fix. Not driven against the real served board's previews and attachments: the release V2 check on the staged build exercises the real window against the real board.
- **Other spellings of this computer** (`foo.localhost`, `::ffff:127.0.0.1`, `0.0.0.0`) are not refused, and need not be: the cookie is host-only on 127.0.0.1 and is never sent to them. The code comment says so.

## Measured along the way

- .NET Framework's `Uri.Host` spells `[::1]` in full (`[0000:...:0001]`), so loopback is decided by parsing the address, never by comparing text. (`IsBoardAddress` compares text, so it never matches an IPv6 board address; out of scope here, and the board is loaded at 127.0.0.1.)

## Rejected

- Stripping the Cookie header in the hook: WebView2 adds cookies after this event, so it is not reliably there to strip.
- A per-board host name (`<x>.localhost`): it scopes the cookie properly, but it changes the board's URL, origin checks and sign-in everywhere, for the same result.
- Carrying on without the check if it cannot be wired: that would turn a security check into a silent no-op.

## Weakest part

1. **WebSocket connections are NOT covered (measured), and that is a real leak, carried to a follow-up card.** With the signed fix, a page-started `new WebSocket('ws://127.0.0.1:<other>')` still reached the other port with the session cookie on its handshake; WebResourceRequested never sees it. Opening one needs script running in the board's own page. The vectors that need none are a clicked link (navigation) and an image or other resource in content an agent posted, and both are covered. An earlier version of this plan said such script "holds the session anyway". Challenge review 7 showed that is wrong: the cookie is HttpOnly (engine/boardauth.js), so page script can use the session while the page is open but can never read the token. A WebSocket to another port hands the token itself to another process, which can keep and reuse it. The fix is to block ws/wss to this computer's other ports in the browser itself (DevTools `Network.setBlockedURLs` through `CallDevToolsProtocolMethod`, async, with its own completion handling). It is left out of this change because the change stopped at the fleet's 8-round review cap; it is a separate card. A document-created script guard was rejected: the script it guards against can get around it.
2. **Worker requests.** `AddWebResourceRequestedFilter` covers requests from documents only. Service-worker and shared-worker requests need `ICoreWebView2_22` with `SOURCE_KINDS_ALL` (challenge review 1). No hole today: `web/sw.js` passes on (returns early for) every fetch whose origin is not the board's own, and a page request the worker passes on is seen and refused (measured, rig-sw.js). `tools.win32-launcher-crossport-6916.test.js` fails if `web/sw.js` stops passing on other origins before it answers anything, the one change that would move such a request out of the hook's sight (challenge review 6).
3. **The UI thread.** Every request that names this computer, the board's own included, is decided on the window's UI thread (challenge review 6). While OnNavigationStarting blocks that thread in CheckBoardBeforeReuse (up to ReuseQuickCheckMs, 1.5 s), board fetches, images and the event stream queue behind it, which they did not before. Small, and only during a re-check.
4. **A refusal that cannot be made later, for one request.** If WebView2's response factory works at start (the wiring makes a throwaway refusal) but later throws, or returns S_OK with no response, for one request, the handler's retry fails the same way and that request goes out. Nothing is left to answer it with (challenge reviews 3, 5, 7).
