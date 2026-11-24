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

## Rejected
- Sending the size Files gave before the copy: it can be a cloud placeholder's, which is why the coordinator re-reads.
- Comparing only before-copy: a file still being written can grow during the copy; both reads are needed.

## Weakest premise
The source's size, read twice around the copy, may be stable while its content changed (a rewrite in place of the
same length). Nothing here can see that; the board's zip check covers office files.
