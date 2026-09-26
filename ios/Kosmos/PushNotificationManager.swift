import UIKit
import UserNotifications

// Encapsulates the notification surface: authorization, APNs registration,
// notification categories/actions, and foreground/response handling. Kept
// separate from AppDelegate so the behavior is testable and the delegate stays a
// thin forwarder.
final class PushNotificationManager: NSObject, ObservableObject {

    // One tap's request to open a board. Each tap gets its own id, so a second tap
    // on the same Mac is a new request rather than an unchanged value.
    struct BoardRequest: Equatable {
        let id = UUID()
        let url: URL
    }

    // A board a tapped notification asked to open, waiting for the WebView to load
    // it. Held here rather than loaded directly because a tap can arrive before
    // the WebView exists (a cold launch from the notification, or the biometric
    // lock still showing); the WebView loads it and clears it when it can.
    @Published var boardToOpen: BoardRequest?

    // MARK: - Configuration

    // Register the notification-center delegate and the categories
    // (NotificationCategories: no action buttons, #3870). Called once at launch,
    // before requesting authorization.
    func configure() {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().setNotificationCategories(NotificationCategories.all())
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
                // No APNs token is requested, so this device is never registered
                // with the coordinator and receives no pushes.
                NSLog("[Push] notification authorization denied by user; this device will not be registered for pushes")
                return
            }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    // MARK: - Registration with the coordinator

    // Registers and unregisters this device's APNs token with the coordinator
    // (kosmos-relay POST /v1/push/apns/register and /unregister, #718). Built
    // lazily so the Keychain is first read after launch, not at class init.
    private lazy var registrar = PushRegistrar(
        coordinator: KosmosConfig.coordinatorOrigin,
        bundleID: Bundle.main.bundleIdentifier ?? "io.kosmos.app",
        environment: PushNotificationManager.apsEnvironment(),
        store: SessionKeychain.live,
        pendingStore: SessionKeychain.pendingUnregister,
        transport: PushRegistrar.urlSessionTransport()
    )

    // Which APNs environment issued this build's device tokens (see
    // PushBridge.environment for why this is read from the profile, not #if DEBUG).
    private static func apsEnvironment() -> PushBridge.Environment {
        #if targetEnvironment(simulator)
        let isSimulator = true
        #else
        let isSimulator = false
        #endif
        let profile = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
            .flatMap { try? Data(contentsOf: $0) }
        return PushBridge.environment(isSimulator: isSimulator, provisioningProfile: profile)
    }

    // MARK: - Registration results

    func handleRegistration(deviceToken: Data) {
        let token = PushBridge.hexToken(deviceToken)
        // Log only the byte count, never token material.
        NSLog("[Push] APNs device token received (\(deviceToken.count) bytes)")
        registrar.didReceiveDeviceToken(token)
    }

    func handleRegistrationFailure(_ error: Error) {
        // Expected until the app is provisioned with the aps-environment
        // entitlement under a real signing identity (#718). Logged, not fatal:
        // the board still renders.
        NSLog("[Push] APNs registration failed: \(error.localizedDescription)")
    }

    func handleRemoteNotification(
        userInfo: [AnyHashable: Any],
        completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // Log presence only, never the raw payload. TODO(#718): badge sync / board
        // refresh when the board wants it.
        NSLog("[Push] remote notification received (\(userInfo.count) key(s))")
        completionHandler(.noData)
    }

    // MARK: - The kosmosSession bridge

    // The name the coordinator sign-in page posts to
    // (window.webkit.messageHandlers.kosmosSession, kosmos-relay d3c411e).
    // ⚠️ The sign-in page ALSO reads this handler's presence as "inside the iOS app"
    // and then hides every purchase screen (kosmos-relay ios-no-purchase-718, App
    // Review). Renaming or dropping it brings Stripe checkout back into the app.
    static let sessionHandlerName = "kosmosSession"

    // Called by the WebView bridge on the main thread with what WebKit knows about
    // the sender. The origin gate runs here, before the body is even parsed, so a
    // post from anywhere but the coordinator's main frame is dropped unread.
    func handleSessionMessage(body: Any, isMainFrame: Bool, scheme: String, host: String, port: Int) {
        guard PushBridge.isTrustedSender(
            isMainFrame: isMainFrame,
            scheme: scheme,
            host: host,
            port: port,
            coordinator: KosmosConfig.coordinatorOrigin
        ) else {
            NSLog("[Push] ignored a kosmosSession post from an untrusted frame")
            return
        }
        guard let message = PushBridge.parseSessionMessage(body) else {
            NSLog("[Push] ignored a malformed kosmosSession post")
            return
        }
        registrar.didReceive(message)
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

    // Handle a tap on the notification. It has no action buttons (#3870), so a
    // tap opens the agent and anything else (a dismiss) does nothing.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        switch response.actionIdentifier {
        case UNNotificationDefaultActionIdentifier:
            // Only the coordinator's `address` field decides where a tap goes, and
            // only when it is a plain host under the relay domain (PushBridge.boardURL).
            let target = PushBridge.boardURL(
                fromNotification: response.notification.request.content.userInfo,
                coordinator: KosmosConfig.coordinatorOrigin
            )
            if let target = target {
                NSLog("[Push] tapped notification opens \(target.host ?? "?")")
                DispatchQueue.main.async { self.boardToOpen = BoardRequest(url: target) }
            } else {
                NSLog("[Push] tapped notification had no usable address; staying put")
            }
        default:
            break
        }
        completionHandler()
    }
}
