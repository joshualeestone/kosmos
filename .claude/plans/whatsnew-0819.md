# whatsnew-0819: the What's New list for 0.8.19

Built with `node tools/whats-new-pool.js build 0.8.19` (online) on origin/main at 1b2e16d891, which carries #8940, #8947 (#8938 item 4), #8949 (#8948) and #8843 (#8841).

## What the build did
- Read Mac prod 0.8.18 (promoted 18:24 CST 11-23) and marked its four Mac-visible highlights shown (`shownIn: 0.8.18`); `lastProd` 0.8.17 -> 0.8.18. Windows prod is still 0.8.17, so the Windows-only "Browsers Kosmos opens keep its keys out" stays pending and is shown again here; Windows users have not seen it.
- Picked the top five pending highlights.

## Pool additions
- **Clearer spreadsheets for your agent** (#8940, all platforms, rank 12.9, `since: 0.8.18`): Ice Cream Kitty's line; the title is Mona Lisa's copy read (m6237), so the title and line do not repeat each other. It rode 0.8.18 but missed that list (decided 13:18, recorded on #8940). The xlsx path in engine/attachtext.js is plain JavaScript; the one darwin gate there is the PDF reader (PDFKit), so the line is untagged.
- **Signing in again keeps your invitation** (#8947, all platforms, rank 13.0): Mona Lisa's wording. "who it is for" is the sheet's label, which the return note keeps; the optional email is never kept (the plan for #8947 says so), and the line does not claim it.
- **Agents trip over the command line less** (#8949, notesOnly): PigeonPete's wording (m6236): "A mistyped kosmos command suggests the right one, and an agent can look back at an earlier day before writing its feedback." My first shortening said an agent could "read its feedback report" for an earlier day, which is not what feedback day does (it shows that day's work so the agent can write the report). Agent-facing, so notes only.

## Not added
- #8843 (#8841, Settings names the reason when readings or moves are off by the start environment): it shows only for an operator who set an environment brake, not for a person using Settings. No line.
- e6e75bab64 (#8939, iPhone): the iPhone app is not in this window.

## The list (5)
- windows: Browsers Kosmos opens keep its keys out (since 0.8.03)
- all: Clearer spreadsheets for your agent (since 0.8.18)
- all: Signing in again keeps your invitation (since 0.8.19)
- all: A task says how many subtasks are on hold (since 0.7.95)
- mac: Agent browsers left running are closed (since 0.8.18)

Per platform: Windows 4, Mac 4, Linux 3.

## Checks
- `prod-check`: rc 0 (prod 0.8.18 Mac, Windows 0.8.17, both recorded).
- An offline build of the committed pool is byte-identical to `web/whats-new.json` (the cut's #7617 check).

## Weakest premise
That "spreadsheets" reads right to a person: it means Excel files (.xlsx, .xlsm); a CSV was already plain text. Platform is measured on all three: Ice Cream Kitty found engine/attachtext.js as blob f4358c2138 (#8940's) in the prod Mac and Linux 0.8.18 tarballs (m6238, m6240), and I found the same blob at app/engine/attachtext.js in the staging Windows 0.8.18 zip (8da9b1fe9a45, the one I signed).
