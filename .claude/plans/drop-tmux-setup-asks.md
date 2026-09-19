# Drop the tmux permission asks from the setup screens

Branch: `drop-tmux-setup-asks` · Repo: joshualeestone/kosmos (agent-workforce) · Owner: Mona Lisa

## Source of truth
Josh, #chaoskosmos-design, 2026-09-19 08:11 CDT (three screenshots of 6.81):
1. Access screen (S2): remove the "tmux would like to access files" preview card; keep only Kosmos. The tmux file-access ask does not fire on the installer.
2. Automation screen (S3): the macOS "Kosmos wants access to control System Events" popup fires the moment the screen appears. Stop it firing. He is fine with things being auto-handled in the background; he just does not want the prompt.
3. Automation screen (S3): remove tmux from the Accessibility section entirely (the "tmux — Control your computer" row, its "Turn On", and its "Request access / Access granted" states), because the tmux Accessibility ask never actually pops up. Simplify to just Kosmos.

Josh's framing: he is done churning on the installer and wants it simplified, not fixed.

## Done-condition (what is true when finished)
- S2 Access screen shows ONE preview card ("Kosmos" would like to access files); the tmux card is gone.
- S3 Automation screen shows ONE Accessibility row (Kosmos); the tmux row, its Turn On, its status gate, and the tmux switch are gone. Next no longer gates on a tmux grant.
- Entering S3 no longer fires the System Events / osascript-under-tmux register, so the "control System Events" popup no longer appears on the setup screen.
- All tests + browser-checks that asserted the removed elements are updated (and a removal/absence guard replaces the old positive assertions so the removal cannot silently regress).
- No em dashes in any output/comment.

## What is in scope (my lane — web/index.html + its checks/tests)
- web/index.html: S2 tmux card; S3 tmux mock row + `.s3-sw-open` overlay + tmux-a11y status gate row; the `tmux-a11y` FR_GATES entry; the `frFireTmuxA11yRegister()` up-front register + its S3-entry call (this is the web-side trigger of the System Events prompt); the `s3PermissionTargets` tmux-a11y fallback arm; the step caption "switch Kosmos and tmux to On" -> "switch Kosmos to On"; stale comments.
- Tests/checks updated: web.tmux-box-1214.test.js, web.firstrun-a11y-1214.test.js (converted the #2911 tmux-a11y test into an absence guard; fixed the FR_GATES block-bounding test), docs/browser-checks/render-firstrun-access-onebox.js (two previews -> one), docs/browser-checks/render-gated-next.js (dropped the tmux-a11y gating blocks), docs/browser-checks/click-first-run.js (removed the tmux-a11y Turn On / register sections).

## What is OUT of scope (Angel's lane — handed off on #3113)
- The native osascript-under-tmux register (native-app/main.swift) and the /api/tmux-a11y-status + /api/tmux-a11y-prompt endpoints + engine/promptrequest.js 'tmux-a11y' entry are now dead (nothing calls them) but left intact for Angel to remove and to confirm removing tmux Accessibility does not break agents actually running. The web change alone stops the popup because the register only fires on a recorded request, and the only requester was the web up-front fire, now removed. Angel's #3113 (tmux a11y row, ready-to-test) is superseded.

## Coordination done
- Commented #3113 (Angel) and #3221 (Ice Cream Kitty) with the scope change + file overlap before editing. Both agents were offline; latest work pushed; no live-edit collision. Branch off current origin/main.

## Verification
- Unit: web.tmux-box-1214 (12) + web.firstrun-a11y-1214 (18) pass. server route + regate tests (22) pass. browser-check meta-tests (10, incl. #758 "every id a check asks for exists") pass.
- Hermetic browser-checks: render-firstrun-access-onebox (22/22, chromium+webkit) and render-firstrun-stepcap-gear (16/16) pass rendered.
- Served-board browser-checks (gated-next, click-first-run, wizard-flow, permission-slider) run in CI on the PR.
- Visual: S2 one Kosmos card; S3 one Kosmos accessibility row; caption "switch Kosmos to On".

## Weakest premise
That removing the web-side register is sufficient to stop the System Events popup with no native change. Reasoning: server.js records a prompt request only when POSTed, and the sole caller was frFireTmuxA11yRegister (removed); the native watcher fires only on a recorded request. If a native on-launch path independently sends an AppleEvent to System Events during setup, the popup could persist and the native fix (Angel, #3113) becomes required. Flagged to Angel; to be confirmed on a fresh-install machine.
