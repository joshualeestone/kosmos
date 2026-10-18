# roomtapdoc-6487 (kosmos#6487 follow-up)

docs/phone-notifications.md (merged in #6504) says a tap opens the agent's page "even for a project post". kosmos-relay
main now carries kosmos#6254 (roomtap): on Android and in the browser, a `posted` notification's tap opens the project's
room (coordinator sw.js tapUrlForRoom; "Only the posted kind reads it"). The iPhone payload (apns.rs payload) carries no
project id and ios/Kosmos/PushBridgeLogic.swift has no project handling, so an iPhone tap still opens the agent.

## Change
The tap paragraph: a project post's tap opens the room on Android and the browser once a coordinator with that code is
deployed; on iPhone it still opens the agent. The Android sign-in hop now says it opens "the page" (agent or room).

## Decided
State the deploy condition rather than claim the deploy state, which was not measured.

## Weakest premise
That no iOS change for room taps is in flight on another branch; if one lands, the iPhone sentence goes.
