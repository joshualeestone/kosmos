# Plan: email-firstaction-909

Vivienne, heads-up 2026-08-25: the Email Assistant role I built tonight
(#909) is the only role in the catalogue whose firstAction needs a
connector Kosmos doesn't have. "Point me at your inbox" requires a live
Gmail/Workspace door; `SVC_BUILT` in web/index.html has no such door,
and `web.svc-doors.test.js` pins Gmail as coming-soon, not built. The
blurb ("Reads every account") makes the same overclaim.

## Change

`engine/roles.js`, the `email` role entry only:
- `blurb`: "Reads every account, drafts replies, and tells you what
  actually needs you" -> "Sorts what is forwarded to it, drafts
  replies, and tells you what actually needs you"
- `firstAction`: "Point me at your inbox and I will tell you what
  actually needs you today." -> "Forward me what is piling up and I
  will tell you what actually needs you today."

Forwarding into the conversation works on any install today; pointing
at a live inbox does not, until a Gmail door ships. Executive
Assistant's blurb has a softer version of the same gap but its
firstAction is conversational, so it's left alone per Vivienne's note.

Caught by challenge-loop iteration 1: the same overclaim also sat in
the `instructions` block, the actual system prompt the spawned agent
runs on -- "You read every account before you report anything" became
"You read everything forwarded to you before you report anything", and
the nearby "a quiet inbox can mean something was already handled"
became "nothing coming in can mean something was already handled" to
match the forward-based model.

Copy only, no code paths touched.

## Verification

- [x] `node --test web.role-picker.test.js engine/create.test.js`:
      107/107 pass.
- [x] Grepped for other references to the old copy ("Point me at your
      inbox", "Reads every account") across `.js`/`.html`: none found.
