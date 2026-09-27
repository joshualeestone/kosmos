# What's New for Mac 0.7.05

**Branch:** `whatsnew-0705`. Asked by Splinter 2026-09-27 so the 0.7.05 cut can start as soon as 0.7.03 is promoted
(release.sh step 1b-ii refuses a cut whose web/whats-new.json names another version, #3955).

## Decision

Five highlights, in Mona's 0.7.03 format (icon, title, one line). They cover only what is new since the 0.7.03 freeze
`aad0d84cd3e8`, because 0.7.05 is cut after 0.7.03 reaches prod, so a person updating sees 0.7.03's own window first.
Each line is checked against a merged change by content: its text is absent at the freeze and present on main.

| highlight | change | content check |
|---|---|---|
| Bigger chat boxes on a phone | #4197 (re-land of #4108) | `min-height: 48px` freeze 0, main 6 |
| Your phone says when your Mac is asleep | mac-asleep-board-718 | "It may be asleep or turned off" freeze 0, main 2 |
| Offline is not the same as your Mac | phone-offline-718 | "is not connected to the internet, so it cannot reach your Mac" freeze 0, main 2 |
| Undo an org-chart import | #4217 (#1280) | Undo strings new in the web/index.html diff |
| A refused sign-in check says so | #4188 (#4139) | "refused when Kosmos checked it" freeze 0, main 1 |

**Rejected:**
- Carrying 0.7.03's lines forward, as 0.7.03 carried 0.7.01's: 0.7.01 never reached prod, but 0.7.03 will before 0.7.05.
- A line for #4214 (avatars flush with the collapse button): too small a visual change to announce.
- Anything behind a flag (#4209 Muse Code sign-in) or not in the app (logs, tooling, docs).

## Weakest premise

That 0.7.03 is promoted before 0.7.05 is cut. If 0.7.05 went to prod first, these five would be the only lines anyone
saw, and 0.7.03's would never be shown. If that order changes, add 0.7.03's lines back.

The full since-freeze list is in `/Users/agent1/work/workers/barondraxum/cut-prep-0705.md`.
