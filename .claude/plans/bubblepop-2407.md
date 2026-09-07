# #2407 - Per-project new-message "bubble pop" sound

## What finished looks like
When a new message lands on a project you are not currently looking at, a soft "bubble pop"
plays once (Josh's pick from the audition page). Several messages at once make one pop, not a
flurry. Each project has a per-device on/off in its settings (default ON); a Do-Not-Disturb gate
is present and fails open (never quiet) until the native layer supplies the signal. Node tests +
a new browser-check pass; challenge-loop converges; PR merges on green.

## Scope
Frontend half (my lane): the Web Audio sound, once-per-burst detection, per-project on/off, and a
DND gate that consumes an optional `SOUND_QUIET` signal. The native/engine half (the actual macOS
Focus/DND source, and where a message-landed event might fire server-side) is a documented
follow-up routed via Splinter, per the card's "engine/frontend, via Splinter" ownership. Level and
copy pair with Mona.

## Changes (web/index.html)
1. **Web Audio** (`bubbleAudioCtx`, `playBubblePop`): a lazily-created AudioContext and the `bubble`
   voice from the design page - a sine gliding 400->900 Hz over ~0.9 of a ~0.13s life, soft attack,
   low peak (0.08, tuned down for in-app; Mona pairs). No asset file. Silent (never a crash) if the
   browser has no Web Audio; resumes a suspended context best-effort.
2. **Per-project preference** (`projectSoundOn`/`setProjectSoundOn`): localStorage
   `kosmos.sound.pj.<id>`, default ON. Per-device (whether YOU hear a pop is yours, not the
   project's), storage-blocked falls back to ON.
3. **DND gate** (`SOUND_QUIET`/`soundIsQuietedByDnd`): present and fails open; the native source
   sets `SOUND_QUIET`. No fetch to a non-existent endpoint (no console noise).
4. **New-message detection** (`ringNewMessages`): remembers each project's unread between polls;
   baselines (does not ring) on the first load; rings ONCE per poll if any unmuted project's unread
   rose and not DND. Hooked in `loadProjects` right after `PROJECTS` is refreshed. The open project's
   unread is zeroed on open, so its own messages never ring.
5. **Settings toggle**: a `.setrow` switch (`#pjs-sound-toggle`) in `#pj-settings-view`, synced by
   `paintProjectSettings` via `paintSwitch` and flipped by a click handler (acts on `PJ_CURRENT`).

## Tests / browser-checks
- **`web.bubblepop-2407.test.js`**: runs the extracted #2407 block for real (stubbed
  window/localStorage): first-load-no-ring, rise-rings-once, burst-once, no-rise-no-ring, per-project
  mute, DND suppression, the recipe, and no-Web-Audio-is-silent.
- **`docs/browser-checks/render-bubblepop-2407.js`**: drives the shipped page with a counting
  AudioContext stub (addInitScript); asserts the globals are wired, the once-per-burst/first-load/
  mute/DND behavior, the real-AudioContext recipe, and the settings toggle. Wired into
  `tools/browser-checks.sh`; reason-grep count bumped 68->69; README row added.

## Weakest premise / follow-ups (routed to Splinter)
- **DND is not yet functional**: the gate is present and fail-open, but the macOS Focus/DND SOURCE
  belongs to the native layer (a frontend `defaults` scrape is too fragile / version-dependent).
  Until that lands, the pop can play during system DND; the per-project mute is the control that
  works today. Flagged for Splinter to route the engine/native half.
- **Default ON during that window**: chosen because Josh explicitly wants to hear the sound (beta,
  no users, per-project mute available). Reversible one-liner; flip considerations belong with the
  DND follow-up.
- **Level (0.08) and copy**: Mona pairs on the exact in-app level and the toggle wording.
