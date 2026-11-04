# manualtoast-7938: a manual update offer shows the update chip too

Card: kosmos#7938 (found in the review of #7935). The update toast (renderUpdateToast, web/index.html) read only the
in-app install offer (`data.update`), so a board whose newer version came only as a manual offer (`data.updateManual`:
Windows in a folder the updater refuses, OneDrive or Program Files; Linux once #7935 turns its in-app path off) showed
nothing outside Settings, Updates.

## What finished looks like
With a manual offer and no install offer, the same "An update is available" chip shows and says where to install it
(Settings, Updates; on Kosmos+, the Kosmos computer). It has no button, since nothing in the toast installs. The install
offer's own chip and Update button are unchanged.

## Change
- web/index.html: renderUpdateToast(u, manual). With no install offer and a manual one, the chip reads "An update is
  available: Settings, Updates shows how to install it" (remote: "install it on your Kosmos computer, in Settings,
  Updates"). Later on that version quiets it, an update under way hides it, as for the offer. Keyed per version and place.
- Both callers pass the manual offer: the status read (data.updateManual) and the update check (out.manual).

## Decided
- No button. Rejected: a button that opens Settings at Updates, because the page has no helper to open a section and the
  card asks only that the toast point there. The text names the place.
- Independent of #7935 (not merged yet): keyed on the manual offer, so Windows is covered now and Linux once #7935 lands.
- Weakest premise: that `updateManual` is set only when there is no install offer. If both were set, the install offer
  wins, which is the safe choice (its button installs).

## Tests
web.manualtoast-7938.test.js (the real renderUpdateToast lifted from the page): the manual chip and its wording, no
button, the remote wording, the install offer unchanged, Later and updating, redraw only on a new version, both callers.
Control: on main's web/index.html the new tests fail. Existing toast tests (web.reload-toast, web.noise2-6533,
web.win32-board-copy) pass.
