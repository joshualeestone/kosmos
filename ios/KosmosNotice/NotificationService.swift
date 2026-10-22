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
    // The words, as soon as they are in: what the time limit shows if the picture is still on its way.
    private var wordsOnly: UNNotificationContent?
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
        let task = Task { [weak self] in
            let shown = await Self.messageContent(original: request.content, ask: ask, info: info, stored: stored) { words in
                guard let self else { return }
                self.lock.lock()
                self.wordsOnly = words
                self.lock.unlock()
            }
            self?.finish(shown ?? request.content)
        }
        lock.lock()
        work = task
        lock.unlock()
    }

    // iOS is about to give up on this extension: show the words if they are in, else the notice as it came.
    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let kept = wordsOnly ?? original
        let task = work
        lock.unlock()
        task?.cancel()
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
        // No redirect is followed, as in the app (BoardClient+App.swift NoRedirects): the request carries the computer's
        // session cookie, which must never go to another host. A redirect is then a 3xx, and the notice shows as it came.
        let session = URLSession(configuration: .ephemeral, delegate: NoticeNoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(for: r), let http = response as? HTTPURLResponse else { return nil }
        return (data, http)
    }

    // The notice as a message from the agent, or nil to show it as it came.
    static func messageContent(original: UNNotificationContent, ask: URLRequest, info: [AnyHashable: Any], stored: String?,
                               wordsReady: (UNNotificationContent) -> Void) async -> UNNotificationContent? {
        guard let (data, http) = await fetch(ask),
              let words = PhoneNotice.words(status: http.statusCode, contentType: http.value(forHTTPHeaderField: "Content-Type"), data: data, userInfo: info),
              !Task.isCancelled,
              let content = original.mutableCopy() as? UNMutableNotificationContent
        else { return nil }
        var picture: Data?
        var pictureType: String?
        if let r = PhoneNotice.pictureRequest(words, userInfo: info, stored: stored), let (pd, ph) = await fetch(r) {
            pictureType = ph.value(forHTTPHeaderField: "Content-Type")
            picture = PhoneNotice.pictureData(status: ph.statusCode, contentType: pictureType, data: pd)
        }
        // What the notice already said stays above the words: "Irma needs you" and, when it named one, "in Spring catalogue".
        content.subtitle = original.body.isEmpty ? original.title : "\(original.title), \(original.body)"
        content.title = words.agent
        content.body = words.text
        if let ready = content.copy() as? UNNotificationContent { wordsReady(ready) }

        guard Bundle.main.object(forInfoDictionaryKey: PhoneNotice.messageStyleKey) as? Bool == true else {
            // No Communication Notifications capability yet: the picture rides as the notice's attachment.
            if let picture, let (bytes, ext) = PhoneNotice.attachable(picture, contentType: pictureType) {
                let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                if (try? bytes.write(to: file)) != nil,
                   let attachment = try? UNNotificationAttachment(identifier: "agent", url: file, options: nil) {
                    content.attachments = [attachment]
                }
            }
            return content
        }

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
        // Should the capability be missing after all, this throws; the words still show, without the picture.
        return (try? content.updating(from: intent)) ?? content
    }
}

private final class NoticeNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
