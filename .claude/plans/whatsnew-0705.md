# What's New for Mac 0.7.05

**Branch:** `whatsnew-0705`. Asked by Splinter 2026-09-27 so the 0.7.05 cut can start as soon as 0.7.03 is promoted
(release.sh step 1b-ii refuses a cut whose web/whats-new.json names another version, #3955).

## Decision

Four highlights, in Mona's 0.7.03 format (icon, title, one line). They cover only what is new since the 0.7.03 freeze
`aad0d84cd3e8`, because 0.7.05 is cut after 0.7.03 reaches prod, so a person updating sees 0.7.03's own window first.
Each line is checked against a merged change by content: its text is absent at the freeze and present on main.

| highlight | change | content check |
|---|---|---|
| Chat boxes a little taller on a phone (44px to 48px) | #4197 (re-land of #4108) | `min-height: 48px` freeze 0, main 6 |
| When your Mac is not answering (Kosmos Plus, an OPEN board; the product hedges "may be asleep") | mac-asleep-board-718 | "It may be asleep or turned off" freeze 0, main 2 |
| Your phone says when it is offline (Kosmos Plus only: `deviceOffline()` needs `kplusRemote()`) | phone-offline-718 | "is not connected to the internet, so it cannot reach your Mac" freeze 0, main 2 |
| Undo an org chart upload (the product says "Upload an org chart" and "Create the team"; "Import" is a different option) | #4217 (#1280) | Undo strings new in the web/index.html diff |

**Rejected:**
- Carrying 0.7.03's lines forward, as 0.7.03 carried 0.7.01's: 0.7.01 never reached prod, but 0.7.03 will before 0.7.05.
- A line for #4214 (avatars flush with the collapse button): too small a visual change to announce.
- A line for #4188 (a refused Claude check says Kosmos checked it): the change is the pill's hover TOOLTIP only; the
  visible pill is unchanged and a phone never shows a tooltip (review 2).
- Anything behind a flag (#4209 Muse Code sign-in) or not in the app (logs, tooling, docs).

## Weakest premise

That 0.7.03 is promoted before 0.7.05 is cut. If 0.7.05 went to prod first, these would be the only lines anyone saw,
and 0.7.03's would never be shown. If that order changes, add 0.7.03's lines back. Even with the order right, the window
shows only the running version's file, so a Mac that jumps from 0.6.x straight to 0.7.05 (off during 0.7.03) never sees
0.7.03's lines. That is how the window is built, not this change.

The full since-freeze list is in `/Users/agent1/work/workers/barondraxum/cut-prep-0705.md`.
