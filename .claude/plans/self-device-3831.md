# self-device-3831: the app's own Kosmos+ sign-in is named after this computer

Card: kosmos#3831. Josh signed in from the Kosmos app; the Mac then listed "a device, code W6-M4, pending approval" beside his browser's request, and he asked whether it was an intruder.

**Measured:** the page (web/index.html plusSi*) posts signin-start / signin-verify with no device_name; server.js passes body.device_name through; remote.pushDeviceName added nothing, so the coordinator stored the device unnamed.

**Call:** remote.pushDeviceName falls back to this computer's own name when no clean label is given: the ComputerName the person set in System Settings (`scutil --get ComputerName`), else the host name without `.local`, cut to 45 characters, plus " (Kosmos app)", within DEVICE_NAME's 60 (the coordinator keeps up to 64 non-control characters). On this Mac: "Agent1’s Mac mini (Kosmos app)". A malformed caller label (a newline) is still never passed through; it now falls back to this name instead of none.

**Rejected:** (a) naming it in the page (the engine is the one caller every door shares, the page and any future CLI); (b) the card's option 2, the Mac acking its own sign-in device after register. That is the Mac approving itself, which touches the "our server alone must never admit a person" rule; the name alone answers what Josh asked ("is this an intruder?"), so option 2 is not built here. (c) hiding pending devices (hides a real stranger too).

**Weakest premise:** that the Mac's own device list shows the coordinator's device_name for a pending device the same way it shows a browser's. Browsers already send one (the path is shared), so this is the path that already works for them.

**Tests (engine/remote.test.js):** a sign-in with no label carries this computer's name on start AND verify; a malformed label is not passed and falls back to it.
