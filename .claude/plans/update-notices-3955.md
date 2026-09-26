# update-notices-3955: a small update chip, and a "Kosmos has been updated" window

Card #3955 (Josh, #admin, 2026-09-26 08:11). Design: Mona Lisa's mock on card-shots/3955 (chip A, chip B, modal C). Highlights file: agreed with Baron on the card (13:32Z).

## What finished looks like
- Before an update, the top bar shows one small chip beside the Kosmos switcher: "An update is available" with a gold Update. Nothing else about the update is on screen.
- When Kosmos updated underneath an open page, the same chip reads "Reload to finish updating" with Reload, and the page reloads itself when the window is in the background and nothing is being typed or sent. Nothing says "Kosmos updated" while the old page is showing.
- After the new version is on screen (a manual Update or an auto-update), a centred window over a dimmed app says "Kosmos has been updated", a version pill, and 1 to 5 tiles (icon, title, one line) from web/whats-new.json when that file is for this version (otherwise the title only). Got it or Escape closes it; it is not shown again for that version. A fresh install never shows it.
- The old "Kosmos updated to 0.6.94 [x]" line and the "Updated. You are on Kosmos X" note are gone.
- A cut refuses when web/whats-new.json is not for the version being cut, unless KOSMOS_CUT_NO_WHATS_NEW=1.

## Decisions
- **Chip, same slot.** #utoast-slot already sits inline beside the switcher (Josh, 2026-08-17); the chip replaces what is drawn in it. The engine-stale state keeps its place (it outranks both) and its words.
- **One action.** The offer chip has only Update (the card: "the single action it needs"). Later is gone from the chip; a Later someone pressed on an older page still quiets that version for its window (the reading code stays; nothing new writes it). Weakest premise: a person who wants it gone for now has no button; the chip is small by design.
- **Automatic reload, only when it cannot lose anything:** the page is in the background (document.hidden), no message is being sent and no composer holds a draft, and no dialog is open. Otherwise the chip waits for the person. Rejected: reloading a visible page mid-glance.
- **The window's source of truth.** /api/whats-new already records "seen" per version on the board (seen-version.json, survives restarts and browsers); it now also carries the highlights from web/whats-new.json when that file's version equals the running version, else none. The page shows the window only when its own baked version equals the board's (never over an old page), the board's version is not the one recorded as seen, and a version has been seen before (a fresh install records silently, as the news line did).
- **Highlights file:** `web/whats-new.json` `{"version":"X.Y.Z","highlights":[{"icon","title","line"}]}`; 1 to 5; icon one of swarm, tasks, phone, list, chat, shield, spark (drawn by the app); title up to about 40 characters, line one sentence up to about 120; no em dashes. A suite test enforces the shape of the committed file. The server validates again at read time and serves nothing it cannot draw.
- **Cut guard:** tools/whats-new-check.js (node, pure) checks the file against the version; release.sh runs it as step 1c, right after the versions entry (1b) and before anything is built or bumped. KOSMOS_CUT_NO_WHATS_NEW=1 skips it and prints that the release will show only the title. docs/releasing.md gets the line. The guard lands only while no cut is running.
- **This change ships no highlights file** for a past version: the operator writes it for the cut it ships in (Baron's 0.6.98 at the earliest).

## Tests
- The chip's two states and its one button; the stale chip never says "Kosmos updated"; engine-stale still first.
- Safe reload: reloads when hidden and idle; not when visible, sending, drafting, or a dialog is open.
- The window: shown for a new version on a fresh page, with tiles; title only without highlights; not on a fresh install; not on an old page; Got it and Escape record seen; focus trapped and returned.
- whats-new.json shape (committed file, when present) and the check script's red arms (stale version refused, matching accepted, opt-out accepted, bad icon, too many).
- release.sh runs the check at 1c before the bump.
- Browser check: the three states rendered (shots to the card).

## Not in this change
Windows updater-side differences (Homer); the page is shared, so the chip and the window are the same on Windows.
