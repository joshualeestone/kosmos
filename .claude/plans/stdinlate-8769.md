# stdinlate-8769: a lone --stdin after the target is the flag (kosmos#8769, item 5 only)

Card: kosmos#8769 (tonight's feedback bundle); Angel takes item 5 only, the others stay open.
Repro (measured 11-19 14:2x CST): `kosmos post --in-reply-to m4861 fleetbuilders --stdin` exits 2, "--stdin must come
before the project id"; the same with --stdin first posts.

## Finished means
`kosmos post <project> --stdin` and `kosmos msg <agent> --stdin` read the message from stdin exactly as the leading form
does, in BOTH CLIs (install/kosmos and tools/windows/kosmos-cli.js). A --stdin beside other words after the target is
still refused, as #2909 made it (that is the case where the literal word would be posted and the pipe dropped).

## Decided
- Accept only the LONE trailing --stdin. Its one reading is "the message is on stdin". Beside other words it is
  ambiguous (is "--stdin" message text?), so the #2909 refusal stays there. Rejected: accepting --stdin anywhere (a
  typed message containing the word would silently switch to reading a pipe nobody wrote to).
- msg and post together, in both CLIs, so the commands keep behaving alike (the card's "make every flag behave the
  same"). `kosmos reply` already takes --stdin first only and is unchanged (its target is implicit).
- Late --no-reply / --in-reply-to are unchanged (msg refuses with a tip; post treats them as text).

## Weakest premise
That no script relies on the refusal for a lone trailing --stdin. The refusal only ever produced exit 2 with nothing
posted, so a caller that hit it was already failing.

## Tests
cli.post-stdin-2909.test.js, cli.msg-stdin-2909.test.js, tools.windows-kosmos-cli-570.test.js: the lone trailing form
posts/sends the piped text; --stdin beside words (before or after them) is refused with nothing sent.
