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
- The phone's own copy is deleted once the Mac has it, so `Board.attachPreview` keeps a JPEG of the picture (long side
  at most 1600 px, upright from EXIF) taken while the copy is still there. ~30 KB to 0.5 MB each, ten at most.
- `BoardClient.attachedPreviews[id]`, pruned in `attached`'s didSet, so every way off the composer (x, Remove, send,
  forgetting the chats) drops it. A file put back after a failed send returns as a plain chip (accepted).
- Remove is a fixed red #b3261e in both themes (white on it about 6.6:1; the dark theme's dangerWord would put white
  under 3:1). The x on a square is the ink's colour with a ring of the ground, so it shows on any ground and picture.

## Measured
- Logic tests: all suites pass (main 1936/1936). New: type/name rules with controls, the 1600 px cap, no upscale, EXIF 6
  turned upright, a fake picture keeps nothing; client: a real photo keeps a copy, the PDF beside it none, the x drops
  it, a send drops it. Mutant (prune disabled): 3 red, restored.
- UI test AttachedPreviewUITests (opt-in, KOSMOS_UI_PLUS): tap opens, names the file, Remove closes and takes only
  that file (CONTROL: the PDF stays). StopAddingUITests still pass. Light and dark, iPhone 17e, iOS 27.0.

## Weakest premise
Simulator only; a large HEIC from a real camera is not measured for the time the copy takes (off the main thread).
