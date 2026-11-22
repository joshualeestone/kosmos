# homer-win-crossport-6916: the board window's session never goes to another port on this computer

**Posture:** production

Card: kosmos#6916.

## Problem (measured on the Windows box, served 0.8.15 `Kosmos.exe --window`)

The window's web profile keeps the board's session cookie, scoped to the host (127.0.0.1) and not the port. `SameSite=Strict` does not help: another port on the same host is the same site. Rig `work/trial-6916/rig.js` (adapted from the #6882 rig): a stand-in board speaking the real proof and sign-in protocol, and a second listener on another 127.0.0.1 port. Once signed in, the board page started a `fetch(..., {credentials:'include'})`, an `<img>` and a `location.href` navigation to the other port. **All three reached it carrying the session cookie.** The real board's main page sets no CSP (server.js sets one only on file previews), so nothing on the page side stops fetch or img. `NavigationStarting` cannot stop it: WebView2 has sent the request by then (#6882).

Why it matters: agents run dev sites on 127.0.0.1 ports and post links to them; a click in the window handed that site, and the agent behind it, the person's board session.

## Change

- `KosmosLauncher.RefusedLoopbackRequest(address, port)`: true for any request to this computer (`localhost`, or an IP that `IPAddress.IsLoopback` says is loopback: every 127.x and ::1) that is not the board itself (`http` on the board's port). Any scheme: the cookie has no Secure flag, so https gets it too.
- `ControllerReady`: in every mode (challenge review 1: a connect window can switch to running this computer's board while open, via RunAgentsHere or PageChoseMode, and loads it in the same view; a connect window never keeps anything from this computer in the window, since its page is https://login.kosmosplus.com and ConnectLinkDecision keeps only that and the board's own address in-app, so the check costs it nothing), `add_WebResourceRequested` + `AddWebResourceRequestedFilter("*", ALL)` before any page loads. A refused request gets a local 403 made by `ICoreWebView2Environment.CreateWebResourceResponse`, so it never leaves. If the hook cannot be wired, the window closes before anything is shown and the board opens in the browser (CouldNotHost); it never carries on without the check.
- The handler refuses a request it cannot read (fail closed).
- COM: `ICoreWebView2` extended through `AddWebResourceRequestedFilter`; `ICoreWebView2Environment.CreateWebResourceResponse`; the handler, args, request and response interfaces. All ids and slot orders checked against WebView2.h (1.0.4191.47 header in `work/scratch-6882/wv2sdk`).
- `Kosmos.exe` rebuilt with the pinned csc and flags, signed (Kosmos Agent Manager, Inc., timestamped), and `verify-launcher.ps1` OK, in the same PR (#6512).
- README: one bullet under the window's behaviour.

## Tests

- New `tools.win32-launcher-crossport-6916.test.js`. Source checks (every platform): wiring, ordering, the connect-mode exemption, fail-closed paths, and COM slot order. A probe compiled beside KosmosLauncher.cs (Windows only) runs `RefusedLoopbackRequest` over the board, other ports and schemes, IPv6, 127.x and non-loopback hosts.
- `tools.win-launcher-native.test.js`: its WebView2 interface table gains the new interfaces and slots.
- Live: the rig against the signed build shows fetch 0, img 0 and navigation 0 requests reaching the other port; same-folder control with the original exe: all three YES; the board's own requests still go with the session.

## Measured in challenge review 2 (rig variants in work/trial-6916)

- **Long addresses (BLOCKER, fixed):** .NET Framework's `Uri` will not parse an address over about 65,500 characters, and Chromium sends up to 2 MB. The first version let an unparseable address through. A control against that code confirms it: a 70k `http://127.0.0.1:3000/?...` was not refused. Now an unparseable address is read by where it goes (`scheme://host:port`). Whatever still cannot be read is refused, except the window's own `about:`, `data:` and `blob:` pages.
- **Redirects:** `rig-redirect.js` runs a listener on this computer's LAN address that answers 302 to `http://127.0.0.1:<other>/`. With the original exe (control), the redirected img and fetch reached the other port WITH the session cookie. With the fix: 0 and 0. So WebResourceRequested sees redirected requests, and they are refused too. (The redirected navigation did not arrive in either run: NavigationStarting cancels it.)
- **Upload cost (accepted):** `rig-upload.js` sends a 50 MB POST from the page to the board. It took 110 ms and 139 ms with the original exe, and 753 ms and 710 ms with the fix: WebView2 buffers a filtered request's body. The filter cannot leave out the board's own port (its patterns are wildcards, and the board is on the same host), so every board upload pays this. A 100 MB attachment takes about 1.5 s instead of about 0.3 s. Accepted for the session never leaving.
- **A clicked link to a dev site still opens in the person's browser:** NavigationStarting still runs for a refused navigation. In every fixed run the window kept showing the board page, not the 403. That is NavigationStarting cancelling it, the same decision that sends a clicked link to the browser (ConnectLinkDecision: Browser). Not driven with a real click, to avoid opening tabs in the person's browser on this box.

## Measured along the way

- .NET Framework's `Uri.Host` spells `[::1]` in full (`[0000:...:0001]`), so loopback is decided by parsing the address, never by comparing text. (`IsBoardAddress` compares text, so it never matches an IPv6 board address; out of scope here, and the board is loaded at 127.0.0.1.)

## Rejected

- Stripping the Cookie header in the hook: WebView2 adds cookies after this event, so it is not reliably there to strip.
- A per-board host name (`<x>.localhost`): it scopes the cookie properly, but it changes the board's URL, origin checks and sign-in everywhere, for the same result.
- Carrying on without the check if it cannot be wired: that would turn a security check into a silent no-op.

## Weakest part

1. **WebSocket connections are NOT covered (measured).** With the signed fix, a page-started `new WebSocket('ws://127.0.0.1:<other>')` still reached the other port with the session cookie on its handshake; WebResourceRequested never sees it. It is left as a known residual, not fixed here, because opening a WebSocket needs script running in the board's own page. The vectors that need none are a clicked link (navigation) and an image or other resource in content an agent posted, and both are covered. Script that can run in the board's page already holds the session: it can call the board's own API, so a WebSocket adds nothing it lacked. If that ever stops holding (for example, a board page that loads script from elsewhere), revisit this with a document-created script guard on `WebSocket` (AddScriptToExecuteOnDocumentCreated).
2. **Worker requests.** `AddWebResourceRequestedFilter` covers requests from documents only. Service-worker and shared-worker requests need `ICoreWebView2_22` with `SOURCE_KINDS_ALL` (challenge review 1). No hole today: `web/sw.js` passes on (returns early for) every fetch whose origin is not the board's own. A future change to `sw.js`, or a worker that fetches other origins, would bypass this check, and it would then need the `_22` filter.
3. The check costs one COM call per request the page makes. That is cheap, but it is every request.
