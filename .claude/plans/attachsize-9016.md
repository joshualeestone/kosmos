# attachsize-9016: the phone sends only a whole file, and says its size (kosmos#9016, the phone half)

Finished means: a file picked on the iPhone whose copy is not the whole of the person's file (shorter or longer, or
the source changed during the copy) is refused on the phone before a byte goes, in the board's words ("That file did
not arrive whole; please send it again."); and every upload says how many bytes it carries (X-Attachment-Size), so
the Mac can refuse a body that arrives cut (Angel's board half, branch attach-9016). Slice 2, after the board half
lands: attachment cards say "incomplete upload, please send again" where the row has incomplete: true.

## Contract (Angel, #9016, 17:2x CST 11-24)
- X-Attachment-Size: decimal digits, the size of the sender's own file as it read it. No header: the board checks
  nothing (older phones keep working).
- A mismatch at the board: 400 with "that file did not arrive whole; please send it again (64 KB of 112 KB arrived)".
- Source versus copy on the phone: refuse there with the same sentence.

## Built
- BoardLogic.prepareUpload(from:): the source's size is read fresh (attributesOfItem, not the URL's cached resource
  values) inside the file coordinator before and after the copy; the copy's size must equal both. Otherwise the copy's
  folder is removed and the pick is refused with Board.notWhole. A size the phone could not read is not held against
  the file (as before).
- Board.withSize: sets X-Attachment-Size; BoardClient.attach applies it to every upload request (agent chat and project
  room both go through it), with the prepared size (the copy's, equal to the source's once checked; a photo's byte
  count).
- LogicTests: copyIsWhole both ways (cut at 64 KiB, growing source, longer copy, unreadable sizes), the sentence, the
  header, and the size that reaches the fake Mac on a real attach. Two mutations (no header; check always passes) each
  turn run.sh red.

## Round 1 (opus, blind) fixes
- WARNING fixed: a picked symlink was measured and copied as the link (49 bytes, measured by the reviewer) while the
  upload followed it and sent the whole file, so the Mac would refuse a file that goes today (and a linked file
  skipped the 100 MB limit, before this branch too). The coordinator's URL is now resolved first; the real file is
  measured and copied, and a link to a folder is refused as a folder is (never copied whole).
- WARNING fixed: the check inside prepareUpload could not fail a test (only copyIsWhole was tested). prepareUpload takes
  the size reader as a parameter (freshSize by default); tests drive it: a source growing under the copy and a copy cut
  at 64 KiB are refused with their copy removed, the source is read twice, a link is followed to a regular-file copy
  of the right size, a link to a folder is refused. Mutations (no guard; the before size in both slots; no link
  follow) each turn run.sh red.
- NIT fixed: a dead `size >= 0` check in withSize.
- NIT left, with reason: the room route's header is not asserted on its own. Both routes reach the Mac only through
  BoardClient.attach's one call, which the agent-route test guards; the room harness tests request builders only.
- NIT, for the Mac half: its sentence starts lowercase ("that file did not arrive whole...") and the phone shows the
  Mac's error as it is; asked on #9016 that it be capitalised to match the phone's own refusal.

## Round 2 (sonnet, blind, whole branch): nothing above nit. Converged.
- Its unlisted mutation (no link-to-folder branch) run: turns run.sh red (FAIL 1 of 2319).
- Found after convergence by the node suites that read the Swift: freshSize used FileManager.attributesOfItem, a
  required-reason API (file timestamps) the app's privacy manifest does not declare (ios.privacy-manifest-7352). It
  now reads URL.resourceValues(.fileSizeKey) after removeAllCachedResourceValues, the API the app already used.
  Every logic suite (15) and the ios.* node tests pass again.

## Rejected
- Sending the size Files gave before the copy: it can be a cloud placeholder's, which is why the coordinator re-reads.
- Comparing only before-copy: a file still being written can grow during the copy; both reads are needed.

## Weakest premise
The source's size, read twice around the copy, may be stable while its content changed (a rewrite in place of the
same length). Nothing here can see that; the board's zip check covers office files.
