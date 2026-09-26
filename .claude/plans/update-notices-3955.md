# update-notices-3955: a small update chip, and a "Kosmos has been updated" window

Card #3955 (Josh, #admin, 2026-09-26 08:11). Design: Mona Lisa's mock on card-shots/3955 (chip A, chip B, modal C). Highlights file: agreed with Baron on the card (13:32Z).

## What finished looks like
- Before an update, the top bar shows one small chip beside the Kosmos switcher: "An update is available" with a gold Update. Nothing else about the update is on screen.
- When Kosmos updated underneath an open page, the same chip reads "Reload to finish updating" with Reload, and the page reloads itself when the window is in the background and nothing is being typed or sent. Nothing says "Kosmos updated" while the old page is showing.
- After the new version is on screen (a manual Update or an auto-update), a centred window over a dimmed app says "Kosmos has been updated", a version pill, and 1 to 5 tiles (icon, title, one line) from web/whats-new.json when that file is for this version (a release with no highlights shows no window; round 3). Got it or Escape closes it; it is not shown again for that version. A fresh install never shows it.
- The old "Kosmos updated to 0.6.94 [x]" line and the "Updated. You are on Kosmos X" note are gone.
- A cut refuses when web/whats-new.json is not for the version being cut, unless KOSMOS_CUT_NO_WHATS_NEW=1.

## Decisions
- **Chip, same slot.** #utoast-slot already sits inline beside the switcher (Josh, 2026-08-17); the chip replaces what is drawn in it. The engine-stale state keeps its place (it outranks both) and its words.
- **One action.** The offer chip has only Update (the card: "the single action it needs"). Later is gone from the chip; a Later someone pressed on an older page still quiets that version for its window (the reading code stays; nothing new writes it). Weakest premise: a person who wants it gone for now has no button; the chip is small by design.
- **Automatic reload, only when it cannot lose anything:** the page is in the background (document.hidden), no message is being sent and no composer holds a draft, and no dialog is open. Otherwise the chip waits for the person. Rejected: reloading a visible page mid-glance.
- **The window's source of truth.** /api/whats-new already records "seen" per version on the board (seen-version.json, survives restarts and browsers); it now also carries the highlights from web/whats-new.json when that file's version equals the running version, else none. The page shows the window only when its own baked version equals the board's (never over an old page), the board's version is not the one recorded as seen, and a version has been seen before (a fresh install records silently, as the news line did).
- **Highlights file:** `web/whats-new.json` `{"version":"X.Y.Z","highlights":[{"icon","title","line"}]}`; 1 to 5; icon one of swarm, tasks, phone, list, chat, shield, spark (drawn by the app); title up to about 40 characters, line one sentence up to about 120; no em dashes. A suite test enforces the shape of the committed file. The server validates again at read time and serves nothing it cannot draw.
- **Cut guard:** tools/whats-new-check.js (node, pure) checks the file against the version; release.sh runs it as step 1b-ii, right after the versions entry (1b) and before anything is built or bumped. KOSMOS_CUT_NO_WHATS_NEW=1 skips it and prints that the release will show only the title. docs/releasing.md gets the line. The guard lands only while no cut is running.
- **This change ships no highlights file** for a past version: the operator writes it for the cut it ships in (Baron's 0.6.98 at the earliest).

## Review round 1 (decided)
- Step label: the versions-entry test counted every `step "== 1b`; it now counts the 1b label itself (`1b. `), so 1b-ii keeps its natural name.
- The automatic reload no longer scans every textarea (the page fills many itself, so it would almost never fire); it remembers every field the person typed into and waits while one holds words, and also while a file is attached but not sent.
- The window's Escape and Tab listen on the document, and focus that lands outside is brought back in.
- Only a move UP opens the window: a rollback or a switch to an older channel records the version quietly.
- The browser check that opens the window records the board's own version as seen before and after, so checks sharing its board never meet the window.
- "See everything that changed" says it opens in the browser; the cut check names the file it read.

## Review round 2 (decided)
- Below 480px the chip may wrap to two lines rather than run off the right edge; the 375px check asserts its right edge and that the page does not scroll sideways.
- Fields removed from the page are let go from the typed set (and hold no words).
- The window's document-level keys and focus backstop stand aside while another window is open over it.
- Left: the one-shot whats-new read at load has no retry (as the old news line); an unused `.utxt small a` rule predates this change.

## Review round 3 (decided)
- Only boxes that hold words (textareas, text-like inputs) are remembered as typed, and one blocks the reload only while it is still shown and holding words: a dropdown or checkbox changed once, or a field saved and closed, no longer stops the reload for the rest of the tab.
- A release with no highlights (the hotfix opt-out) shows no window and records the version quietly, as agreed with Baron on the card; release.sh, the check's messages and docs/releasing.md say so.
- The cut check runs again on the frozen tree, so a pull between step 1 and the freeze cannot ship a different file.
- The window stands aside only for windows really drawn over it (first run, the update overlay), not the dialogs under it.
- render-reload-toast records the board's own version as seen in a finally, however it ends.
- Tests pin the reload's wiring in renderUpdateToast and that every page value it reads is declared.

## Review round 5 and Mona Lisa's design review (decided)
- Reverses round 3's visibility rule: any typed box still holding words blocks the reload, shown or not. A hidden box is not a saved one (New task keeps its words when closed, #766). Weakest premise: a saved field that stays holding its text (a rename box) keeps the chip waiting for Reload; the chip is the safe side.
- Every input counts as a words box except the kinds that hold none (checkbox, radio, range, color, file, hidden, buttons): a phone number or a password is words too.
- The cut check runs once, at 1b-ii (reverses round 3's second check): step 2 freezes at the bumped head of the same checkout, so the file cannot differ, and a refusal after the freeze would leave the bump pushed.
- An old page never records the version as seen (tested).
- Mona Lisa: the version pill sits 12px under the title; the window waits while the first-run tour is on screen and opens once it closes.
- The icon lookup uses own keys only; the pill's and the link's contrast are checked too.

## Review round 6 (decided)
- The cut checks the highlights twice again (reverses round 5): release.sh itself documents the shared checkout moving mid-cut, so 2b-ii checks the frozen tree; a refusal there leaves the bump pushed, like a step 7 versions-entry refusal. The test counts the calls over the whole file.
- A contenteditable box counts as a words box (read by its text).
- A tour still open after an hour: the version is recorded quietly, no window over it.
- Seen is recorded when the window OPENS (reverses the record-on-close choice), so a second tab that loads after the first opened it does not show it. Best effort: two tabs that read /api/whats-new in the same moment can both show it once. Accepted cost: a reload before reading it does not show it again.

## Review round 7 (decided)
- The suite: tools.release-gate.test.js's git sandbox carries the whats-new check, its engine module and a highlights file for the version its arms cut; browser-check selectors (a URL fragment split, the removed Later asserted by button count); reason-grep sites 177.
- The tour wait uses a real one-hour deadline (a background tab slows timers). Stale comments rewritten (renderUpdateToast's, render-reload-toast's header and README row).
- The round-6 never-closing-tour test gets a clock that moves a minute per reading (the real deadline made it run a real hour, and the six-file run hung on it for 25 minutes).

## Review round 8 (decided)
- render-reload-toast.js did not parse: my round-7 edit put a line comment in the middle of a chk() call, swallowing its label and closing paren. Fixed, every touched script now passes node --check / bash -n, and both update checks were RUN against a sandbox board (render-reload-toast: 54 PASS, all good; render-update-toast: OK). The reason-grep test only scans text, so it stayed green on an unparseable file.
- Clicking outside the window also closes it (the same single wnClose as Got it and Escape, and the app's other dialogs do the same); seen is recorded on open either way.
- The highlight limits are enforced at 48 and 140 characters; the "about 40" and "about 120" above are the writing guide, with room left over.

## Review round 9 (decided)
- A file still uploading holds the automatic reload (ATTACH_UPLOADING, counted up before the upload's try and down in its finally; ATTACH_PENDING holds a file only once its upload answered), and so does a room post in flight (PJ_POSTING).
- Both tour-wait tests carry a 5 s timeout, so a regression fails fast instead of spinning a real hour.
- Comments that said a release with no highlights shows "the title alone" now say no window (round 3); render-reload-toast's #270 comparison paragraph is gone.
- The highlights check is driven through the REAL release.sh: a file for another version stops the cut at 1b-ii with nothing bumped, and KOSMOS_CUT_NO_WHATS_NEW=1 lets the same cut through (the harness strips an operator's exported opt-out from every other arm).

## Tests
- The chip's two states and its one button; the stale chip never says "Kosmos updated"; engine-stale still first.
- Safe reload: reloads when hidden and idle; not when visible, sending, drafting, or a dialog is open.
- The window: shown for a new version on a fresh page, with tiles; no window without highlights; not on a fresh install; not on an old page; Got it and Escape record seen; focus trapped and returned.
- whats-new.json shape (committed file, when present) and the check script's red arms (stale version refused, matching accepted, opt-out accepted, bad icon, too many).
- release.sh runs the check at 1b-ii before the bump and at 2b-ii on the frozen tree (round 6).
- Browser check: the three states rendered (shots to the card).

## Not in this change
Windows updater-side differences (Homer); the page is shared, so the chip and the window are the same on Windows.
