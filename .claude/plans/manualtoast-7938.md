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
  as the Settings card's manual arm), the chip reads "An update is available in Settings, Updates" (over Kosmos+, kplusRemote:
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
- Review 2:
  - the chip names Settings, Updates (43 characters, remote 42; the browser measurement says whether it fits the pill);
  - deferred, by design: the chip cannot be dismissed. Neither can the install chip from the toast; #3955 (Josh's mock A)
    moved Later off the chip, and the manual offer has no confirm dialog to carry one;
  - the toast and the Settings card keep the same "complete manual offer" condition, each commented to the other and
    pinned by a test (a shared helper broke the card's existing lifted-function tests, which lift the painter alone).
- Weakest premise: that a chip which cannot be dismissed, until the update is installed by hand, is acceptable on
  Windows. It is the same persistence the install chip has.

## Tests
web.manualtoast-7938.test.js (the real renderUpdateToast lifted from the page): the manual chip and its wording, no
button, the remote wording, the install offer unchanged, Later and updating, redraw only on a new version, both callers,
a missing download, the text length, the shared condition.
Control: on main's web/index.html the manual-arm tests fail (the no-offer and install-offer tests pass there by design). Existing toast tests (web.reload-toast, web.noise2-6533,
web.win32-board-copy) pass.
