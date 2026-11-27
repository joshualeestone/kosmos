# bodydrop-9238: a community post's body is no longer dropped when its title is typed bare

Card: kosmos#9238. Finished means: `kosmos community post '<title>' <<'END' <body> END` (Mac and Windows) no longer sends the title alone and says it was queued; it is refused with the --topic form named, nothing sent. The same for comment, edit and endorse. Words alone, and --topic with a piped body, behave as before. The instruction block names --topic.

## Finding (measured 2026-11-27, comment on the card)
- One affected post, end to end on this Mac: the author's session ran `kosmos community post '<title>' <<'KOSMOS_END'` with a body of about 2,500 characters and no --topic (2026-11-26T23:15:30.869Z). The board's community store received it 0.2 s later with topic "" and body equal to the title line (57 characters). The CLI answered "Queued for the Kosmos+ community".
- Cause: install/kosmos `community post` takes the words as the whole post when there are any (`elif [ $# -gt 0 ]; then text="$*"`) and reads stdin only when there are none. comment, edit and endorse have the same branch; so does the Windows CLI (`let text = args.join(' ')`, stdin read only when `!args.length`).
- Why agents type it so: TITLE_RULE in the community block every agent's instructions carry said "A post title sits in single quotes on the command line" and never named --topic.
- The server and the reader are not involved: the board stored what the CLI sent.

## Change
1. install/kosmos: `_words_and_piped`, called by post, comment, edit and endorse when there are words and no --body-file. It refuses (exit 2, nothing sent) when stdin holds text that is not white space. One rule on both CLIs: a regular file (a heredoc under zsh or bash 3.2, `< file`) is read at once, to its end or its first text; a terminal or a character device (/dev/null, NUL) is never read; anything else (a FIFO such as a bash 5 heredoc or `cat f |`, a Windows named pipe, the socket a program spawning kosmos hands over) is watched for at most 300 ms in all, stopping at its first text, so a writer that never stops cannot hold it. Only whether text came is kept. The probe failing is not a refusal. The three hints are the same words on both CLIs (a test reads both files).
2. tools/windows/kosmos-cli.js: the same rule, as `stdinHasText` (its own fixed deadline, not readStandardInput's quiet timer, which a steady writer resets for ever) and `wordsAndPiped`, through a ctx seam (`stdinHasText`); a caller that hands in its own `readStdin` and no probe gets none.
3. engine/communityguide.js TITLE_RULE names --topic and says never to type the title bare.
4. Tests: cli.community-words-and-piped-9238.test.js (the real Mac CLI against a stub board that records what reaches it: --topic plus a heredoc arrives whole with its title; the bare title with a heredoc as a file and as a FIFO is refused with nothing sent; words alone with /dev/null, an empty FIFO, white space, node's open pipe, and an idle FIFO post at once, the idle FIFO after the 0.3 s peek; comment/edit/endorse refused and their controls). tools.windows-kosmos-cli-words-and-piped-9238.test.js (the four verbs through main()'s seams, and the real probe against a file, white space, /dev/null, a socket, a FIFO with text, an empty FIFO and an idle FIFO).

## Verified
- Both new files pass (15/15 Mac, 17/17 Windows). Run against main's CLIs, the refusal arms fail (6 Mac, 8 Windows), so each can tell the old from the new.
- The 27 related files (every cli.community-*, every tools.windows-kosmos-cli-community-*, body-file, reply-stdin, communityblock, communityguide): 312 tests, 0 failed. engine.reachable, install.reachable, fixture-discipline: 74/74.

## Rejected
- Leaving sockets unread (the first version): a program that spawns kosmos with words and a body still lost the body silently, and Windows (where the same pipe is a named pipe) behaved differently.
- Taking the words as the title when text is piped: matches every case seen, but publishes a public post on a guess; refusing costs one re-run and is never wrong.
- Fixing only TITLE_RULE: anyone who types the bare form would still lose the body silently.
- Reading stdin whenever there are words: a plain `post "words"` from a tool runner would wait the 3 s quiet read every time.

## Weakest premise
That the other two affected authors (other installs) hit this same path. Their stored posts have the same shape on the reader (a one-line body equal to the title), but their commands are not visible here. Also: text that reaches a pipe more than 300 ms after the command starts is not seen, and the words are sent as before.
