import UserNotifications

// The notification categories the app registers. Kept apart from
// PushNotificationManager (which needs UIKit) so ios/LogicTests can compile it
// for macOS and prove what a notification offers.
enum NotificationCategories {

    // The one category the board uses today: an agent asking the person to
    // approve or deny a permission prompt. The string must match the
    // "category" the coordinator sets on the push payload.
    static let agentPermission = "AGENT_PERMISSION"

    // No action buttons, on purpose (#3870). Approve and Deny were registered
    // here but nothing carried the choice to the board, so a tap on the lock
    // screen looked like a decision and did nothing. Until approving from a
    // notification is built for real (an authenticated call to the board or
    // coordinator, and a ruling on Face ID), a notification offers only the
    // plain tap, which opens the agent that asked.
    static func all() -> Set<UNNotificationCategory> {
        [
            UNNotificationCategory(
                identifier: agentPermission,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ]
    }
}
