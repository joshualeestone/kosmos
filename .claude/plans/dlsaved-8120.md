# dlsaved-8120: a Download says when it saved and cannot save twice; the viewer's button is gold, under the file (kosmos#8120, #8122 first half)

## Why, in Josh's words (11-06, verbatim)
- 12:22 (#8120): "I wasn't really getting an indication that the file was downloading either, which is probably something we should add: just show, like, "Hey the file is..." (a very simple animation showing that the file got downloaded). I hit it three times before I was like, "Well I don't really see that anything's happening." I went over and looked in my Downloads folder and there was the file."
- 12:30 (#8122): "maybe we put the download button right below it or something (so it's not hidden off in the corner like it is right now). And maybe make it our regular gold button color as well."

## Change
The Mac app (native-app/main.swift):
- A `kosmosDownload` message handler. Its presence tells the page the app will report saves. Its one message, `{reveal: <id>}`, shows in Finder a file this app saved, by the id it gave that download, never a path. It is heard from the main frame of the board or of a Kosmos+ computer's page.
- `tellPageDownload` sends the `kosmos-download` event: `saving` once the download has a place in Downloads, `saved` only from downloadDidFinish, `failed` on a failure.

The page (web/index.html):
- `dlWatch` and the `kosmos-download` listener. Events are matched to clicks oldest first.
- The button turns off at once. After 0.4 s it shows the Sweep dots and "Saving". On saved it shows a tick and "Saved to Downloads", with "<name> is in your Downloads folder" in the line and Show in Finder (in the viewer). A failure, or 30 s with no word from the app, puts it back. The button comes back after 6 s (3 s for an icon button).
- Covers the viewer (the download link, and the Kosmos+ button through kplusDownload) and the Files lists (kplusDownload). Without the handler (a browser, an older app) nothing changes.
- The viewer (#8122): the name and the action are centred right under the file, in the regular gold (`--gold-bright`, ink #14161a); Show in Finder is the quiet one. The backdrop is .96. A file shown as a card keeps its name on the card; the bar's copy stays only as the dialog's label. Show in Finder does not close the viewer.

## Not in this branch
The spreadsheet preview (#8122's other half).

## Tests
- native-app download selftest: 3 new rows (41 in all), measured live.
- native-app.download-5167.test.js pins 41.
- render-file-preview-4930: the action is centred under the picture and gold (was: the bottom-left corner).
- A stubbed-app Chromium run of every state (in the PR and the card).
