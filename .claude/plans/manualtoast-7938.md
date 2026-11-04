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
- web/index.html: renderUpdateToast(u, manual). With no install offer and a complete manual one (version and download,
  as the Settings card's manual arm), the chip reads "An update is available in Settings" (over Kosmos+, kplusRemote:
  "Install the update on your Kosmos computer"). Later on that version quiets it, an update under way hides it, as for
  the offer. Keyed per version and place. `.uchip.noact`: even padding, since there is no button (and at 480px or less).
- Both callers pass the manual offer: the status read (data.updateManual) and the update check (out.manual).

## Decided
- No button. Rejected: a button that opens Settings at Updates, because the page has no helper to open a section and the
  card asks only that the toast point there. The text names the place.
- Independent of #7935 (not merged yet): keyed on the manual offer, so Windows is covered now and Linux once #7935 lands.
- The two offers cannot both be set: engine/update.js installOffer() is null when windowsLocationRefusal() is true, and
  manualOffer() needs it true (server.js calls them mutually exclusive). Were both set, the install offer wins.
- Review 1: kplusRemote, not offlineRemoteView (false on Windows, the platform a manual offer comes from), and copy short
  enough for the pill (it does not wrap above 480px, and the stack is 460px at most); measured in a browser.
- Weakest premise: that "in Settings" is enough of a pointer without naming Updates; the Updates card is where the
  version line sits, and naming it made the pill too long.

## Tests
web.manualtoast-7938.test.js (the real renderUpdateToast lifted from the page): the manual chip and its wording, no
button, the remote wording, the install offer unchanged, Later and updating, redraw only on a new version, both callers.
Control: on main's web/index.html the new tests fail. Existing toast tests (web.reload-toast, web.noise2-6533,
web.win32-board-copy) pass.
