# #3221: tmux accessibility "Turn On" deep-links + register up front (client half)

**Branch:** `ick-3221-tmux-a11y` · **Card:** kosmos#3221 (client half of the joint #3113 fix)
**Ships together with:** Angel's native honest-copy PR #3274 (must land in the same merge).

## The defect (Josh, 0.6.78 fresh-box review, case-b)

On a genuine fresh 0.6.78 box, clicking the tmux **Accessibility** "Turn On" fired the wrong
macOS pop-up: a **System Events / Open Terminal Automation** prompt, not the Accessibility pane
Josh expected. Josh's spec, drawn: tmux "Turn On" should take him to **System Settings > Privacy
& Security > Accessibility > [turn on tmux]**.

Root cause: the tmux row's "Turn On" fired `/api/tmux-a11y-prompt`, which runs an osascript op
UNDER the bundled tmux to register tmux in Accessibility. That register is real and needed (tmux
must be LISTED before it can be granted), but firing it FROM the button surfaced the confusing
Automation prompt. The clean `/api/open-accessibility-settings` deep-link was only the fallback,
which never ran because the native trigger answered.

## Why the two halves must land together

- **Native (Angel, #3274):** reword the shared `NSAppleEventsUsageDescription` so the osascript
  register's copy is honest for the tmux-accessibility use.
- **Client (this PR):** move the register OFF the Turn-On click.

`trigger:null` alone regresses the listing — with no register, tmux is never listed and the
Accessibility pane opens empty. So the register must still happen; it just moves earlier.

## The change (two client edits, `web/index.html`)

1. **`s3PermissionTargets`:** the `tmux-a11y` gate's `trigger` becomes `null`, so its "Turn On"
   (and the mock-switch overlay, which shares the map) deep-links straight to
   `/api/open-accessibility-settings`. The app's own grant (`data-gate="tmux"`) keeps its
   `/api/a11y-prompt` — only tmux's own row changes.
2. **`frFireTmuxA11yRegister()`:** fires the register (`/api/tmux-a11y-prompt`) UP FRONT the
   moment the S3 Automation step is entered (called after `frGateStart(pane)` in the
   `step === 3` branch). macOS-only (`onWindows()` guard), at most once per session (latched
   flag), fire-and-forget (never awaited, never blocks paint or gate poll). Unlatches on a
   failed/unavailable attempt so a genuine failure retries on a later S3 entry rather than
   leaving tmux unregistered (the empty-pane regression).

Angel confirmed the native register mechanism fires when the REQUEST arrives, so the timing is
the client's to own.

## Not in scope

- The permission COPY (Angel's native #3274; Josh rewords after seeing the flow).
- The app's own Accessibility grant, sleep, and file-access rows — unchanged.
- No server/native change; `/api/tmux-a11y-prompt` and `/api/open-accessibility-settings`
  endpoints are untouched, only *when* the client calls the first one.

## Tests

- `web.firstrun-a11y-1214.test.js` — updated the #2911 sub-arms: the map no longer wires any
  gate to `/api/tmux-a11y-prompt`; only the app row keeps a trigger; `frFireTmuxA11yRegister`
  POSTs the register up front; entering S3 calls it; it is macOS-only + once-per-session. 12/12.
- `docs/browser-checks/click-first-run.js` — new section clicks tmux's own row like a person on
  a booted board: register fires once on S3 entry (before any click), no pane opens pre-click,
  Turn On deep-links, Turn On does NOT re-fire the register. All 4 arms green.
