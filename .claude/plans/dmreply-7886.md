# dmreply-7886: a direct agent-to-agent message says how to answer it (kosmos#7886 item 3)

Split with Mona Lisa on #7886: item 3 is Renet Tilley's.

## The defect
A direct message arrives as `[message from your colleague <name> · m<id>]` with no answer line. Room posts carry
`to answer, run: kosmos post --in-reply-to <id> <project>`, so agents copy that shape, and `kosmos post --in-reply-to
<dm id>` has no project to give: they get a usage line. The board already accepts `in_reply_to` on `/api/msg`
(engine/messages.js checks the sender was part of the cited message), but `kosmos msg` has no flag to send it.

## The change
1. `kosmos msg` takes a leading `--in-reply-to <id>` (with or without `--stdin`, either order) and sends
   `in_reply_to`. Both CLIs: install/kosmos and tools/windows/kosmos-cli.js (parity, done Mac-side per the 09-28
   scope note; Homer asked to confirm one real run, not gating).
2. The direct-message envelope ends with ` · to answer, run: kosmos msg --in-reply-to <id> <sender>`, the sender
   being its session name (what `kosmos msg` takes).

## Decided in review
- A message that itself answers another (sent with --in-reply-to) carries no answer line, as a room answer is not
  invited to reply (#7246), so each answer does not ask for one more round. The instruction block says so, and that a
  new question goes without --in-reply-to.
- A sender name with a space is single-quoted in the answer line (the charset gate allows a space and no quote).
- The longer prefix moves a message near chat's typing cap to an Inbox file a little sooner (spillsAt measures the
  whole prefix); accepted.
- Not done: a sender name starting with -- (the CLIs refuse it as an option); needs a deliberately odd session name.

## Rejected
- Teaching `kosmos post --in-reply-to <dm id>` to forward to msg: two verbs for one act, and post's project
  argument would have to become optional.
- Only a better usage line: the agent still has to discover a command nobody named.

## Weakest premise
Every envelope reader (musefront's opening check, marker checks, tests pinning the prefix) tolerates a longer
bracket. Measured by running every test that names the envelope, not assumed.
