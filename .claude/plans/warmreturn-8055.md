# #8055: coming back to the app closes the open chat (the warm-return case)

Card: joshualeestone/kosmos#8055. The cold start (iOS ends the app while away) was fixed by #8222. This is the other
case: Josh's iPhone, 11-17 12:52, the app's own line said the screen closed the chat 2 s after the app came back to the
front, not a press on Back.

## What finished looks like

On a real iPhone, with a chat open, switching to another app and coming back (short and long) still shows that chat,
with no flash of the agents list. A brief connection wait on the way back no longer closes it. Not done at merged: done
when Josh's iPhone keeps the chat on returns.

## Found

- The agents page draws its list, or the connection screen (BoardStates) whenever the phase does not keep the list
  (waiting for Allow, Kosmos+ not answering, the computer refusing, and so on). The open chat is a NavigationLink on
  that page. Swapping the page's content for the connection screen closes the chat (measured on Agents; the exact
  SwiftUI mechanism is not established, and Today and Tasks are fixed by analogy).
- Reproduced: WarmReturnChatUITests, on the sample board with KOSMOS_SAMPLE_RETURN_FLIP=1 (Debug only: the first
  start after a return is a reconnect with no agents for one second). Before the fix the chat closes on that return; a plain return keeps
  it. After the fix both keep it.

## Decided

- **While a chat is open, the page under it is kept through the states the client leaves by itself** (Phase.passing:
  starting, connecting, the computer not answering, live), even with no agents yet: a reconnect empties the list and
  used to swap the page to the first-connect wait, which closed the chat. Every phase that needs the person (Kosmos+ not
  answering and its Try again, a wait for Allow and its code, a refusal, sign-in, no computer) still closes the chat, as
  before (reviews 4, 5, 7: an earlier version kept the chat through Kosmos+ not answering and through a wait for Allow,
  which trapped the person in a chat that could not work). One rule, Board.keepsPageUnderOpen, for Agents, Today and
  Tasks, with logic tests. Rejected for now: NavigationStack(path:).
- **Every swap between the Agents list and the connection screen is in the device log** (the phase in words and the
  agent count, and whether a chat is open; no computer's name). Today and Tasks do not log theirs. Not on the
  chat-closed line: with a chat open through a brief state the swap no longer happens, so naming it there could only
  mislead (review 1).

## Weakest premise

That the flip on Josh's phone was a phase that does not keep the list. The reproduction proves the mechanism, not that
his return took this path; another redraw of the page could close the chat the same way. If a chat closes again, the
chat-closed line still names the last tab change, and the device log has the list swaps beside it.

## Not covered (review 2, 4, 5, 6)

Tasks with a chat or task open through a brief state and no task list read yet draws "Reading your tasks" (or could not
read) under the open page, with no not-updating line; harmless, since what is open stays, and not tested. Today and
Tasks have no UI test; their rule is Board.keepsPageUnderOpen, which the logic test pins with Agents'.

Honest scope (reviews 7 and 8): the sample flip is synthetic. A real warm return keeps the agents and the phase; the
list is emptied only on a missing session (read as signed out, which closes the chat), an account change (closes it on
purpose) or a cold start (no chat open). So this branch proves the mechanism and guards it, but is not known to fix
any real path, and Josh's close is NOT fixed by it. Its practical value is the device log, which will name the phase,
agent count and whether a chat was open the next time a chat closes. The PR says Addresses, never Fixes.

Also: on main a list on screen already stayed through connecting and the computer not answering, so a
plain network blip on a return never closed the chat. What this change adds is the reconnect with no agents yet. Josh's
12:52 close may instead have been a wait for Allow after his session ended, or the Keychain miss below; both still close
the chat by design, and the device log now names which.

A Keychain read that misses on a return reads as signed out (run() reads it again), which is not brief, so that still
closes an open chat. Telling it from a real sign-out was judged too risky for this change; it fits Josh's 2 s close as
well as the brief outage does, and the device log now names it (signed out, 0 agents, a chat open) if it happens.

Back pressed during a wait swaps the page as the chat slides away (expected, not measured: the chat is closing anyway).

Other things can still close an open chat on a return, and this branch does not touch them: ContentView changing the
tab bar on a return (AppTabs.keep) and swapping whole screens on shell.failure. The [Chat] device log covers both. So
the card stays open after merge until Josh's iPhone keeps the chat on returns.

## Tests

- WarmReturnChatUITests (3), run about 16:50 to 17:05 CST 11-17 on the round-7 code: a plain return keeps the chat; a
  return through a 1 s reconnect with no agents keeps the chat (and asserts the reconnect happened); a chat opened
  during the first connect stays open. CONTROL in the same run with the keep-open line disabled: the reconnect test
  FAILS, the other two pass. (Earlier controls, 14:18 to 16:11, were on older rules and other flips.) Run by CI in ios/tools/ui-sample.sh
  (WarmReturnChatUITests:3).
- LogicTests main suite PASS 2139/2139 (6 new #8055 checks: Phase.passing, Board.keepsPageUnderOpen, Phase.word); every other iOS logic suite
  passes. On the branch's base, which is behind main: rerun after the rebase.
