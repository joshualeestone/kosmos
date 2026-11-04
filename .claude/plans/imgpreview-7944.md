# kosmos#7944: tap a picture waiting on the iPhone composer to see it, with Remove as its only action

Josh, 11-04 08:28 and 08:35 (Kosmos, iPhone): tap an unsent image to see it large, "only the remove feature from a
button perspective and skip caption or edit"; and unsent images show as small thumbnails, not file names (his
references are private, kept off the card).

## Finished looks like
- A picture waiting on the composer (agent chat and project room) is a 56 pt square of itself with an x on its corner.
- Tapping the square drops the keyboard and opens a large sheet: the file's name, the picture, one red Remove.
- Remove (or the x) takes it off the composer; swipe down closes the sheet and keeps it.
- A file that is not a picture, or a picture ImageIO cannot read, is the plain name chip as before.

## How
- The phone's own copy is deleted once the Mac has it, so `Board.attachedPicture` makes two JPEGs while that copy is
  still there: `large` (long side 1600 px, for the sheet) and `small` (336 px, for the 56 pt square), from one
  ImageIO source, upright from EXIF. Tens of KB to about 0.5 MB each, ten files at most.
- Order in `BoardClient.attach`: upload, then the file goes on the composer, then the copy is made off the main
  thread, then `keepPicture` keeps it only if the file still waits there under the same chats. So nothing waits
  between the guard and the upload (review 1), and the x on "Adding a file..." during the copy cannot drop a file
  the Mac already has (review 3); the square fills in when the copy is ready. The file stops counting as on its way
  the moment it lands, before the copy (review 5), so Send, the ten-file count and "Adding a file..." never wait on it.
- `attachedPreviews` is pruned in `attached`'s didSet, so every way off the composer (x, Remove, send, forgetting the
  chats) drops it. A file put back after a failed send returns as a plain chip (accepted).
- The sheet hangs off the + (always on screen), not the chip row, which goes with the last file (review 3); it
  shows the picture as it was when tapped, so Remove does not blank it as it slides away (review 5), and it closes
  if its file leaves the composer. Remove is a fixed red #b3261e in both themes (white on it about 6.6:1; the dark
  theme's dangerWord would put white under 3:1), and VoiceOver hears "Removed <name>".
- The x is centred on the square's corner, its 44 pt place inside the row (review 1); a quarter of it lies over the
  picture, as in Josh's reference (deferred in review 4 as deliberate). The chip row is bottom-aligned (review 4).
- Types: JPEG, PNG, HEIC/HEIF, GIF, WebP, TIFF, BMP, AVIF, DNG, or those endings when the type is empty or generic.

## Measured
- Logic tests: all suites pass (main 1941/1941). Type/name rules with controls; the 1600 px cap, no upscale, EXIF 6
  upright, a fake picture keeps nothing; client: a real photo keeps both copies (small 336x252), the PDF beside it
  none, the x drops it, a send drops it; keepPicture refuses a removed file and an earlier account (CONTROL: a waiting
  file keeps it); at the copy's start the photo is already waiting and no longer counted. Mutants: prune disabled,
  3 red; keepPicture's guard removed, 2 red; the early stop of the count removed, 1 red. All restored.
- UI test AttachedPreviewUITests (opt-in, KOSMOS_UI_PLUS): tap opens, names the file, Remove closes and takes only
  that file (CONTROL: the PDF stays). StopAddingUITests still pass. Light and dark, iPhone 17e, iOS 27.0.

## Weakest premise
Simulator only; a large HEIC from a real camera is not measured for the time the copy takes (off the main thread,
after the file is on the composer and no longer counted as on its way, so a slow copy only delays its square).
