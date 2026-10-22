import Foundation
import Intents
import Security
import UserNotifications

// kosmos#6487: shows a phone notification as a message from the agent, with its picture and what it actually said,
// the way a chat app does. The words and the picture come from the person's own computer (NoticeLogic.swift), never
// from the push. Anything that does not work out in time leaves the notice exactly as it came.
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?
    private var work: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        handler = contentHandler
        original = request.content
        lock.unlock()
        let info = request.content.userInfo
        let stored = Self.keptMacSession()
        guard let ask = PhoneNotice.wordsRequest(userInfo: info, stored: stored) else {
            finish(request.content)
            return
        }
        work = Task { [weak self] in
            let shown = await Self.messageContent(original: request.content, ask: ask, info: info, stored: stored)
            self?.finish(shown ?? request.content)
        }
    }

    // iOS is about to give up on this extension: show the notice as it came.
    override func serviceExtensionTimeWillExpire() {
        work?.cancel()
        lock.lock()
        let kept = original
        lock.unlock()
        if let kept { finish(kept) }
    }

    // Hands iOS one content, once: whichever of the answer and the time limit comes first.
    private func finish(_ content: UNNotificationContent) {
        lock.lock()
        let h = handler
        handler = nil
        lock.unlock()
        h?(content)
    }

    // The app's kept session for its computer (SessionKeychain.macSession), from the keychain group the two share.
    static func keptMacSession() -> String? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: PhoneNotice.sharedGroupKey) as? String,
              PhoneNotice.hasTeamPrefix(group) else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: PhoneNotice.keychainService,
            kSecAttrAccount as String: PhoneNotice.keychainAccount,
            kSecAttrAccessGroup as String: group,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func fetch(_ r: URLRequest) async -> (Data, HTTPURLResponse)? {
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(for: r), let http = response as? HTTPURLResponse else { return nil }
        return (data, http)
    }

    // The notice as a message from the agent, or nil to show it as it came.
    static func messageContent(original: UNNotificationContent, ask: URLRequest, info: [AnyHashable: Any], stored: String?) async -> UNNotificationContent? {
        guard let (data, http) = await fetch(ask),
              let words = PhoneNotice.words(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), data: data, userInfo: info),
              !Task.isCancelled,
              let content = original.mutableCopy() as? UNMutableNotificationContent
        else { return nil }
        var picture: Data?
        if let r = PhoneNotice.pictureRequest(words, userInfo: info, stored: stored), let (pd, ph) = await fetch(r) {
            picture = PhoneNotice.pictureData(status: ph.statusCode, contentType: ph.value(forHTTPHeaderField: "Content-Type"), data: pd)
        }
        // What the notice already said stays above the words: "Irma needs you" and, when it named one, "in Spring catalogue".
        content.subtitle = original.body.isEmpty ? original.title : "\(original.title), \(original.body)"
        content.title = words.agent
        content.body = words.text

        // A message from a person: iOS then shows the agent's picture and name the way a chat app's notices look.
        let image = picture.map { INImage(imageData: $0) }
        let sender = INPerson(personHandle: INPersonHandle(value: words.session, type: .unknown), nameComponents: nil,
                              displayName: words.agent, image: image, contactIdentifier: nil, customIdentifier: words.session)
        let intent = INSendMessageIntent(recipients: nil, outgoingMessageType: .outgoingMessageText, content: words.text,
                                         speakableGroupName: nil, conversationIdentifier: words.session, serviceName: nil,
                                         sender: sender, attachments: nil)
        if let image { intent.setImage(image, forParameterNamed: \.sender) }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()
        // Without the Communication Notifications capability this throws; the words still show, without the picture.
        return (try? content.updating(from: intent)) ?? content
    }
}
