# kosmos#9243: the round-8 follow-ups to #9240 (delivery checks)

Routed by Splinter 19:53; shapes suggested by Renet Tilley (m7263), adopted with one change noted below.

## Done
1. Direct-message outcomes in both CLIs (install/kosmos msg, tools/windows/kosmos-cli.js msg) no longer say "check
   with them" (the probe #9240 removed):
   - timeout, and Windows' asked-once-more: "...may have been delivered; with no id, kosmos msg --status cannot check
     it, so wait for their answer before sending it again." (no id is printed on a timeout);
   - unconfirmed: "Not confirmed: <why>. Do not send it again: if an id is shown below, kosmos msg --status says later
     whether they read it; if not, wait for their answer." Changed from Renet's shape: the id line below prints only
     when the server returned an id (_say_msg_id, sayMsgId), so the sentence must not promise one.
   Pinned word for word in both files (cli.msg-noprobe-9243), red with the old Mac line put back.
2. Nothing real to send yet: "a real message is the check: there is no test message to send" (engine/projects.js
   member rule). No read is named, since none is verified to answer "is this colleague up".
3. "Kosmos cannot tell" (engine/msgstatus.js's own words) joins the no-resend clause.
4. A room post: "the post command says whom it reached, or that it could not post" (say_unreached prints "we could not
   post that").

## Not touched
engine/defaults.js (doctrine), on Renet's note: this is the project block, not doctrine.

## Weakest premise
That agents read the CLI's line right after their own send. It is the likeliest thing they read at that moment.
