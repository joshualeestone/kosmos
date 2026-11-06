# dlsaved-8120: a Download says when it saved and cannot save twice; the viewer's button is gold, under the file (kosmos#8120, #8122 first half)

## Why, in Josh's words (11-06, verbatim)
- 12:22 (#8120): "I wasn't really getting an indication that the file was downloading either, which is probably something we should add: just show, like, "Hey the file is..." (a very simple animation showing that the file got downloaded). I hit it three times before I was like, "Well I don't really see that anything's happening." I went over and looked in my Downloads folder and there was the file."
- 12:30 (#8122): "maybe we put the download button right below it or something (so it's not hidden off in the corner like it is right now). And maybe make it our regular gold button color as well."

## Change
The Mac app (native-app/main.swift):
- `kosmosDownload` message handler: its presence tells the page the app will answer; its one message, `{reveal: <id>}` (a number), shows in Finder a file this app saved, only for the origin that saved it, and answers `revealfailed` when it cannot.
- Every answer is the `kosmos-download` event carrying the page's own key for the click (the `kdl` query value the page put on the download's address): `asking` (sent only when the Allow question is really up: mayDownload's willAsk), `saving` (it has a place in Downloads), `saved` (only from downloadDidFinish), `failed`. A click refused before any download exists is answered too (Don't Allow, a refused link or attachment). Only keyed clicks, and only while the page that asked still shows (pageCommits). A download's key is taken where it begins, only from the page's main frame (noteDownload mainFrame); the refusal answers before any download exists read the request's key, from the main frame on a download click and from the main-frame response on an attachment.
- The Kosmos+ tunnel passes `kdl` through (it strips only `token` and `boot`, kosmos-relay proxy.rs strip_query_params); the board reads only `name`.

The page (web/index.html):
- `dlWatch` puts an unguessable key (crypto.getRandomValues) on the click's address and waits for answers with that key alone. The button is off at once; after 0.4 s the Sweep dots and "Saving" (named "Saving <name>" for a screen reader while it shows only dots) (and "Saving <name>..." in an empty line); on saved a tick and "Saved to Downloads", "<name> is in your Downloads folder" in the line (only if the line's latest click is this one), and Open in Finder (the viewer's own word, pvRevealWord) beside it in the viewer, reachable with Tab; back to Download after 6 s (3 s for an icon button). The file stays busy until then, so a click on Saved saves nothing. A failure puts it back at once. With no answer at all, the button comes back after 2 minutes (a server can take a while to answer, a zip being built). While the app asks Allow, no timer, and the button shows only the dots (never Saving). Once `saving` arrives, a 30-minute ceiling, after which the line says "Kosmos lost track of <name>. Look in your Downloads folder." rather than claim anything.
- Busy is per file (DL_BUSY): a viewer opened again mid-save shows Saving (or Saved, if it has saved and its button is not back yet) and takes the answer and the line (dlAdopt); anywhere else (a Files list redrawn mid-save), a second click on that file says "Already saving <name>." in its line and saves nothing, though the redrawn button itself does not show Saving.
- The viewer (#8122): the name and the action centred right under the file, in the regular gold; the Finder button the quiet one; backdrop .96; a file shown as a card keeps its name on the card; a click on the action row never closes the viewer.

## Not in this branch
The spreadsheet preview (#8122's other half).

## Tests
- native-app download selftest: 8 new rows (46 in all), measured live: keyed answers (asking only when the person is really asked), a refusal before any download, only keyed clicks told, every answer runs in the page, Show in Finder by origin, and only a whole-number id (revealId).
- native-app.download-5167.test.js pins 46, accepts the keyed Allow form (control: a broken decision reds), and pins the Kosmos+ branch's decision and the main-frame key.
- render-file-preview-4930: the action is centred under the picture and gold (was: the bottom-left corner).
- render-file-preview-4930 runApp: the key, a second click, another download's answer, Saving, Saved with Show in Finder, a click on Saved, the button back after 6 s, a reopened viewer mid-save and after it saved, Tab to the Finder button, asking without Saving, no answer at all, the saving ceiling, revealfailed, a failure, two Files-list files out of order; and layout rows for a picture, a 200-line text, an 800 x 3000 picture and a file card on desktop and phone. Chromium and WebKit (WebKit here performs no download for a script click, so its address rows are judged on Chromium).
