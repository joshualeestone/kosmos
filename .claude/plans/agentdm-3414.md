# Plan: rebuild the agent DM/dialog to match the project consolidated-view conversation UI (#3414)

## Source of truth
Josh's verbatim spec on card #3414 + his CURRENT-vs-UPDATED screenshots (design channel msg
1552043644855394354). Owner: Mona Lisa (assigned via Splinter). Fast-follow (0.6.89), not
launch-blocking. Shared web/index.html, so it lands on Mac + Windows.

## Target (from the UPDATED screenshot, dark mode shown)
- Black, edge-to-edge conversation area filling 100% top-to-bottom and all the way right (padding
  keeps content off the literal edge). No rounded card, no border.
- Header top-left: "Direct Message to <agent name>" in the PROJECT-NAME font (big), not the small
  uppercase `.dlab`.
- Search top-right, shrunk to just "Search".
- Bubbles = the room's `.msg` style exactly:
  - Agent (theirs): gray bubble on the LEFT, agent avatar to its left, agent name bold INSIDE the
    bubble at top, white text, timestamp INSIDE the bubble bottom-right.
  - User (mine): blue bubble on the RIGHT, user avatar to its right, white text, timestamp INSIDE
    bottom-right.
- Composer = the room's composer: placeholder "Write something or @name to message someone…",
  emoji button, "Post" label.
- REMOVE the "Just between you and <name>. Nothing here belongs to a project." hint.
- REMOVE the "This stays here after a restart. <name> will not remember it..." line (it IS present
  at the bottom of the current DM, contrary to the initial map; confirmed in the CURRENT screenshot).
- Light mode ships too.

## Approach (measured against the code)
The room (`pjRoomRow`, `.msg/.msg-b/.msg-bd/.msg-nm/.msg-t/.msg-av`, `#pj-room`) and the DM
(`dmRow`, `.dm/.dm-b/.dm-w`, `#d-dmthread`) are DUPLICATED, not shared (only color tokens +
inline helpers are shared). So this is a PORT.

1. **Renderer:** refactor `dmRow(m, name, ctx)` to emit the room's `.msg` markup so the room's
   bubble CSS applies for free:
   - agent (m.from present): `<div class="msg">` + `.msg-av` (agent photo via
     /api/agent/<from>/avatar when the agent has one, else initials disc) + `.msg-b` > `.msg-bd`
     > `<b class="msg-nm">name</b>` + body + `<span class="msg-t">time</span>`.
   - user: `<div class="msg you">` + `.msg-av.mine` (YOU_PIC or neutral disc) + `.msg-b` >
     `.msg-bd` > body + `<span class="msg-t">time</span>` + the DELIVERY VERDICT.
   - KEEP the DM delivery verdict (mine side only). It is DM-specific and load-bearing (a DM
     crosses into a terminal and may not arrive; dmRow's own comments explain the record must not
     lie about the mechanism). It is silent on ordinary success, so on the happy path the bubble
     matches the room; on a real failure it still shows. Rendered inside `.msg-bd`.
   - Keep the stable per-row key (`data-mid`, id||at) so the 5s repaint keeps the reader's anchor.
   - ctx (3rd param) carries the agent avatar info (sessionName/hasAvatar/avatarVer) from
     paintTalkThread; defaulted so the lifted tests (which call dmRow(m,name)) fall back to the
     initials disc rather than a broken img.
2. **Header:** `#d-talk-label` text -> "Direct Message to " + name; restyle from `.dlab` to the
   project-name font (reuse the project-name treatment; the row is `.d-talk-caprow` today).
3. **Hint:** remove `#d-talk-hint` (the "Just between you and..." line; do not set its text).
4. **Search:** `#d-talk-search` placeholder + aria -> "Search".
5. **Composer:** match the room: placeholder "Write something or @name to message someone…",
   button label "Post" (keep #d-send id + sendTalk logic), add the emoji button wired to the same
   picker targeting #d-say IF reusable; else flag and keep parity on the visible box.
6. **Layout/background:** `#d-talk-box` -> black ground, edge-to-edge, no border/radius, fill 100%
   (mirror `.pjmid`/`.pjmid .thread` treatment). Background follows the room's theme tokens: near-
   black in dark (matches "black background"), light in light mode (matches "copy the project
   dialog exactly"). DECISION: theme-appropriate ground via the room's tokens, not a literal black
   forced into light mode; reversible in one rule if Josh wants literal black in light too.
7. **Remove the restart line** (find the #d-... element carrying "stays here after a restart").
8. **Light mode:** the room bubbles already theme via tokens; verify.

## STATUS (WIP commit a1e65efb5) -- resume here
DONE in the worktree (committed): dmRow renderer -> `.msg` markup; header text "Direct Message to
<name>"; hint removed; search "Search"; composer "Post" + room placeholder; #d-talk-box black
(--k-bg) edge-to-edge no-radius; #d-talk-label project-name font (line-height 1.2). The "stays after
a restart" line is already gone from current main.

## REMAINING (the tail) -- exact steps
1. **Update the 12 files that assert the OLD `.dm` markup** (my change breaks them). Markup mapping:
   - `.dm.theirs`  -> `.msg` (agent, gray, left)     ; `.dm.mine` -> `.msg.you` (user, blue, right)
   - `.dm-b`       -> `.msg-bd` is the bubble body ; the row is `.msg-b` > `.msg-bd`
   - `.dm-w`       -> GONE; the timestamp is now `.msg-t` INSIDE `.msg-bd`; the delivery pill
                      (`.delivery`) is inside `.msg-bd` after `.msg-t`, on the user side only.
   - agent bubble now also has `.msg-av` (avatar) + `.msg-nm` (name bold inside).
   **Lifted `*.test.js`** (add helper deps to the dmRow slice AND flip assertions):
   🛑 PATTERN (fixture-discipline compliant): do NOT hand-build a LAST roster row
   (`{sessionName, hasAvatar, avatarVer}`). The fixture-discipline meta-linter forbids any literal
   `sessionName:` card/roster row (an earlier draft used the photo path with a hand-built LAST and
   it red the linter). Route dmRow through the DISC avatar branch instead: in the `new Function`
   prefix (next to the injected `let CURRENT=...`) inject `let LAST=[]; let YOU_PIC=false;` plus a
   minimal disc palette `let DISC_TINTS=["#dfe5ea"]; let DISC_INKS=["#4a5560"];` (these const arrays
   are not sliceable by page.lift/page.slice, so they are injected as literals), and add
   `discTint, discInk, discIndex, initials` (all functions, sliceable) to the slice/lift list
   alongside `pjAvatarVer`. That renders the theirs bubble with an initials disc avatar; the photo
   avatar path stays covered by render-agentdm-3414 + web.avatarver-2762/room-2770. The
   escape test must pin the MESSAGE's raw form `/<img src=x/` (doesNotMatch), NOT `/<img/`, because
   the avatar legitimately adds `<img src="/api/agent/.../avatar?v=3">`. Also flip assertions:
   - web.agent-answers.test.js (two dmRow lifts: ~line 152 `slice` list, ~line 250 `lift` list)
   - server.test.js  (grep dmRow / `dm-w` / `dm theirs`)
   - web.dm-badge-2863.test.js, web.dialog-md-2701.test.js, web.links-everywhere.test.js
   **Browser-checks** (assert `.dm` markup; update selectors to `.msg`): render-agent-msg-gray-2805,
   render-dm-multiline-3208, render-pjmsg-prewrap-2294, render-richtext-2067, render-room-msgbox-2806,
   render-talk-anchor-1926, render-talk-search, render-talk. (render-agent-msg-gray-2805 is the best
   TEMPLATE for the new check: file:// + addInitScript fetch-stub + CURRENT + paintTalk('april',...).)
   ACTUAL: this list was the up-front sweep. web.dm-badge-2863, render-room-msgbox-2806 and
   render-pjmsg-prewrap-2294 turned out to be NO CHANGE NEEDED (their `.dm`-shaped hits are prose in
   comments or an unrelated tempdir name, not live markup assertions), and were left untouched.
2. **New browser-check render-agentdm-3414.js** (mirror render-agent-msg-gray-2805's harness):
   assert agent row = `.msg` (NOT .you) with `.msg-av` + `.msg-nm` + `.msg-t` inside `.msg-bd`; user
   row = `.msg.you` with `.msg-av.mine`; header `#d-talk-label` text starts "Direct Message to " and
   its computed font-size is the big (1.375rem) project-name size; `#d-talk-search` placeholder ===
   "Search"; `#d-talk-hint` ABSENT; `#d-talk-box` background is --k-bg (near-black in dark). Wire
   runner (tools/browser-checks.sh) + README + `// Browser-check-surface:` annotation.
3. **Screenshot** the DM view (the harness above) and send Josh a before/after preview.
4. **Full challenge-loop** -> PR (Addresses #3414, non-closing) -> CI -> merge -> verify -> remove wt.

## DECISIONS (mine, documented; Josh can undo)
- Emoji button DEFERRED: the room's emoji picker is coupled to #pj-post/#pj-emoji; wiring it to
  #d-say is separate work + its own tests. Shipping a dead button is worse (my "no dead affordance"
  rule), so omit for this PR and fast-follow. Composer still matches the room in box + placeholder +
  Post label.
- "Black background" = --k-bg (near-black in dark, matching Josh's dark-mode screenshot; theme-
  appropriate/light in light mode, matching "copy the project dialog exactly"). Reversible in one
  rule if Josh wants literal black in light too. His screenshot is dark-mode only.
- Delivery verdict KEPT on the user side (silent on success) -- removing it would hide real delivery
  failures; it is DM-specific and load-bearing. Happy path still matches the room.
- Composer placeholder is "Write something..." NOT the room's full "Write something or @name to
  message someone...". A 1:1 DM has no "someone" to @-mention (the @mention picker is wired to
  #pj-post only), so shipping the room's literal text would advertise unwired functionality, a dead
  affordance. Reversible: restore the room string and wire @mention to #d-say if Josh wants it.

## #3419 coordination (ICK, separate card, priority after #3414)
Contract agreed with ICK (REPLY sent): she injects the needs_you question into the thread payload as
a synthetic `{from:<agent>, kind:'question'}` row (renders as a normal .msg agent bubble after this
rebuild); I remove the #d-qask banner + strip the agreed delivery noise AFTER #3414. Keep 'question'
out of ROOM_NOT_SPEECH's render path. Overview "stuck" signal: Josh default REMOVE, quiet-badge
optional fast-follow.

## Weakest premise
That "background should be black" means the room's theme ground (near-black in dark, light in
light), not literal black in light mode. Reversible in one rule; Josh's screenshot is dark mode
only, so light mode is the inference.

Addresses #3414
