# gapexit8-4898: gap-alarm treats claude-msg exit 8 as a possible loss

Card: kosmos#4898 (found in review of #4877).

## Done looks like
When claude-msg exits 8 on the pane, gap-alarm records the pane post as failed: the card says "did not go", and the
pane is tried again after the usual 3-hour backoff. Exit 7 is still told-but-unsure (the card says "may not have
gone"), because the message is sitting in the pane's composer and sending again would paste it twice.

## Why
#1909 treated exit 8 as a false negative ("the recipient was busy and the message usually did land"). claude-msg's
own exit table now gives exit 8 real losses: "may not have landed (possible non-delivery)", part of the message
arrived, or a menu or blocking prompt was open and the message is unsent. Counting those as told leaves a gap alarm
unrouted until the 6-hour repost.

## Change
- tools/gap-alarm.js: only exit 7 is told-but-unsure; the card note says what 7 means. Exit 8 falls to the failure path.
- tools.gap-alarm.test.js: the told-but-unsure test uses the exit-7 stub; a new test shows exit 8 is a failure,
  not retried inside the backoff, retried after it. The unrecordable-state test uses the exit-7 stub for its
  "(unconfirmed)" log-line check.

## Decisions
- Exit 7 stays told. Rejected: retrying 7 (it would paste the alarm into the composer twice).
- Weakest premise: a pane that answers 8 every time is messaged every 3 hours instead of every 6.

## Validation
node --test tools.gap-alarm.test.js, plus fixture-discipline, cli.sandbox-data-4796, no-brand-refs-1881,
no-name-refs-3071. Mutant: putting 8 back in the told branch fails the new test.
