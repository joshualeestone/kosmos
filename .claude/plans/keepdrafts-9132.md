# keepdrafts-9132: chat and room drafts are kept across a reload, so a kept draft no longer holds the Mac window's restart

Card: kosmos#9132 (split from #9093 part 2 by Ice Cream Kitty, 11-26). Night-shift rotation; claimed by Mona Lisa 04:5x.

## Done when

Words half-typed into an agent's message box, its Terminal box, a project's message box or a project room's box are
still there after the page reloads (they come back when that chat or room is opened), and those kept words no longer
make updateNothingToLose() refuse the Mac window's self-restart onto an update. Words that could NOT be kept (storage
refused) still hold it, as today. Shown in a real page by a browser check with a control arm.

## Measured on origin/main first (the card is live)

None of the four maps (TALK_DRAFTS, TERM_DRAFTS, PJ_DRAFTS, PJ_ROOM_DRAFTS) is written to localStorage or
sessionStorage; updateNothingToLose returns false while any holds words, and also while any typed box holds words
(UPDATE_TYPED: every textarea the person typed in, the chat boxes included).

## The change (web/index.html)

- keptDrafts(kind): the same plain map, wrapped (Proxy) so every set or delete also writes that one entry to
  localStorage, "kosmos.draft.<kind>.<agent or project>" = {v, t}; filled from storage on load; entries older than 14
  days or unreadable are dropped. Per entry, not one blob, so two windows of one board never overwrite each other.
  A failed write marks that key unsaved until it writes again; a failed load marks the map unsaved.
  draftsKept(m): true only for a map made by keptDrafts with nothing unsaved (a test's plain map is never kept).
- The four maps are now keptDrafts('talk' | 'term' | 'pj' | 'room'). Every write site is unchanged: the wrapper sees
  them all. The restore sites (paintTalk for the agent boxes, the project open for pj-say and pj-post) are unchanged:
  they already fill an empty box from the map, which is now filled from storage.
- updateNothingToLose: a map's words hold the restart only if the map is not kept; a typed box holds it unless it is
  one of the four boxes (d-say, d-term-say, pj-say, pj-post) and its words are exactly the kept draft for the open
  agent or project (they park on every keystroke, so they match).

## Decided

- localStorage, not sessionStorage: the card rejects relying on sessionStorage across a native restart (unmeasured).
- The wrapper rather than editing every write site: dozens of sites (typing, send, failed send, switches), and
  server.test.js pins several of them by text.
- Not done here: logging why a restart was held (the card's measurement of its weakest premise). The fix stands on
  its own (a reload losing half-typed words is a defect either way); the reason log is the Mac app's (native-app) and
  can follow.

## Weakest premise

That localStorage under the board's origin survives the Mac window's restart. Reasoned, not measured on the app:
native-app/main.swift makeWebView builds a plain WKWebViewConfiguration, so the web view uses WebKit's DEFAULT,
persistent data store (kept on disk across launches), and the page already relies on localStorage persisting there
(loginAdvDismiss's hidden notices). The browser check shows it across a page reload only. If it did not survive, a
restart would lose kept words; measuring it on the app (type, let it restart, reopen) is the check that settles it.

## Verified

- web.keepdrafts-9132.test.js (6, the page's own helper lifted): kept across a reload, stale entries dropped, kept
  drafts do not hold the restart and plain ones do (control), a refused write holds it, the open box matching its
  kept draft does not hold it and other words do. Main's page: 6 of 6 fail. Mutations (box excuse removed, kept-map
  excuse removed) each fail the test that names them.
- docs/browser-checks/render-keepdrafts-9132.js (real Chromium, real typing): stored as typed, updateNothingToLose
  true, back after a reload; control arm (storage refusing writes): held, and empty after a reload. Against main's
  page the three kept-draft assertions fail.
- The four tests that lift updateNothingToLose pass (61); the wiring and tree guards pass.
- bc-pr-select: 80 checks selected (the four boxes and the open agent/project are genuinely touched).
- The surface gate (#2518) maps 11 checks to the box ids updateNothingToLose now names (d-say, pj-post,
  d-term-say). Those ids are only compared there; nothing drawn changes. All 11 run on the branch and pass, by their
  own counts: render-dm-chatfirst-718 413, render-composer-stroke 63, render-dm-sideways-3969 83, render-voice-4409
  79, render-dm-emoji-3744 74, render-room-reply-3745 71, render-phone-taps-5218 47, render-dm-reply-4256 22,
  render-type-to-focus-3283 19, render-gutter-return-4506 15, render-dm-sendjump-4639 8. Each carries a
  Browser-check-surface trailer saying so.

#### Iteration 1 (blind review, opus)

- [SHOULD-FIX] taken: a reply being written (DM_REPLY, PJ_REPLY: kept only on the page) lost its target on a restart
  once the box stopped holding it (Send would post a plain message). Now a reply with words in its agent's or project's
  draft holds the restart; a reply picked with nothing typed holds nothing, as before.
- [SHOULD-FIX] taken: two tabs on one agent: a tab whose stored draft another tab overwrote counted its words as kept.
  draftsKept now also checks every word on the page against what storage holds NOW, and the box check reads storage
  (keptDraftStored), not the page's copy.
- [SHOULD-FIX] taken: nothing forgot a draft. forgetDrafts on a confirmed agent removal (both remove dialogs, and the
  org chart's removal for each one done) and a project removal; forgetAllDrafts on a successful Kosmos+ log out. A new
  agent given a removed one's name no longer inherits its words. Not on a single message's delete (the draft still
  belongs to that conversation).
- [NIT] taken: an open IME composition holds the restart (UPDATE_COMPOSING); the PJ_DRAFTS comment no longer says
  nothing is written to disk.
- [NIT] not taken: the browser check covers d-say only (the other three restore by the same map read, covered by the
  unit test's pj-say case); keys are not scoped by world under MULTI_KOSMOS (off by default, a separate card).
Tests: web.keepdrafts-9132 9 of 9 and the related suites (439, 0 failed); render-keepdrafts-9132 passes; both gates
pass; bc-pr-select 81.

#### Iteration 2 (blind review of the whole branch, sonnet)

- [SHOULD-FIX] taken: round 1's IME flag could hold the restart forever (a composition whose end never arrived), the
  very defect this card fixes. Now UPDATE_COMPOSING_SINCE: cleared on compositionend and on focusout, and a
  composition older than a minute holds nothing. Tested: a fresh one holds, a 61 s one does not, none holds nothing.
- [SHOULD-FIX] taken: tabs did not hear each other: a draft another tab sent stayed in this tab's map, so its
  background tab held for good. keptDrafts now listens for the storage event on its own prefix and updates the map
  directly (nothing written back). Tested with a fake window.
- [NIT] taken: the backing map is Object.create(null) (an agent or project named __proto__ is an ordinary key);
  forgetAllDrafts' comment says the page reloads after log out.
- [NIT] not taken: the org chart's mid-run leave skips forgetting for agents already removed (the 14-day age-out
  bounds it); a write per keystroke (fine, as the reviewer says); MULTI_KOSMOS world scoping (off by default).
web.keepdrafts-9132 11 of 11 and the related suites pass (92); render-keepdrafts-9132 passes.

#### Iteration 3 (blind review of the whole branch, opus)

- [BLOCKER] taken: words left in a project's box after Back held the restart until another project opened: Back
  nulls PJ_CURRENT and leaves the boxes, so the box check had no key. The project boxes now belong to PJ_CURRENT or,
  after Back, PJ_LAST_OPENED (written only by openProject, which also fills them). On project removal its boxes are
  emptied with its drafts. Tested: after Back the kept words do not hold; with no project to belong to they do; newer
  words do.
- [SHOULD-FIX] taken: another tab's change left this tab's open box showing an old copy (holding the restart, and the
  next keystroke would write the older words back). keptDraftHeard: the open box follows when it still shows this
  page's old copy; never over words typed here since. Tested both, and another agent's change.
- [NIT] not taken: a reply with words holds until sent or cancelled (keeping the reply target is a larger change);
  rm-go's reportDiscarded route (the modal reopened for another agent mid-answer) does not forget (14-day age-out);
  the 14-day age-out drops words silently (a product call; a card if Josh wants it longer); a failed load stays
  "not kept" for the page's life (conservative).
- Also: the test's second fixture name was a real outside person's name (no-name-refs-3071 red): now "roo".
web.keepdrafts-9132 13 of 13 and the related suites and tree guards pass (104); render-keepdrafts-9132 passes.

#### Iteration 4 (blind review of the whole branch, sonnet)

- [SHOULD-FIX] taken: removing the agent whose chat is open left its words in d-say and d-term-say with no agent to
  belong to, holding the restart until another agent opened (round 3's class, agent side). forgetAgentDrafts(name):
  its kept drafts go, and its boxes empty when its chat is the open one; used at all three confirmed removals. Tested
  with a control (another agent's chat open: nothing emptied).
- [NIT] taken: the reply hold counts only the box the reply goes with (DM_REPLY with the chat box; PJ_REPLY with the
  room's post box), not the Terminal or the project's agent box; the code says a half-written reply holds until sent
  or cancelled (as any unsaved words did before).
- [NIT] not taken: a search field left with a query holds the restart (main's, outside this card; a separate card).
web.keepdrafts-9132 14 of 14 and the related suites and guards pass (105); render-keepdrafts-9132 passes.

#### Iteration 5 (blind review of the whole branch, opus)

- [SHOULD-FIX] taken: removing ANOTHER agent from the Agents tab nulls CURRENT and left the open chat's words, safe in
  storage, holding the restart. boxKept now treats a box with no owner as safe when storage holds its words word for
  word under some key of its map (true for any exit that nulls the owner). The round-3 control is now "stored nowhere".
- [SHOULD-FIX] recorded as a decision, not built: a half-written reply whose chat is never reopened holds the restart
  until sent or cancelled (DM_REPLY is not cleared on a switch). It held on main too. Keeping the reply target with the
  draft would end it; that is its own card if Josh wants it (noted on #9132).
- [NIT] taken: keptDraftHeard never writes into a disabled box (as paintTalk). The browser check now asserts, in both
  arms, that nothing holds the restart before typing, so a held restart after is the draft's doing.
- [NIT] not taken: log out empties a second tab's open box showing the old copy (that tab is signed out too); the
  browser check covers d-say only (the other boxes share the same code paths, unit-tested).
web.keepdrafts-9132 15 of 15 and related suites and guards (106) pass; render-keepdrafts-9132 passes.

#### Iteration 6 (blind review of the whole branch, sonnet)

No BLOCKER, no SHOULD-FIX. Converged. NITs, not taken: two tabs typing in the same chat at once is last-writer-wins
(the other tab's keystroke replaces this box, caret included); a removal finishing after CURRENT was already nulled
leaves the removed agent's box words (unproven path, narrow); the silent 14-day age-out and the load-failure
"not kept" (decided above). The "any key" fallback was checked: a match means storage holds those words, so nothing
is lost on a reload.
