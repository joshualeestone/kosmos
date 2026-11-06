# elsewhere-8141: an agent that answers its person on another channel no longer reads as silent (#8141)

The same plan is on the card: https://github.com/joshualeestone/kosmos/issues/8141

## Plan

**What Kosmos can see.** It cannot see an answer given outside it. It does keep one signal: an agent can declare where it answers its person with `kosmos reply-channel "<where>"` (#5805, `engine/replychannel.js`, stored on the profile). Today only the first-reply reminder obeys it.

**Places that read as silence (read on main):**
1. The conversation view's **"Nothing back yet."** (`web/index.html` `dmOwesLine`, fed by `chat.dmOwes` on the thread route in `server.js`). Ignores the declared channel.
2. The daily feedback digest, **"Your conversation with your person: nothing today."** and "N from them, 0 from you" (`engine/feedbackday.js digest`). Ignores it too.
3. First-reply reminder: already skips a declared agent. No change.
4. `kosmos inbox --unanswered`: the agent's own list, no claim to the person. Left as is.

**Change:**
- Thread route: with a declared channel and a message owed, the page says "It says it answers you on <where>, which Kosmos cannot see." in place of "Nothing back yet." The two-minute grace stays.
- Digest: the line says what was said **here in Kosmos**, never a bare "nothing today". With a declared channel it adds that the person may have been answered there. Without one, when the person wrote and the agent sent nothing here, it names `kosmos reply-channel`, so the agent can declare it next time.
- Tests: each wording, plus a control showing an undeclared agent still gets "Nothing back yet."

**Rejected:** inferring "answers elsewhere" from a `-discord` session name. A Discord bridge says where an agent runs, not that it answered this person there, so the board would be claiming an answer it cannot see, which is the same mistake reversed.

**Weakest part:** it depends on the agent declaring its channel. An agent that answers elsewhere and never declares still shows "Nothing back yet". The digest hint is the only nudge toward declaring.

## Tests

`server.dm-elsewhere-8141.test.js`: the thread route (declared, undeclared control, a reply in Kosmos still clears it), the page line (escaped, grace kept, the unsent answer first, the old line without a channel), and the digest (declared, empty day, the undeclared hint, no hint when answered or quiet, a throwing reader). `engine/feedbackday-7875.test.js` updated for the "in Kosmos" wording, and its helper now stubs the channel reader so no live store is read.
