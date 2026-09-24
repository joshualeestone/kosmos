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
//   - The APNs auth key (.p8) lives on the coordinator, not in the app (#718).
//     The app needs only the aps-environment entitlement (ios/Kosmos.entitlements)
//     and a signing identity with push enabled. Without that identity (an
//     unsigned build, or no provisioning yet) registerForRemoteNotifications()
//     ends in didFailToRegisterForRemoteNotificationsWithError; expected.
//   - The device token goes to the coordinator's POST /v1/push/apns/register
//     through PushRegistrar, once the sign-in page has handed the app a session
//     over the kosmosSession bridge (see PushNotificationManager).
final class AppDelegate: NSObject, UIApplicationDelegate {

    // Owns notification authorization, categories/actions, and the
    // UNUserNotificationCenter delegate. Retained for the app lifetime.
    let pushManager = PushNotificationManager()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
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
    // The board is web-rendered, so for now we acknowledge; a real handler
    // (badge sync, board refresh) is future work.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        pushManager.handleRemoteNotification(userInfo: userInfo, completionHandler: completionHandler)
    }
}
