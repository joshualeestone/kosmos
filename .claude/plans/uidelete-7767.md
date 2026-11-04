# #7767: one flaky UI check on the box test

Addresses #7767 (one of its checks; the card stays open for the rest).

## What finished looks like
testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks no longer fails with "the deletes did not all land" when they did land.

## Measured
CI failures of this assertion read 53 and 30 against the expected 54, both below it. The wait was for exactly 54, so once below it could never end. Every delete had landed.

## Change
Test only. Wait until the count holds still for 1.5 s, up to 10 s, then require at most 108 left. The shrink and gap assertions that follow are what the test is for, and are unchanged.

## Decided
- Rejected raising the 10 s wait: it would fail the same way, later. Rejected typing slower: it hides whatever shortens the count.
- Weakest premise: why the count falls short is not measured. If typing drops characters rather than deletes taking several, the test still measures the same box, so this does not depend on which.
- Not touched: testReadHigherUpStaysWhereItWas moving (all from before #7920 merged) and one "-452 pt" jump in this test on main. If either recurs after today's keyboard fixes it is the product, not the test. The room failure is #7957.

## Tests
6 of 6 passed alone on iOS 26.5. That cannot prove the flake gone, since the old wait passed most runs too; the logged counts are the evidence. A count stuck above 108 still fails.
