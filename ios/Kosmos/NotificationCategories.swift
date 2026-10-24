import UserNotifications

// The notification categories the app registers. Kept apart from
// PushNotificationManager (which needs UIKit) so ios/LogicTests can compile it
// for macOS and prove what a notification offers.
enum NotificationCategories {

    // The one category the board uses today: an agent asking the person to
    // approve or deny a permission prompt. The string must match the
    // "category" the coordinator sets on the push payload.
    static let agentPermission = "AGENT_PERMISSION"

    // No buttons on the coordinator's own category, on purpose (#3870): every permission push carries it, including one
    // whose computer could not be asked, and a button there would carry nothing. Allow and Deny are permissionCategory's
    // below, which the notification extension sets only when the computer sent them (#7017 part 2).
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

    // kosmos#7017 part 2: Allow and Deny on a permission prompt, set by the notification extension only when the
    // computer said the prompt is up and the board would draw these two buttons (PhoneNotice.offeredPermission). Equal
    // weight, neither destructive (the choice is the person's, #6727). Both ask to unlock the phone: a locked phone
    // must not let anyone allow a command. Never a lasting choice; those stay in the chat. Must match
    // PhoneNotice.permissionCategory (LogicTests checks the two are equal).
    static let permissionCategory = "KOSMOS_PERMISSION"
    // Where the extension puts Allow and Deny on the notice. Must match PhoneNotice.permissionInfoKey (LogicTests checks).
    static let permissionInfoKey = "kosmosPermission"
    static let allowAction = "KOSMOS_ALLOW"
    static let denyAction = "KOSMOS_DENY"

    static let allow = UNNotificationAction(identifier: allowAction, title: "Allow", options: [.authenticationRequired])
    static let deny = UNNotificationAction(identifier: denyAction, title: "Deny", options: [.authenticationRequired])

    static func all() -> Set<UNNotificationCategory> {
        [
            UNNotificationCategory(
                identifier: agentPermission,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: permissionCategory,
                actions: [allow, deny],
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
