# Plan: Global master on/off for the new-message sound (#2436)

## Goal / definition of done

Josh, after hearing the #2407 per-project bubble-pop: "we might put something in the
settings somewhere to turn it on/off but have it on by default." So a GLOBAL master
on/off for the new-message sound, in the app Settings, on by default. Done when:

- A single toggle in Settings turns the new-message sound on/off everywhere.
- On by default (Josh chose the sound).
- When ON, the per-project toggles govern each project as today.
- When OFF, no pop plays on any project regardless of the per-project toggles.
- Placed near the notification / prompter settings.
- Mona's copy renders; a browser-check pins the toggle; the full gate is green.

## Context

- #2407 (shipped #2426) is the per-project bubble-pop. Its core: `ringNewMessages`
  decides to ring (`playBubblePop`) on a per-project unread RISE, gated by
  `projectSoundOn(id)` (per-project localStorage) and `soundIsQuietedByDnd()`.
- The Settings > Automation section (`#s-sec-automation`) holds "how Kosmos tells you
  things": Auto-save, Prompter (both server-backed), the conversation limit, Daily
  report, and the telemetry/notify toggles.

## Approach

- **Storage:** `soundMasterOn()`/`setSoundMasterOn()` -- a per-viewer localStorage
  preference (`kosmos.sound.master`), default ON, same family as the per-project
  `kosmos.sound.pj.<id>`. Whether YOU hear the pop is yours, not the project's.
- **Gate:** add `&& soundMasterOn()` to the single play decision in `ringNewMessages`
  (beside the DND gate). Crucially, `PJ_UNREAD_SEEN` still updates above the gate, so
  OFF SILENCES rather than DEFERS -- flipping back on does not ring a backlog.
- **UI:** a new "Sounds" `.dbox` in the Automation section, between Prompter and the
  conversation limit (the two "how Kosmos gets your attention" cues together). A
  `.toggle` switch (`#snd-toggle`), static markup ON (no flash), painted from storage in
  `paintSettings` (`paintSwitch('snd-toggle', soundMasterOn())` -- a real boolean, never
  null, since there is nothing to fetch). Click handler flips storage + repaints,
  mirroring the per-project toggle.

## Key decisions

- **Per-viewer localStorage, not a server setting.** Rejected a server route: the pop is
  a per-device UX cue (like the per-project toggle it governs), and there is no
  cross-device meaning to a "should I hear a sound on THIS screen" preference. Weakest
  premise: if Josh wants the master to sync across devices, this needs a server-backed
  setting instead -- a larger change, easily done later; the per-viewer choice matches the
  per-project toggle it sits above.
- **Gate at the play decision, not the baseline.** OFF silences, does not defer, so
  re-enabling never rings a backlog. This matches "turn it off to silence it," not "queue
  it up."
- **Placement between Prompter and the conversation limit** (builder's call per the
  card): groups the two attention cues near the top of Automation.

## Validation

- `web.bubblepop-2407.test.js`: master-gate coverage (default ON; the master is the
  discriminator via an identical-rise on/off control; silences-not-defers).
- The Automation heading-order pins (`web.settings-nav.test.js`,
  `render-prompter-label-1843.js`) updated for the new "Sounds" box.
- New hermetic browser-check `render-sound-master-2436.js` (file://): toggle paints,
  default ON, click flips + persists, paint-from-storage; reds under a default-flip
  perturbation. Wired into the runner loop, reason-grep counts, README.
- Full `run-tests.sh` gate + node suite green.

## Out of scope

- Cross-device sync of the master (would need a server setting).
- The native system-DND source for #2407 (a separate follow-up already routed).
