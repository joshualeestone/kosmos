# addcancel-7682: an x on the iPhone's "Adding a file..." line (kosmos#7682)

Finished means: on the iPhone a person whose add has stalled can tap an x beside "Adding a file..." and the line goes at
once, in that chat only; the upload itself is cancelled; a late answer attaches nothing and writes no line; the rest of
a multi-file pick is not sent; a later add's count is untouched by an older add ending; a sign-out cancels uploads.

Decided, with reasons:
- No timer on a photo load: a task group waits for every child, so a load ignoring cancellation would still block. The x
  is the way out. Upload keeps its 300 s idle timeout (Board.uploadTimeout) for large files.
- No "tap to retry" after a timeout: picking again is the retry.
- Each add carries a per-chat generation; the x and a sign-out move it, so a stale add's defer leaves the count alone.
- Rooms share the client's cancel but keep their own pick loop (RoomView), with the same check.

Open on the card: why the line showed in another chat is not explained (keyed by agent.session, rooms by "room:<project>").
