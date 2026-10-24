import UserNotifications

// The notification categories the app registers. Kept apart from
// PushNotificationManager (which needs UIKit) so ios/LogicTests can compile it
// for macOS and prove what a notification offers.
enum NotificationCategories {

    // The one category the board uses today: an agent asking the person to
    // approve or deny a permission prompt. The string must match the
    // "category" the coordinator sets on the push payload.
    static let agentPermission = "AGENT_PERMISSION"

    // No Approve or Deny buttons, on purpose (#3870): they were registered here but nothing carried the choice to the
    // board, so a tap on the lock screen looked like a decision and did nothing. They come back with #7017 part 2.
    // kosmos#7017: Reply, only on an agent's own reply to the person whose words the phone fetched from the computer
    // (PhoneNotice.offersReply; the notification extension sets this category only then), never on a needs-you. Reply does not ask to unlock the phone, as Messages does not: it only adds words to
    // a chat the person already has.
    // Must match PhoneNotice.replyCategory (the notification extension sets it once it has the words; a different
    // target, so LogicTests checks the two are equal).
    static let replyCategory = "KOSMOS_REPLY"
    static let replyAction = "KOSMOS_REPLY_ACTION"

    static let reply = UNTextInputNotificationAction(
        identifier: replyAction,
        title: "Reply",
        options: [],
        textInputButtonTitle: "Send",
        textInputPlaceholder: "Reply"
    )

    static func all() -> Set<UNNotificationCategory> {
        [
            UNNotificationCategory(
                identifier: agentPermission,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: replyCategory,
                actions: [reply],
                intentIdentifiers: [],
                options: []
            ),
        ]
    }
}
