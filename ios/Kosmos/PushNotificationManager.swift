import UIKit
import UserNotifications

// Encapsulates the notification surface: authorization, APNs registration,
// registering the categories (NotificationCategories), and foreground/response
// handling. Kept separate from AppDelegate so the behavior is testable and the
// delegate stays a thin forwarder.
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

    // kosmos#7008: bumped by a sign-out or a sign-in as someone else, so the Agents tab drops its chats at once. A
    // Keychain read that briefly finds no session is not one of these and keeps them.
    @Published private(set) var accountChanges = 0
    // kosmos#7042 review round 6: whether the last account change was a sign-out, as the message said (not read back
    // from the keychain, which a failed save leaves empty while the app is signed in for the launch).
    private(set) var lastChangeSignedOut = false

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
        take(message)
    }

    // kosmos#7042: the native sign-in's session, from Kosmos+ itself (SignInClient asked the coordinator directly), so
    // there is no frame to check: it takes the same path as the sign-in page's post.
    func signedInNatively(_ token: String) {
        guard !token.isEmpty else { return }
        take(.signedIn(token))
    }

    // kosmos#7042: the person backed out of a session the native sign-in had issued.
    func signedOutNatively() { take(.signedOut) }

    private func take(_ message: PushBridge.SessionMessage) {
        // kosmos#6838: a sign-out, or a sign-in as someone else, also makes the Agents tab forget its kept Mac session,
        // at once rather than at the next visit. (Forgotten on this iPhone; the Mac ends the session on its own
        // schedule, as for the web view.) Read before the registrar stores the new session.
        let before = SessionKeychain.live.load()
        registrar.didReceive(message)
        var changed = message == .signedOut
        if case .signedIn(let session) = message, session != before { changed = true }
        if changed {
            SessionKeychain.macSession.delete()
            UserDefaults.standard.removeObject(forKey: Board.rememberedMacKey)
            // A sign-out of a session the app held: one that arrives with nothing held (the page clearing a session
            // the app had already dropped) brings nothing back (review round 7).
            lastChangeSignedOut = message == .signedOut && before != nil
            accountChanges += 1
        }
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

    // Handle a response to a notification: the plain tap, Reply, and Allow and Deny (#7017), the only actions any category registers.
    // No .customDismissAction (#3870), so a dismiss never arrives here.
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
        case NotificationAction.replyAction:
            // kosmos#7017: Reply from the notification. iOS gives the app a short while in the background; the
            // completion handler is called only once the send has an answer.
            let content = response.notification.request.content
            let text = (response as? UNTextInputNotificationResponse)?.userText ?? ""
            Task {
                await self.sendReply(text: text, userInfo: content.userInfo, agent: content.title)
                completionHandler()
            }
            return
        case NotificationAction.allowAction, NotificationAction.denyAction:
            // kosmos#7017 part 2: Allow or Deny from the notification (iOS has already asked to unlock the phone).
            let content = response.notification.request.content
            let action = response.actionIdentifier
            Task {
                await self.sendPress(action: action, userInfo: content.userInfo, agent: content.title)
                completionHandler()
            }
            return
        default:
            break
        }
        completionHandler()
    }

    // An Allow or Deny goes only after the chat, read just now, still shows the very request the notice was about (its
    // fingerprint); a minutes-old notice must never answer a different command asking the same question.
    private func sendPress(action: String, userInfo: [AnyHashable: Any], agent: String) async {
        let stored = SessionKeychain.macSession.load(), session = SessionKeychain.live.load()
        guard let press = NotificationAction.permissionPress(userInfo, action: action) else {
            tell(NotificationAction.cannotPress(agent: agent), about: userInfo, kind: "press-")
            return
        }
        guard let request = NotificationAction.pressRequest(
            userInfo: userInfo, press: press, stored: stored, session: session, coordinator: KosmosConfig.coordinatorOrigin
        ), let check = NotificationAction.checkRequest(
            userInfo: userInfo, stored: stored, session: session, coordinator: KosmosConfig.coordinatorOrigin
        ) else {
            tell(NotificationAction.cannotPress(agent: agent), about: userInfo, kind: "press-")
            return
        }
        let read = try? await Self.readHTTP.data(for: check)
        switch NotificationAction.permissionVerdict(status: (read?.1 as? HTTPURLResponse)?.statusCode ?? 0, data: read?.0, press: press, agent: agent) {
        case .changed:
            tell(NotificationAction.changedNotice(agent: agent, allow: press.allow), about: userInfo, kind: "press-")
            return
        case .unreadable(let said):
            tell(said, about: userInfo, kind: "press-")
            return
        case .go:
            break
        }
        let answer = try? await Self.sendHTTP.data(for: request)
        let status = (answer?.1 as? HTTPURLResponse)?.statusCode ?? 0
        let result = Board.pressResult(status: status, body: answer?.0)
        NSLog("[Push] \(press.allow ? "allow" : "deny") from a notification: \(result)")
        tell(NotificationAction.pressNotice(after: result, agent: agent, allow: press.allow), about: userInfo, kind: "press-")
    }

    // Two sessions for replies, refusing redirects as the app's own client does (so the computer's cookie never goes to
    // another host), each with a hard total limit: the read 8 s, the send 14 s. Together they end inside the short
    // time iOS gives a notification action, so the person always hears what happened.
    private static func replySession(total: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForResource = total
        return URLSession(configuration: config, delegate: RefuseReplyRedirects(), delegateQueue: nil)
    }
    private static let readHTTP = replySession(total: 8)
    private static let sendHTTP = replySession(total: 14)

    private func sendReply(text: String, userInfo: [AnyHashable: Any], agent: String) async {
        let stored = SessionKeychain.macSession.load(), session = SessionKeychain.live.load()
        guard let request = NotificationAction.replyRequest(
            userInfo: userInfo, text: text, stored: stored, session: session, coordinator: KosmosConfig.coordinatorOrigin
        ), let check = NotificationAction.checkRequest(
            userInfo: userInfo, stored: stored, session: session, coordinator: KosmosConfig.coordinatorOrigin
        ) else {
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { tell(NotificationAction.cannotSend(agent: agent), about: userInfo) }
            return
        }
        // Read the chat first: while the agent is asking, a reply could answer a menu the person never saw, so it is
        // not sent; nor when the chat cannot be read (NotificationAction.verdict).
        let read = try? await Self.readHTTP.data(for: check)
        switch NotificationAction.verdict(status: (read?.1 as? HTTPURLResponse)?.statusCode ?? 0, data: read?.0, agent: agent) {
        case .asking:
            tell(NotificationAction.askingNotice(agent: agent), about: userInfo)
            return
        case .unreadable(let said):
            tell(said, about: userInfo)
            return
        case .go:
            break
        }
        let answer = try? await Self.sendHTTP.data(for: request)
        let status = (answer?.1 as? HTTPURLResponse)?.statusCode ?? 0
        let result = Board.sendResult(status: status, body: answer?.0)
        NSLog("[Push] reply from a notification: \(result)")
        if let said = NotificationAction.notice(after: result, agent: agent, body: answer?.0) { tell(said, about: userInfo) }
    }

    // A local notification saying what happened to a reply that did not plainly go, or to an Allow or Deny (always). It carries the original notice's
    // address and agent, so a tap opens that chat, as the notice it answers did (PushBridge.boardURL).
    private func tell(_ text: String, about userInfo: [AnyHashable: Any], kind: String = "reply-") {
        let content = UNMutableNotificationContent()
        content.title = "Kosmos"
        content.body = text
        content.userInfo = NotificationAction.followUpInfo(userInfo)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: kind + UUID().uuidString, content: content, trigger: nil))
    }
}

private final class RefuseReplyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
