# notifactions-7017: Reply from the notification (kosmos#7017 part 1, slice 8 of #6838)

## Finished means
A notification for an agent's own reply to the person offers Reply; the typed text reaches that agent's chat on
the computer the notification came from (Board.sendRequest/sendResult, the kept sign-in by hand, this account
only), never while the board says the agent is asking, and the person is told whenever it did not plainly go.

## The change
- ios/KosmosNotice: PhoneNotice.replyCategory and offersReply (the computer's 'reply' kind only);
  NotificationService sets the category once it has the words.
- ios/Kosmos/NotificationCategories.swift: the KOSMOS_REPLY category with one text-input Reply action.
- ios/Kosmos/NotificationActionLogic.swift: target/check/reply requests, verdict (the thread GET's 'asking',
  fallback the live row), notices for every send result (only placed and held stay quiet).
- ios/Kosmos/PushNotificationManager.swift: the action handler; read then send, hard totals 8 s and 14 s;
  follow-up notices open the chat. accountChanges kept.
- Tests: ios/LogicTests/run-actions.sh + actions/main.swift (own suite, in iOS CI); main.swift's #3870 guard
  narrowed to its intent (agreed with Angel).

## Decided, and why
- Reply only on an agent's reply, never a needs-you: typed words could answer a menu the person cannot see.
- Not sent while asking (the board's own flag), nor when the chat cannot be read (fail closed).
- Reply does not ask to unlock (as Messages); Allow and Deny (part 2) will.
- Weakest premises: content.updating(from: intent) keeping the category, and a question appearing between the
  read and the send (only a board-side check could close that). Both on #6838's device list / the card.

## Order and rollback
Independent of #7016. Part 2 (Allow and Deny) follows. Rollback: revert.
