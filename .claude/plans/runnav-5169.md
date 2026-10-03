# #5169: Mac app: a link or redirect to another origin no longer replaces the board in the window

## Problem
On a computer that runs agents, the Mac app's main-frame navigation policy allowed every URL in the board window because `webView(_:decidePolicyForNavigationAction:decisionHandler:)` only checked `computerMode == .connect` and allowed everything else unconditionally. Any foreign link clicked, or any redirect / script navigation, could displace the board interface in the window.

## Fix
1. Introduced pure helper `isBoardURL(_ url: URL, board: (host: String, port: Int)?) -> Bool`:
   - Checks that URL scheme is http or https.
   - Enforces absence of user credentials (user/password).
   - Verifies host matches board host (case-insensitive) and port matches board port (defaulting to 80/443).
2. Introduced pure helper `boardLinkDecision(for url: URL, board: (host: String, port: Int)?, clicked: Bool) -> ConnectLink`:
   - Matching board URL stays in-app (`.inApp`).
   - `about:blank` stays in-app (`.inApp`) for internal page use.
   - Other `https` sites go to the system default browser via `NSWorkspace.shared.open` (`.browser`).
   - Other `http`, `mailto`, `tel`, and `sms` links go to the browser if clicked (`.browser`), but are blocked if unclicked/scripted/redirected (`.block`).
   - All other schemes (including `javascript:`, `file:`, etc.) are blocked (`.block`).
3. Wired navigation delegate in `AppDelegate.webView(_:decidePolicyForNavigationAction:decisionHandler:)`:
   - Inspects main-frame navigation actions on both connect and run computers.
   - Connect computers follow `connectLinkDecision`.
   - Run-mode computers (`run`, `both`, `unset`, `unreadable`) follow `boardLinkDecision` using the resolved/badge board origin.
   - Foreign URLs never replace the board in the window.
4. Added 19 selftest rows to `--kosmos-app-mode-selftest`, expanding coverage from 40 to 59 rows.
5. Added unit test suite `native-app.runnav-5169.test.js` and updated `native-app.computer-mode-4356.test.js`.

## Rejected
- Opening all external URLs unconditionally in-app: violates security boundaries and displaces the board.
- Allowing unclicked http or redirect navigations to foreign origins: allows malicious or buggy third-party redirects to hijack the main board window.
- Applying connect-mode policy to run mode: connect mode routes to Kosmos Plus sign-in domains, which would break local board operations on run computers.

## Verification
- Swift compilation clean with `swiftc -target arm64-apple-macos13.5`.
- `--kosmos-app-mode-selftest` passed with 59/59 PASS (exit 0).
- Light test suite passing: `native-app.runnav-5169.test.js`, `native-app.computer-mode-4356.test.js`, `tools.windows-computer-mode-4381.test.js`, `cli.exit-code-mapping-3628.test.js`, `cli.sandbox-data-4796.test.js`.
- Zero em dashes across all code, tests, and documentation.
- Marked Tuesday-ready (held for merge until after Monday's release).
