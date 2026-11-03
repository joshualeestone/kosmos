# dmfast-7810: a long direct conversation opens fast on a weak signal

Card: kosmos#7810 (Josh 17:06 11-02, on cellular: Splinter's DM sat on "Loading the conversation").

## Finished looks like
Opening a long direct conversation on the iPhone draws messages at once when it has been read before (offline too), and
otherwise draws the newest 30 from a small first read before the full window. A poll of an unchanged conversation costs
no body. Older messages still load on scroll up. Nothing kept on the phone survives a sign-out or another computer.

## Measured (comment 6590822998 on the card)
- One GET /api/agent/claudebot/thread: 167 messages, 102,871 bytes, the newest 200 in one piece; nothing drawn until it lands.
- API answers are uncompressed by rule (engine/pagecompress.js, BREACH); gzip would be 25 KB but is not allowed.
- ChatView re-reads the whole window every 5 s while open; nothing is kept between opens.

## Change
Board (server.js):
- `?tail=N` (1 to 200) on the thread read: only the newest N, olderCount = the position the older-pages route reads from.
  Anything else is a 400.
- `sendJsonTagged`: the thread read carries an ETag (sha256 of the body); If-None-Match naming it gets a bodyless 304.
Phone:
- Board.threadRequest(tail:tag:), Board.threadFirstPage = 30, ThreadRead.unchanged for a 304.
- BoardClient.threadRead(for:tail:tag:) keeps the last whole window per account, computer and agent in Caches
  (file named by a sha256 of the three); keptThread reads it; forgetChats removes the folder.
- ChatView: kept copy drawn at once; the first read with nothing shown asks for 30, then the whole window straight
  after; polls name the shown window's tag once a whole window has landed. Earlier pages, the gap fill and carryDropped
  wait for a whole window read in this open (a kept copy's or a small page's positions are not the next read's).
  A refusal with only a kept copy or small page shown clears it, so the reason is drawn.

## Rejected
- Compressing API answers (the BREACH rule stands).
- `since=` diff reads: deliveries, reactions and deletions change old rows; an ETag sees any change.
- Changing project rooms here: #7365 (Renet) shares the 5 s full poll; the same ETag helper can be applied there next.
- Keeping the kept copy's ETag for its first poll: a 304 would then leave a waiting question's buttons undrawn (the
  kept copy has none), so the first read after a kept copy is always whole. A follow-up could keep the tag when the
  kept body asked nothing.

## Weakest premise
A kept copy is shown as if current until the first read lands; on a dead link the header only says so after 3 failed
reads (about 45 s). 30 as the first page is a guess at "fills a screen"; it is one constant. A reader who scrolls up
within the second or two between the small page and the whole window can be moved when the whole window lands (the
older rows arrive above them); kept as a known limit, not measured on a device.

## Tests
- server.dmtail-7810.test.js: tail=30 newest and positions agree with /thread/older; short thread whole; ETag 304 then
  200 after a new message; bad tails refused. Mutants (TAIL fixed at 200; no 304) fail it.
- ios/LogicTests/main.swift: request query and If-None-Match; 304 is unchanged; client keeps only whole windows, reads
  the kept copy on the next launch, never for another account, removed on sign-out; a poll naming the tag is unchanged.
- server.ios-routes-6838.test.js: the new request declared in SITES.
