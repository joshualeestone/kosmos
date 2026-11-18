# dlperm-5167: a download macOS refused in Downloads asks where else to save (kosmos#5167, 11-18)

## What happened
11-18 08:18 CST, the operator's laptop (Mac app, connected to another computer's board through Kosmos+), file preview
of an agent's PDF, Download: "Kosmos could not save that file. The file could not be saved to Downloads (Cannot create
file: Operation not permitted)." The same words on 11-06, which a quit and reopen of the app cleared.

"Operation not permitted" is EPERM. The app is not sandboxed (hardened runtime only), so this is macOS's privacy
protection of the Downloads folder (TCC) refusing the app's write, not a missing file, a taken name or a full disk.

## Theory (NOT measured)
An app update replaced the bundle while the old process was running, so macOS no longer matched the running process to
the grant it held for Downloads; a quit and reopen runs the new bundle, which matches again. It fits both occurrences
(each cleared by a restart) but nothing measured it: the laptop's log is not readable from here, and the operator is not
asked to collect it (Splinter, 11-18).

## Decision
Whatever the cause, the person gets a way through and is told what to do:
- `downloadRefusedByMacOS(error)` (pure, mode selftest rows): the system's reason under WebKit's error is EPERM or EACCES.
- Then, instead of the plain failure alert, one question: "macOS did not let Kosmos save to Downloads", the reason, where
  to allow it (System Settings, Privacy & Security, Files and Folders), and that quitting and reopening may be enough if
  Kosmos was updated while open. Buttons: "Choose Where to Save..." and Cancel.
- On Choose: an NSSavePanel. A file the person picks there is one macOS lets the app write to (the panel is the
  person's own choice). The same request is downloaded again (`webView.startDownload`), and `decideDestination` checks
  its answer as before (status, a web page instead of the file), then saves to the chosen place, never over a file
  (a taken name gets " (2)", as in Downloads).
- Rejected: retrying Downloads silently (the refusal stays until the app restarts or the person allows it); writing
  somewhere the person did not choose (a temp folder they would not find).

## What the page is told (review 1 and 2)
The page is told the save failed, as it did: the save to Downloads did fail. The restart answers no click on the page
(the page's words for a saved file say Downloads, and offer Show in Finder there), so after a save to a chosen place the
page still shows that the Downloads save failed; the app's own question and panel carry the rest. Accepted: telling the
page a file was saved somewhere else needs page words that do not exist yet.

## Limits (review 2)
Only a GET is asked for again (a POST would be sent twice), and only while the page the download began on still shows.
The panel says up front that a taken name gets a number (WebKit never writes over a file, so its Replace cannot be
honoured).

## Weakest premise
That a Save panel choice is writable when Downloads is refused. True for TCC's user-intent rule and measured here for a
read-only folder (EACCES), but the EPERM case itself was not reproduced on this Mac.

## Safety
The restart is a second place the app starts a download itself (kosmos#7952's guard allowed one). It is reached only from
the failure of a download that had already been given a Downloads path, i.e. had passed every check, and asks again for
that same request; its answer is checked again. Pinned in native-app.download-5167.test.js.

## Tests
- Mode selftest: +7 rows (EPERM, EACCES, nested, controls: full disk, taken name, no system reason; the words).
- Live download selftest: the 11-06 read-only-folder arm now answers the question through a seam with a file in a second
  folder; a new row checks the question was asked once with its title and Files and Folders, and the file landed there
  with this app's quarantine mark. The failure count and the title row moved with it (71 rows).
- Source pins: the failure path routes a refusal by macOS to the question, the restart's delegate and chosen place, the
  chosen place after the response checks, never over a file, and the two startDownload places.

## Done when (card)
On the operator's laptop, a refused save asks where else to save and the file lands there. Needs the device and a
release carrying this: parked needs-device after merge.
