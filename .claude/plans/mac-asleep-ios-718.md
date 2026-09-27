# mac-asleep-ios-718: the iOS app says "Your Mac isn't answering" when it is the Mac (#718 state 2, iOS half)

Card: kosmos #4086 (Liu Kang), state 2 of Kano's list on #718 (issuecomment-5844683600).
State 2 is split in two PRs: this iOS half, and the board half after state 1 (phone-offline-718)
merges, since both edit the board's offline note. Split so the iOS half can merge during the 0.7.01
page-merge hold (Liu Kang m1390: ios/-only PRs are fine).

## What happens today (Kano)
`ShellViews.swift`: any unreachable load reads "Kosmos+ isn't answering", including a timeout or a
failed secure connection to the Mac's own address. That blames Kosmos+ when the Mac is asleep or off.

## Finished looks like
- A load that fails as unreachable (timeout, cannot connect, lost connection, TLS) on a Mac's own
  address (one label under the coordinator's domain, `PushBridge.isMacHost`) shows "Your Mac isn't
  answering" with "It may be asleep or turned off. Wake it, then try again."
- The coordinator's own host, any other host, and no failing address keep "Kosmos+ isn't answering".
- Offline stays offline whatever the address; a cancelled load is still no failure page.
- Logic tests pin each of those and fail on a copy with the Mac rule removed.

## Decisions
- **Decided by the failing address, not a probe.** Rejected: asking the coordinator whether the Mac
  is connected before choosing the words (a second network call from a phone that just failed one,
  and a new relay route). The address already says which end the app was talking to.
- **Wording**: "Your Mac isn't answering" / "It may be asleep or turned off. Wake it, then try
  again." iOS copy keeps the contractions the app already uses. "your Mac", as the Kosmos+ copy
  says. Reversible; Josh or Mona Lisa may prefer other words.
- **Only the no-answer codes name the Mac** (timed out, cannot connect, connection lost, failed
  secure connection). A certificate error or a bad response on a Mac's address means the Mac
  answered (the tunnel ends TLS on the Mac), so "may be asleep" would send someone to wake a Mac
  that is on; a DNS failure is the phone's own lookup. Those keep the Kosmos+ wording (challenge
  loop iteration 1).
- **No auto-retry** for a Mac not answering: only the offline case retries on reconnect, because
  only there does the phone learn something changed.
- Icon `desktopcomputer` for the Mac case, so it does not look like the cloud case.

## Weakest part
A Mac's address can also fail because the relay in front of it is down, which this still calls the
Mac. From the phone the two cannot be told apart without a probe, and a sleeping Mac is by far the
common case (Kano's list).

## What would change my mind
A relay outage showing up often enough that "your Mac" misleads people: then add the probe.
