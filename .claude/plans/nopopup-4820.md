# kosmos#4820: no Community pop-up for existing users; one switch in first run

Josh, 2026-09-30 20:41 CDT, verbatim: "I don't want to push a big message about this. I just want it to be
automatically on for anybody who's an existing user and then in the install process have that single switch
along with the diagnostic that says their agents can join the community to make Kosmos better".

## Call

1. Existing users: the #4288 part B one-time notice is removed entirely from web/index.html (CN_OPENER,
   CN_HTML, cnHeld, cnOpen, cnClose, cnToSettings, cnPending, communityNoticeCheck, cnCovered and its
   Escape/Tab handlers, the `communityNoticeCheck();` call, and `#cmnotice` in wnCovered). Sharing stays
   ON as merged in #4781; the Settings switch is untouched.
2. Server side removed too: `POST /api/community-setting/notice-seen` is gone, `noticeSeen` is gone from
   the GET/PUT answer, and engine/communityswitch.js holds only `on` (no NOTICE_KEY, no markNoticeSeen;
   migrate() takes no argument and writes ON for fresh and existing installs alike).
3. New installs: first-run pane fr-pane-6 gets a second switch row directly under #fr-s6-feedback, same
   markup and classes, id fr-s6-community, default ON, label "Let your agents join the Kosmos community to
   help make Kosmos better." Wired like the feedback switch against GET/PUT /api/community-setting:
   optimistic flip, revert on a refused or thrown PUT, its own epoch and saving flag, a could-not-read
   (a non-ok response or a throw) leaves the default-ON markup, and an ok:false answer paints its on:false
   (amended by Review round 1). Refreshed from frGo step 6, the only place
   frRefreshFeedback is called. The PUT persists at once, so turning it off before finishing first run
   leaves sharing off.
4. mobile-shots.js: the seed's markNoticeSeen step, the per-shot `COVERED: #cmnotice` check, the
   `MSHOTS_COVER_CONTROL=cmnotice` control (and its gate arm in tools/browser-checks.sh), and the four
   `#cn-ok` dismissals are removed; `cmnotice` is now refused as a control name.

## Rejected

- Keeping `noticeSeen` and the notice-seen route as harmless dead code. Rejected: removing the field is
  not only tidier, it is safer. A page from an older build opened the notice only on
  `noticeSeen === false`, so an answer without the field opens nothing even there. The change stayed small
  and every test was updated, not deleted silently.
- Keeping `existingInstall` as an ignored parameter of migrate(). Dead parameter; dropped, and the one
  caller (server.js start path) updated.
- Keeping a generic per-shot "something covers this screen" check in mobile-shots in place of COVERED.
  Out of scope: it would be a new check with no failing case today.
- A new browser-check file for the first-run switch. Extended render-firstrun-s6-2037.js instead (it is
  the check that covers fr-s6-feedback), as the brief prefers.

## Weakest premise

SUPERSEDED by Review round 1 (the ok:false answer is now painted, not left ON): The first-run refresh treats ok:false (an unreadable community.json) as could-not-read and leaves the
switch drawn ON, matching the feedback switch's rule and the brief. On such a board the engine reads OFF
(participating false) while the switch shows ON. A first toggle then PUTs off and the file is repaired to
OFF, so nothing is sent that should not be; but the drawn position is a default, not a reading. What would
change my mind: a ruling that a could-not-read should hide the knob (as the Settings row does), in which
case the first-run switch should follow the Settings painter instead.

Second: the browser check's NO-NOTICE arm decides "no dialog" by polling 10 s for #cmnotice or any laid-out
dialog whose text names the Kosmos community. The removed notice opened within about a second of the boot
cover lifting, so 10 s is wide; a future notice with different wording would not be caught by it.

## Decided

- Removed the server route and field (see Rejected).
- web.modal-way-out-1316's ceiling lowered from 21 to 20: the Community notice was the 20th modal.
- render-firstrun-s6-2037.js gained `// Browser-check-surface: fr-s6-feedback fr-s6-community`.
- render-community-switch-4288.js: NOTICE, HELD, STALE, BOOT and REARM arms removed with the notice;
  NO-NOTICE (routed, the old board's "owed" answer) and NO-NOTICE REAL (the board's own answer on a
  sandboxed data root, file restored after) added.

## Review round 1, 2026-09-30: 0 BLOCKER, 1 WARNING, 3 NIT
- [WARNING] FIXED, and it overturns the weakest premise above. ok:false (an unreadable community.json) left the first-run
  switch ON while the engine shares nothing. That did NOT match the feedback switch: /api/feedback-setting answers
  {on:false, ok:false} and frRefreshFeedback paints it Off. Now the community switch paints the answer's on:false too. A
  failed request or a throw still leaves the default ON. Test flipped; it reds with the ok check restored.
- Verified by the reviewer: an existing user's explicit OFF stands (migrate writes ON only when the file is MISSING; no
  version ever wrote off without a person); old page with new server opens nothing (no noticeSeen field).
- NITs decided: write() dropping unknown keys only matters on a downgrade (the old notice shows once); the no-dialog check
  matches the notice's wording (a future pop-up with other words would pass; named in the plan); existing users who saw
  the old "held until you release" notice now publish straight away untold (the #4781 behaviour; Josh's "no big message").

## Review round 2, 2026-09-30: 0 BLOCKER, 1 WARNING, 4 NIT
- [WARNING] FIXED. Settings read the Community and Daily report switches once, at page load, so a person who turned
  Community off on Screen 6 and then opened Settings > Automation in the same session saw ON with the Off notes hidden.
  settingsGo now calls refreshCommunity() and refreshFeedback() when Automation opens (both rows live in Automation),
  except while that switch's own save is in flight: a refresh bumps the same epoch, so it would drop the save's answer
  and could paint a read taken before the save landed. Pinned by the FIRST-RUN OFF arm in
  render-community-switch-4288.js, which opens first run at Screen 6 (?first-run=1&fr-step=6), presses the switch,
  closes with Escape, opens Automation through its nav and asserts Off with the note shown.
- NIT (a) FIXED: frRefreshCommunity's header comment no longer says ok:false leaves the default.
- NIT (b) FIXED: the Call item amended and the first Weakest-premise paragraph marked superseded.
- NIT (c) RECORDED: a person who presses Escape before Screen 6 never sees the first-run switch. Sharing stays ON and the
  Settings switch is still there; the diagnostics switch behaves the same way.
- NIT (d) RECORDED: on a FR_FORCED re-run, a could-not-read (failed request or throw) leaves the switch drawn ON even
  over a saved Off. Harmless direction: nothing is sent because of the drawing, and a click saves Off.

## Review round 3 (converged)
0 BLOCKER, 0 WARNING.
- NIT TAKEN: the FIRST-RUN OFF arm counted PUTs right after the optimistic aria-checked flip, while the PUT could still
  be in flight. It now waits for the PUT's response (waitForResponse registered before the click), then counts.
- NIT TAKEN: only the Community half of round 2's fix was pinned. A FIRST-RUN OFF (Daily report) arm now presses
  Screen 6's #fr-s6-feedback Off (exactly one PUT {"on":false} to /api/feedback-setting, held in a route), Escapes,
  opens Automation and asserts #feedback-toggle reads "false". Red in a git-archive copy with refreshFeedback()
  removed from settingsGo (only that assertion failed, reading "true"); green on the real tree.
- DECIDED, NOT BUILT: Settings ignoring a first-run save still in flight when Automation opens. Reaching it needs a
  person faster than a local PUT; the next open re-reads.
- DECIDED, NOT BUILT: the tab view does not re-read when Settings is reopened by a tab click while Automation is already
  the section. Pre-existing for the mine and held lists too; one fix for all three belongs on its own card.
- DECIDED, NOT BUILT: the knob briefly shows the old position while the re-read is in flight. It settles on the
  board's answer within one local request.
