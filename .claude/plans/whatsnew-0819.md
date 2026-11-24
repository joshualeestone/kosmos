# whatsnew-0819: the What's New list for 0.8.19

Built with `node tools/whats-new-pool.js build 0.8.19` (online) on origin/main at 1b2e16d891, which carries #8940, #8947 (#8938 item 4), #8949 (#8948) and #8843 (#8841).

## What the build did
- Read Mac prod 0.8.18 (promoted 18:24 CST 11-23) and marked its four Mac-visible highlights shown (`shownIn: 0.8.18`); `lastProd` 0.8.17 -> 0.8.18. Windows prod is still 0.8.17, so the Windows-only "Browsers Kosmos opens keep its keys out" stays pending and is shown again here; Windows users have not seen it.
- Picked the top five pending highlights.

## Pool additions
- **Spreadsheets reach your agent row by row** (#8940, all platforms, rank 12.9, `since: 0.8.18`): Ice Cream Kitty's wording. It rode 0.8.18 but missed that list (decided 13:18, recorded on #8940). The xlsx path in engine/attachtext.js is plain JavaScript; the one darwin gate there is the PDF reader (PDFKit), so the line is untagged.
- **Signing in again keeps your invitation** (#8947, all platforms, rank 13.0): Mona Lisa's wording. "who it is for" is the sheet's label, which the return note keeps; the optional email is never kept (the plan for #8947 says so), and the line does not claim it.
- **Agents trip over the command line less** (#8949, notesOnly): PigeonPete's line, shortened to fit 140 characters: did-you-mean on a mistyped command, and feedback day for an earlier day. Agent-facing, so notes only.

## Not added
- #8843 (#8841, Settings names the reason when readings or moves are off by the start environment): it shows only for an operator who set an environment brake, not for a person using Settings. No line.
- e6e75bab64 (#8939, iPhone): the iPhone app is not in this window.

## The list (5)
- windows: Browsers Kosmos opens keep its keys out (since 0.8.03)
- all: Spreadsheets reach your agent row by row (since 0.8.18)
- all: Signing in again keeps your invitation (since 0.8.19)
- all: A task says how many subtasks are on hold (since 0.7.95)
- mac: Agent browsers left running are closed (since 0.8.18)

Per platform: Windows 4, Mac 4, Linux 3.

## Checks
- `prod-check`: rc 0 (prod 0.8.18 Mac, Windows 0.8.17, both recorded).
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).

## Weakest premise
That the spreadsheet line holds on Windows: I read attachtext.js for platform gates, not a Windows run.
