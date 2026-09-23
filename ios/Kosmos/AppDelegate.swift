import UIKit

// The app delegate exists to receive the UIKit-level callbacks a pure SwiftUI
// `App` cannot: Apple Push Notification service (APNs) registration results are
// delivered to UIApplicationDelegate, not to SwiftUI. KosmosApp installs this via
// @UIApplicationDelegateAdaptor.
//
// This is part of the native surface App Store Review Guideline 4.2 requires: a
// genuine native client (push registration, notification handling, biometric
// unlock), not a repackaged web page. The pieces here are wired and buildable;
// the parts that need external unblocks are marked and stubbed:
//   - The APNs auth key (.p8) is an external ask, already surfaced to Josh
//     (#718). Until it lands and the app is provisioned with the aps-environment
//     entitlement, registerForRemoteNotifications() calls
//     didFailToRegisterForRemoteNotificationsWithError in development; that is
//     expected, not a bug.
//   - The device-token upload endpoint on the coordinator is not decided yet
//     (the coordinator already carries VAPID/web-push; APNs token registration
//     is the sibling path). PushNotificationManager.registerTokenWithBoard is the
//     single place to wire it.
final class AppDelegate: NSObject, UIApplicationDelegate {

    // Owns notification authorization, categories/actions, and the
    // UNUserNotificationCenter delegate. Retained for the app lifetime.
    let pushManager = PushNotificationManager()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Register notification categories/actions up front so an incoming push
        // can render its action buttons, then ask for authorization and (on
        // grant) register with APNs. Registration is safe to request every
        // launch; iOS returns the current token quickly if already registered.
        pushManager.configure()
        pushManager.requestAuthorizationAndRegister()
        return true
    }

    // MARK: - APNs registration results

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        pushManager.handleRegistration(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        pushManager.handleRegistrationFailure(error)
    }

    // A content/silent push arriving while the app is backgrounded or running.
    // The board is web-rendered, so for now we acknowledge; the real handler
    // (badge sync, board refresh) lands with the token-upload endpoint.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        pushManager.handleRemoteNotification(userInfo: userInfo, completionHandler: completionHandler)
    }
}
