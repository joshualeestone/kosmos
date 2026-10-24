# #7017 part 2: Allow and Deny from the iPhone notification

**Done when:** a notification for an agent stopped on Claude Code's permission prompt offers Allow and Deny (both ask
to unlock the phone), a press sends exactly the board's own press for the prompt's plain Yes or No, and it is sent
only while the computer still shows that very request; anything else sends nothing and tells the person why.

## Decisions
- The phone offers Allow and Deny only where the board draws them: the thread route's gate is one function,
  dmPressable, which the notice route asks too. Rejected: a second derivation in the notice route.
- A lock-screen press is checked against a fingerprint of the request (chat.permissionRequestId), read again just
  before it sends. Raised by Angel: every permission prompt asks the same question with the same Yes and No, so the
  Mac's own check (question line and option words) cannot tell two commands apart, and a notice can be minutes old.
  Rejected: waiting for #7020 (the Mac-side check). When #7020 lands, the press should also send the fingerprint.
- Never a lasting choice from a notification. Allow is the prompt's plain "Yes".
- A new category, KOSMOS_PERMISSION, set by the extension only from the computer's answer. The coordinator's
  AGENT_PERMISSION keeps no buttons: it rides pushes the computer was never asked about (#3870).
- Weakest premise: the card reads the same on two reads of the same prompt. A pane redrawn at another width wraps
  differently and reads as another request, which refuses an honest press (the safe direction).

## Steps
1. Server: dmPressable, phonePermissionNow, notice field, permissionRequestId on notice and thread card. DONE.
2. iOS: decode, offeredPermission, category, extension sets it. DONE.
3. iOS: permissionPress, permissionVerdict, pressRequest, pressNotice, the app's handler. DONE.
4. Blind review loop to convergence; full validation; PR; merge; device checks on #6838.
