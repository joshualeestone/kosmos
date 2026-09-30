# strandedwords-4645: the app reads both wordings of two coordinator answers (kosmos#4645, kosmos half)

#4628 rewords the coordinator's answers from "your Mac" to "your computer", but two had to keep "Mac" because
clients recognise them by their words. This is phase 1: the readers accept both wordings, so the coordinator can
reword them once installs carry this. The kosmos-relay half (the connector's FINAL_REFUSALS) is its own branch of
the same name in that repo.

## Finished means
The desktop app treats "already in use by a computer on this account" exactly as "... by a Mac ...", and "this
computer was retired" exactly as "this Mac was retired"; a test drives each reader with both wordings and goes red
if either stops being recognised.

## Change
- `engine/remote.js` `explainStranded`: `/already in use by a (?:Mac|computer) on this account/i`.
- `engine/fedseats.js` `MAC_LEVEL_REFUSAL`: `this (?:mac|computer) was retired` (a third reader the card did not list;
  found by grepping the engine for both phrases).
- `engine/remote.test.js`: fake-tunnel modes `register-409-computer` and `setup-409-computer` (checked before their
  Mac modes, which match by substring), and the stranded register and Settings setup arms run in the new wording too
  (the setup arm rebuilds its stranded start, since the first attempt consumes it).
- `engine/fedseats.test.js`: a member refused with "this computer was retired" is a slow retry, as the Mac one is.

## Rejected
- Matching a code instead of the sentence: #4628 publishes `mac_retired` and `name_on_this_account`, but the app
  reads these answers as the connector CLI's stderr text, which carries the sentence, not the code.
- Rewording the coordinator here: phase 2, after installed apps and connectors carry these readers.

## Measured
- 177/177 in fedseats.test.js + remote.test.js. With main's remote.js and fedseats.js, exactly the three new arms fail.

## Weakest premise
The new wordings are the ones I expect #4628's phase 2 to use ("a computer on this account", "this computer was
retired"). If phase 2 picks other words, these readers must follow; the card and #4628's MATCHED_BY_WORDS say so.
