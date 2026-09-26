# self-device-3831: the app's own Kosmos+ sign-in is named after this computer

Card: kosmos#3831. Josh signed in from the Kosmos app; the Mac then listed "a device, code W6-M4, pending approval" beside his browser's request, and he asked whether it was an intruder.

**Measured:** the page (web/index.html plusSi*) posts signin-start / signin-verify with no device_name; server.js passes body.device_name through; remote.pushDeviceName added nothing, so the coordinator stored the device unnamed.

**Call:** remote.pushDeviceName falls back to this computer's own name when no clean label is given: the ComputerName the person set in System Settings (`scutil --get ComputerName`), else the host name without `.local`, cut to 47 UTF-16 units (never splitting a surrogate pair), plus " (Kosmos app)", within DEVICE_NAME's 60 (the coordinator keeps up to 64 non-control characters). On this Mac: "Agent1’s Mac mini (Kosmos app)". A malformed caller label (a newline, over 60) is still dropped and never replaced: it names some other device, so it must not become this computer's name. Only NO label gets this computer's name.

**Rejected:** (a) naming it in the page (the engine is the one caller every door shares, the page and any future CLI); (b) the card's option 2, the Mac acking its own sign-in device after register. That is the Mac approving itself, which touches the "our server alone must never admit a person" rule; the name alone answers what Josh asked ("is this an intruder?"), so option 2 is not built here. (c) hiding pending devices (hides a real stranger too).

**Weakest premise:** that the Mac's own device list shows the coordinator's device_name for a pending device the same way it shows a browser's. Browsers already send one (the path is shared), so this is the path that already works for them.

**Tests (engine/remote.test.js):** a sign-in with no label carries this computer's name on start AND verify; a malformed label is not passed and falls back to it.

## Round 1 review (opus): 2 WARNINGs, 3 NITs
- [WARNING] the name was cut by code points while DEVICE_NAME counts UTF-16 units, so a long name with emoji failed the rule and went unnamed again (and the cached value skipped the fallback). FIXED: pure deviceNameFrom(raw, platform) cuts to 47 UTF-16 units without splitting a surrogate pair, and falls back when the finished label fails the rule. Control (no pair step) fails by name with half an emoji.
- [WARNING] both tests compared against the function under test on this machine's name. FIXED: deviceNameFrom is tested directly on a newline, empty, spaces, null, 70 characters and 30 emoji; every result passes the rule.
- [NIT] execFileSync on the request path. ACCEPTED: once per process (cached), local, bounded at 2 seconds.
- [NIT] "This Mac" is wrong on Windows and Linux. FIXED: "This computer (Kosmos app)" off macOS.
- [NIT] a malformed caller label was replaced by this computer's name, which would name some other device as this one. FIXED: only an absent or blank label gets this computer's name; a malformed one is dropped, as before.

## Round 2 review (sonnet): 1 WARNING, 1 NIT
- [WARNING] an AGENT_WORKFORCE_COMPUTER_NAME env override (a test seam no test used) could substitute any name on the one surface meant to be an honest label. FIXED: removed; the name comes only from scutil or the host name. deviceNameFrom is the tested seam.
- [NIT] the plan said 45 characters; the code cuts to 47 UTF-16 units. FIXED.
