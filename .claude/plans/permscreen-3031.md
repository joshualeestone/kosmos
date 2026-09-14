# Plan: permission file-access screen redesign (#3031)

Branch: `permscreen-3031`
Card: #3031 (design half of #2910). Source: Josh, #chaoskosmos-design 2026-09-14 09:08 CDT.

## Goal / done condition
The install "Kosmos needs your permission" file-access screen (S2) shows exactly TWO
prompt previews side by side (Kosmos + tmux), each a single "<app> would like to access
files." dialog with non-wrapping Don't Allow / Allow buttons and no empty gap; the
"(3 folders)" labels and the "These prompts say tmux..." micro-note are deleted. Verified
by the S2 browser-check (headless) and the copy tests. Josh's in-app pass is the final look.

## Scope (Josh's items 2-6; item 1 is engine on #2910, Angel)
- Item 2: six previews (3 folders x 2 apps, two labelled groups) -> two previews side by
  side, one per app: `"Kosmos" would like to access files.` and `"tmux" would like to
  access files.` (Kosmos first per Josh's order). Kept the quoted app name to match the
  real macOS prompt look; the folder-count suffix is dropped.
- Item 3: `.s2-db` buttons no longer wrap. `white-space:nowrap` + previews sized so both
  buttons render on one line, equal height, no gap under Allow.
- Item 4: delete `.s2-applbl` "tmux (3 folders)".
- Item 5: delete `.s2-grpnote` explainer.
- Item 6: delete `.s2-applbl` "Kosmos (3 folders)".

## Coordination (Angel)
Concern-based split agreed with Angel: I own the `.s2-dlg-fan` preview markup + copy; she
owns the file-access trigger wiring. My redesign does NOT move the real `.s2-gate-row` /
`.s2-allow` button, and both new previews keep `.s2-mockallow` so the `#fr-pane-2` click
handler (`closest('.s2-mockallow')` -> the single `.s2-allow`) is unchanged. Merge-tree
check against `permission-screen-2910` before push (Angel does the same).

## Files
- `web/index.html`: the `.s2-dlg-fan` markup (six -> two previews) + the `.s2-*` CSS
  (`.s2-dlg-fan` side-by-side flex; `.s2-dlg` flex:1 1 240px so two share the ~552px pane;
  `.s2-db` white-space:nowrap; removed the now-dead `.s2-appgrp`/`.s2-applbl`/`.s2-grpnote`/
  `.s2-dlgrow` rules) + the two structural comments (the CSS-block comment and the HTML
  markup comment above `.s2-dlg-fan`).
- `docs/browser-checks/render-firstrun-access-onebox.js`: rewrote the arms for the two-preview
  structure (2 previews, no groups/labels/note, generic copy, deny/allow count 2), added a
  no-wrap guard (nowrap + single-line height + equal height) and a SIDE-BY-SIDE guard at the
  real ~552px pane width (the regression the first cut shipped: 320px previews wrapped).
- `web.win32-board-copy.test.js`: the three per-folder tmux copy assertions -> the two new
  "would like to access files." lines.

## Verification
- `node --test web.win32-board-copy.test.js web.tmux-box-1214.test.js`: 32/32 pass.
- S2 browser-check (chromium + webkit, headless): 22/22 pass, side-by-side confirmed
  (same top, different left at 552px).
- Full suite `bash tools/run-tests.sh`: gating before PR.
- Headless screenshot: two previews side by side, buttons single-line, labels/note gone.

## Weakest premise
That the ~552px onboarding pane width used in the side-by-side guard matches every install
context. If a narrower pane exists somewhere, the previews wrap to a column there (still
correct, just stacked). Josh's in-app pass on the real installer is the final check.
