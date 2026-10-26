# macname-7197: the iPhone app names the Mac that is not answering, and one miss is not "not answering"

Card: joshualeestone/kosmos#7197.

## Finished looks like
When a Mac does not answer, the iPhone app's screen names it ("10102026 isn't answering"), on both the native board
screens and the web view's failure page, so a person with two Macs knows which one to wake. A session request that gets
no answer is tried three times (3 s apart) before the app says the Mac is not answering, whether or not the Mac had
already said it was waiting.

## Why
Josh, 10-26 08:29: "Your Mac isn't answering", with two Macs on his account. The relay log (Splinter) shows the
request was placed with 10102026, whose tunnel was up; the app gave up on the first missed session request and the
screen could not say which Mac.

## Design (decided)
- `Shell.macName(fromHost:)`, `Shell.macUnreachableTitle(_:)`, `Shell.macUnreachableMessage(_:)`: the name is the
  Mac's address label; with no name the wording is exactly the old one.
- `LoadFailureView` takes an optional `macName`; the native screens pass the phase's Mac name, the web view passes the
  failing host's label (set only for `.macUnreachable`).
- `BoardClient.openSession`: a no-answer is retried up to three in a row before `.unreachable`, as the waiting path
  already did.

- Review 1: the banner over a list (the common case: a Mac lost mid-session) is named too: AgentsView, TodayView and
  both ChatView lines use `Shell.notUpdatingLine` and `Phase.macName`. A session request waits 8 s (`timeoutInterval`),
  so three tries take about 30 s, not 51 s. A test pins "not answering" after exactly three session requests.
- Not an issue (review 1): the native and web names cannot differ in practice: the coordinator lists a Mac with
  `name` = its address label (`coordinator/src/second.rs` account_macs: `m.name.split('#')`), the same label the web
  path takes from the host. Accepted (review 1): a retry after a lost ANSWER can mint a second Mac session (handoff
  tokens are reusable); bounded by the gate's per-device list, and the waiting path already did it. Noted: VoiceOver
  reads an all-digit name as a number; the failed-send line in BoardClient (`.refused`) is still unnamed.

- Review 2: a chat that stops updating while the board is reconnecting (phase `.starting`) names the Mac whose list is
  shown (`BoardClient.shownMacName`), not "Your Mac". The rest repeated review 1 (names agree in production; the
  failed-send line stays unnamed, the Mac being unknown on that path).
- Review 3: a shown list and the chat opened from it belong to their Mac, so every "not updating" line names the SHOWN
  Mac first (`Board.failingMacName`, `BoardClient.failingMacName`), the phase's only when nothing was shown: after a
  reconnect picked the account's other Mac, A's chat no longer says "B isn't answering". The not-connected press line is
  named too. The two-names finding repeats review 1 (the coordinator's name IS the label; only the test fixture differs).
- Review 4: none new. Decided, both ways argued (reviews 3 and 4): a banner over a shown list names the shown Mac, since
  the list and its chat are that Mac's; naming the Mac the loop moved on to would point the person at a Mac whose
  list they are not looking at. Converged.

## Rejected
- Offering "Choose another computer" from the native screen in this slice: the native client has no way yet to switch
  Macs (it opens the remembered one); a follow-up on the card.
- A longer request timeout instead of retries: a Mac waking needs a second try more than a longer first one.

## Weakest premise
That 08:29 was a transient miss rather than 10102026's board refusing for a reason the app read as no answer. The relay
placed the request; what 10102026 did with it is not in any log we can reach.

## Checks
- ios/LogicTests/run.sh: 1254/1254. Control: the old BoardClient fails exactly the new retry test.
- Node tests that read Swift (42 files): 507 pass, 0 fail.
- Unsigned device build (xcodebuild, iphoneos27.0): BUILD SUCCEEDED.
