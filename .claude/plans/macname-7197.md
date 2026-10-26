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
