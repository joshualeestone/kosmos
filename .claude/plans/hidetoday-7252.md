# hidetoday-7252: the iPhone's Today tab is switched off

Card: joshualeestone/kosmos#7252. Josh, 2026-10-26 16:18 CDT: "i think we kill the 'today' tab for now.. it seems to
be overkill and redundant". Routed by Splinter: a switch, not a deletion; open on Agents; repoint Today's routes; stop
Today's poll; check Android.

## Finished looks like
On a fresh install of the next TestFlight build the tab bar has no Today, a signed-in launch opens on Agents, a tapped
notification lands on the right agent (or the board page it names), and no visible text says "Today" (except the chat's
date headings, "Today" / "Yesterday", which are dates).

## Change
- ShellLogic.swift: `AppTabs.todayTab` (false; true only in the KOSMOS_STORE_SHOTS build, which photographs board pages
  under Today). `visible` leaves Today out; `keep` falls back to Agents; `barTab` still names the board page `.today`.
- ContentView.swift: every route that showed a board page under Today goes through `showBoardPage()`. With Today off the
  board page opens OVER the tabs (the same shared web view, drawn only there), with a Close row that returns to the tab
  underneath and ends any section press still waiting (review 1). Modal to VoiceOver. Launch and post-sign-in open on
  Agents. The waiting count's badge moves to Agents.
- SettingsView.swift: the signed-out line no longer says "on the Today tab".
- Today's 1-second poll needs no change: it runs only while TodayView is on screen (BoardClient viewers), and TodayView is
  never built with the tab off.
- Android: nothing to hide. Its board page's tabs are Agents, Projects, Tasks.

## Rejected
- A Today tab that appears only while a board page is open: a bar that changes under the person.
- Deleting #7030's Today: "for now".

## Weakest premise
That the overlay hosting the shared WKWebView behaves as the tab did (one instance, loads and presses as before). Checked by
reading (review 1) and on the simulator by sample launches; a live board and a real notification tap are for the device.

## Checks
- ios/LogicTests run.sh 1279/1279 (7 new); the six other runners; the repo tests that read ios Swift (44/44).
- Simulator build and shots: the bar without Today, Agents with the badge, Settings signed out.
