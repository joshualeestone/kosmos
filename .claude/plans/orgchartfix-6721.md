# orgchartfix-6721: render-orgchart-phone-718 follows the board's one-missed-poll grace (#6721 follow-up)

## What was wrong
#6745 (#6721) made a board that has loaded keep its view on ONE missed /api/status poll ("Reconnecting...") and
paint the failure only on the SECOND in a row. render-orgchart-phone-718's "[poll failed mid-drag]" arm failed one
poll (6.5 s) and expected the chart cleared, so it went red on main and on other PRs' CI (Pete, 16:31; #6655's CI
failed only this check). My own miss: #6745 updated three offline checks but not this one.

## Call
Wait FOR the cleared chart (waitForFunction, bounded at 16 s, the bound render-phone-offline-718 uses), keeping the
`cleared === 0` assertion, so the arm still proves the drag hold does not outlive the node.

## Tests
render-orgchart-phone-718: ALL PASS (54), the arm: nodes while failing 0, after recovery 5 of 5.
Other checks #6745 could have broken: #6655's CI failed only this one; render-detail-header-1841 and
render-member-ring-3991 pass on main; render-device-signed-out-401-718 needs its harness server and was not run.

## Review round 1 (blind, sonnet)
- [WARNING] a fixed 11.5 s sleep left 1.5 s of slack (two polls land 5 to 10 s after the stub, random phase) -->
  FIXED: waitForFunction for the cleared chart, bounded at 16 s.
- [NIT] the comment overstated the grace (it applies only to a board that has loaded) --> FIXED.
- [NIT] the "failed poll leaves a plain, empty box" arm already loops 12 s for two polls --> not changed (fits).
- Verified: 5 s poll interval, the two-miss grace, the arm still tests the hold, render-phone-offline-718 unaffected.
