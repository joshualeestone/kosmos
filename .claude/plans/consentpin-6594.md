# consentpin-6594 (kosmos#6594 follow-up)

## Change
`tools/family-e2e-6239.js` pins the company consent hash its step 9 compares against. Relay #546 split the company readers line that #516 had made 384 characters, because the board cuts
each consent line at 300 and then refused to echo the hash. The company hash moved from 51e783bb... to
34a95f58313ab7cc39946efb67c9e744ae3fa8a85962f70b554a73ff9b88f1ba, which relay pins in coordinator/tests/api.rs. This
moves the e2e pin with it, as the comment above the constant asks.

## Decisions
1. Only the pin and its comment change. The e2e is run by hand against a coordinator build; nothing in CI runs it, so
   no test here can show the old pin was wrong. The check is the cross-reference: the new value is byte-identical to
   relay main's api.rs pin (grep count 1).

## Not measured
The e2e itself was not run (it needs a coordinator and two boards). Production was measured separately by the #6835
join re-run.
