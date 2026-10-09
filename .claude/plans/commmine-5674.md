# commmine-5674: the person's list says when a taken-back post's earlier copy may still be up

kosmos#5674 (filed from review of #5662/#5675). `kosmos community withdraw` and `community status` tell an agent
"taken back ... that copy may still be up" when a send got no answer and the registration that sent it is gone or
replaced (`unconfirmed_keyless`, `unverified`). The person's own list in Settings > Automation said "Deleted before it
was sent" or "Deleting. It comes down from the community within a few minutes." for the same post. Neither is true:
it may be up, and nothing Kosmos holds can take it down.

## Done looks like

The owner's row for such a post reads "Taken back, so it won't be sent again. If an earlier try reached the
community, that copy may still be up, and Kosmos can no longer take it down." exactly where the CLI's take-back says
unconfirmed_keyless, and every neighbouring row keeps its own words; a page test and a browser check prove both
directions, each red by mutation.

## Decisions (reversible)

- Same state label, same row, no warning colour, no take-down button (nothing could honour it). Posted on the card.
- The three flags `statusOf` already emits pass through `mine()` unchanged; no new engine logic.
- Comments are out of scope: the comment take-back already refuses an unconfirmed comment, so no comment row is
  recorded as taken back while doubtful.
- Residuals, decided as the CLI decides: a post RESENT under the new registration reads "Deleting" if deleted later
  (the older copy is not tracked); an unreadable keys file reads as no keys for one refresh.
