# win-post-handback: the Windows CLI hands a refused post's text back, as install/kosmos does

Found by the blind review of #3804 (kosmos#3224, round 4): on a generic `could_not` from `/api/post`,
install/kosmos prints "Your message was not sent, so here it is to keep and re-post when the room is ready:"
and the text (#2710), while tools/windows/kosmos-cli.js only did that for a #3224 which-room hold. A Windows
agent whose post the loop guard refused lost it with its scrollback.

## Change
tools/windows/kosmos-cli.js verbPost: on any refusal, when the message did not come from stdin, print the
install/kosmos sentence (which-room keeps "send again") and the text. A piped message still goes to its
private file (keepPiped), unchanged.

## Verification
tools.windows-kosmos-cli-570.test.js: a generic refusal hands the text back with the install/kosmos wording,
and a which-room hold keeps its own. Red without the change (40/41), green with it (41/41).

## Weakest premise
Tested Mac-side through the CLI's injected context, not on a Windows machine. The change is plain string
output on a path the same tests already drive.
