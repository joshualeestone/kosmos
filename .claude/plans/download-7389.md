# download-7389: the iPhone app saves a Kosmos+ download (the iOS half of #5167)

Card: kosmos#7389. Design: Mona Lisa's comment on the card (17:3x CDT 10-27). Mac reference: native-app/main.swift,
the #5167 blocks (isSameOriginDownload, isBoardPage, kosmosPlusReservedLabels, the two decidePolicyFor delegates,
tellDownloadFailed) and #7384 (every refusal said, refusalShouldShow).

## Finished looks like

In the iPhone app, tapping a file on a board over Kosmos+ (an attachment's Download, or a file in a Files list) opens
the iOS share sheet with that file once it has arrived (Save to Files, AirDrop, send on). A download taking more than a
second shows "Getting <name>" with Cancel at the bottom. Anything refused is said once, in the Mac's words.

## Rules (carried from the Mac)

- Only from the board page's own origin, and only when the page is a board (a Kosmos+ computer, not a reserved
  Kosmos+ name; the phone has no local board of its own).
- Never a 204/205, a non-2xx, or a sign-in page saved as the file: "Kosmos could not get that file. Try again in a
  moment." (phone-only wording, Mona Lisa).
- Refusals, same words as the Mac where the case is the same:
  - not from this board's address: "That file is not from this board, so it was not saved."
  - an attachment from elsewhere: "The file came from somewhere Kosmos does not save from, so it was not saved."
  - the page is not a board: "This page is not a board Kosmos saves files from, so the file was not saved."
  - the download fails: "The file could not be downloaded (<the system's reason>)."
- Each refusal said once, guarded so a page cannot pile them up (the Mac's refusalShouldShow).
- No question before the sheet (unlike the Mac): nothing is kept until the person picks in the sheet, so the sheet is
  the consent. Closing it keeps nothing and says nothing.

## Steps

1. Pure logic (new DownloadLogic.swift, compiled into LogicTests): isSameOriginDownload, isBoardPage with the
   reserved labels (a copy, as the Mac's is, of kosmos-relay signin.rs RESERVED_NAMES), the response classifier
   (save / refuse(sentence) / show), the refusal guard, the file name to use.
2. ContentView's WKNavigationDelegate: decidePolicyFor action (.download for an allowed `<a download>`), a new
   decidePolicyFor response, WKDownloadDelegate (destination in a temp folder of its own, finished, failed).
3. The "Getting <name>" line with Cancel after one second, and the share sheet (UIActivityViewController) on the
   finished file; the temp file removed after the sheet closes.
4. LogicTests for the pure rules with controls; the repo test that reads the app's requests if it needs to know.

## Decided

- Share sheet, not a document picker (Mona Lisa: one step fewer, and it includes Save to Files).
- Weakest premise (Mona Lisa's): that the share sheet reads as "save" to a non-technical person.
- Not measured without a device or a simulator against a real board over Kosmos+; a browser check cannot cover it.

## Review bound

Challenge loop to convergence. Merge on green (beta rule).

## Review 1
- Every board download is an <a download> and never reaches the response policy, so what arrives is judged at its
  destination (Download.decideDestination, the Mac's decideDestinationUsing): 204/205 silent, errors and a web page
  where a file was expected refused (unless the Files page says it itself); an HTML attachment is the file.
- Refusals go through the Mac's guard; failures are always said, never over another message. The person's Cancel
  is quiet; WebKit stopping a download before it had a destination is said. Redirects stay on the page's origin.
- The Getting line belongs to its own download; per-page counts reset on each commit; names lose direction marks.
- Mona Lisa listed 204/205 as said; the Mac keeps it quiet because the board's own page says why. Followed the Mac
  so the person is not told twice.
- Review 2: a refused redirect is marked as said (no second message on its cancel); the Getting lines stack, so a
  download still on its way is shown again with its Cancel when another ends.
