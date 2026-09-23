import UIKit
import UserNotifications

// Encapsulates the notification surface: authorization, APNs registration,
// notification categories/actions, and foreground/response handling. Kept
// separate from AppDelegate so the behavior is testable and the delegate stays a
// thin forwarder.
final class PushNotificationManager: NSObject {

    // The one notification category the board uses today: an agent asking the
    // user to approve or deny a permission prompt. Additional categories (e.g.
    // "task finished -> view") are added here as the board grows; the strings
    // must match the "category" the coordinator sets on the push payload.
    enum Category {
        static let agentPermission = "AGENT_PERMISSION"
    }

    enum Action {
        static let approve = "APPROVE_ACTION"
        static let deny = "DENY_ACTION"
    }

    // MARK: - Configuration

    // Register the notification-center delegate and the action categories. Called
    // once at launch, before requesting authorization.
    func configure() {
        UNUserNotificationCenter.current().delegate = self

        // Both actions require device authentication before firing: approving or
        // denying an agent permission prompt from the lock screen is sensitive.
        let approve = UNNotificationAction(
            identifier: Action.approve,
            title: "Approve",
            options: [.authenticationRequired]
        )
        let deny = UNNotificationAction(
            identifier: Action.deny,
            title: "Deny",
            options: [.destructive, .authenticationRequired]
        )
        let agentPermission = UNNotificationCategory(
            identifier: Category.agentPermission,
            actions: [approve, deny],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        UNUserNotificationCenter.current().setNotificationCategories([agentPermission])
    }

    // MARK: - Authorization + APNs registration

    // Ask for alert/sound/badge permission; on grant, register with APNs on the
    // main thread (UIApplication APIs are main-thread only). A denial is not an
    // error - the user can enable notifications later in Settings.
    func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { granted, error in
            if let error = error {
                NSLog("[Push] authorization error: \(error.localizedDescription)")
                return
            }
            guard granted else {
                NSLog("[Push] notification authorization denied by user")
                return
            }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    // MARK: - Registration results

    func handleRegistration(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NSLog("[Push] APNs device token received (\(token.count / 2) bytes)")
        registerTokenWithBoard(token: token)
    }

    func handleRegistrationFailure(_ error: Error) {
        // Expected until the APNs auth key (.p8) lands and the app is provisioned
        // with the aps-environment entitlement (#718 external ask). Logged, not
        // fatal - the board still renders.
        NSLog("[Push] APNs registration failed (expected until the APNs key + provisioning land): \(error.localizedDescription)")
    }

    func handleRemoteNotification(
        userInfo: [AnyHashable: Any],
        completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // Log presence only, never the raw payload (it may carry tokens/PII once
        // the coordinator's push-send path is wired). TODO(#718): handle the
        // payload (badge sync, board refresh) when that path lands.
        NSLog("[Push] remote notification received (\(userInfo.count) key(s))")
        completionHandler(.noData)
    }

    // MARK: - Token upload (stub, one place to wire)

    // Upload the APNs device token to the coordinator so it can target this
    // device. STUB: the coordinator endpoint is not decided yet (it already
    // carries VAPID/web-push; APNs token registration is the sibling path, #718).
    // When the endpoint lands, POST { token, platform: "ios", bundle_id } here,
    // authenticated with the user's session. Left as a log so the token path is
    // exercised end-to-end without a live endpoint.
    private func registerTokenWithBoard(token: String) {
        // Log only the byte count, never token material (see handleRegistration).
        NSLog("[Push] TODO(#718): upload APNs token (\(token.count / 2) bytes) to the coordinator once the registration endpoint + APNs key land.")
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension PushNotificationManager: UNUserNotificationCenterDelegate {

    // Present notifications while the app is in the foreground (banner + sound).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    // Handle a tap on the notification or one of its action buttons.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        switch response.actionIdentifier {
        case Action.approve:
            NSLog("[Push] user APPROVED an agent permission prompt")
        case Action.deny:
            NSLog("[Push] user DENIED an agent permission prompt")
        case UNNotificationDefaultActionIdentifier:
            NSLog("[Push] user opened the notification -> route to the board")
        default:
            break
        }
        // TODO(#718): forward the user's choice to the board/coordinator once the
        // action endpoint lands, so an "approve" from the lock screen actually
        // releases the waiting agent.
        completionHandler()
    }
}
