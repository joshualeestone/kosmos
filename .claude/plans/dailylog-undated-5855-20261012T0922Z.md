# dailylog-undated-5855: the daily-log compiler follows an undated full file, as chat.js does

Card: #5855 (follow-up to step 2). #5900 made `engine/chat.js`'s asideChain follow a full file with no project date.
The compiler's own copy of that rule (`followChain`) did not, so it refused such a conversation. #5917 made main
green by pinning only the refusal; this makes the two agree again.

## Done looks like
1. A thread file with no project date that the real writer rolled over compiles whole, and `followChain` returns
   exactly what `asideChain` returns for it.
2. A dated full file behind an undated one is not followed (the walk drops the date once, never picks one up).
3. Every other compiler test is unchanged and passes.

## The change (`engine/dailylog.js`, `followChain`)
A file whose `projectBornAt` differs from the one being followed ends the walk, unless it has none: then it is
followed and every file before it must have none either. This is asideChain's rule since #5900, restated.

## Cost, accepted because chat.js has it
A project from before conversations were dated, deleted and re-created under its name, reaches the old one's
undated files. That folder was refused before; now it compiles with the old project's rows under the live one's
heading, as chat.js shows them. Rows land on their own days and nothing read is pruned.

## Rejected
- Leaving the compiler refusing: every conversation that began before dates and has since rolled over would keep
  the daily log off for the whole folder.
- Calling `chat.asideChain` directly: it reads only Kosmos's own chats folder (decided in step 2's plan).

## Weakest part
The comparison with asideChain covers one shape (a dated current file and one undated full file). The second half
of the rule is tested on hand-made files without chat.js, so a change to that half in chat.js would not be noticed
here. A reviewer compared the two over 117 hand-made chains and found no difference; that run is theirs.

## What would change my mind
asideChain taking a folder: then call it and delete `followChain`.
