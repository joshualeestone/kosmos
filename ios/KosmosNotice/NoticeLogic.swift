import Foundation
import ImageIO
import UniformTypeIdentifiers

// kosmos#6487 (Josh, 2026-10-22 13:28: "use the agent avatar and put the actual text, like discord does"): what the
// Notification Service Extension asks the person's own computer when a notification arrives, and what it reads back.
// UIKit-free, so ios/LogicTests runs it on a Mac.
//
// A push carries who and what happened, never what was said (kosmos-relay coordinator/src/apns.rs `payload`: `kind`,
// `id`, `address`, `session`). The words stay on the computer: the extension asks it, at the address the push names,
// with the session the app already keeps for that computer (Board.SavedMacSession, the gate's cookie), for
// GET /api/phone/notice?id=<the push's id> (engine/phonenotice.js). No answer in time, and the notice shows as it came.
enum PhoneNotice {
    // The gate's session cookie (kosmos-relay crates/tunnel/src/gate.rs COOKIE_NAME), as Board.macCookieName.
    static let cookieName = "__Host-kosmos_tunnel_session"
    // Where the app keeps that session (SessionKeychain.macSession).
    static let keychainService = "io.kosmos.app.coordinator-session"
    static let keychainAccount = "mac-session"
    // The Info.plist key that names the keychain group the app and the extension share (KosmosNotice-Info.plist).
    static let sharedGroupKey = "KosmosSharedKeychainGroup"
    // A lock screen never needs more; an answer past this is refused rather than read.
    static let maxAnswerBytes = 16 * 1024
    static let maxPictureBytes = 1024 * 1024

    // The fields of Board.SavedMacSession this needs.
    struct Saved: Decodable {
        let address: String
        let cookie: String
    }

    // The words of one notification, as engine/phonenotice.js and server.js answer them.
    struct Words: Decodable, Equatable {
        let kind: String
        let session: String
        let agent: String
        let text: String
        let picture: String?
    }

    // A keychain group this build can hold: "<10-character team id>.<rest>". An unsigned build has no team, so its
    // group reads "io.kosmos.app.shared" and is not one.
    static func hasTeamPrefix(_ group: String) -> Bool {
        let parts = group.split(separator: ".", maxSplits: 1)
        guard parts.count == 2, parts[0].count == 10, !parts[1].isEmpty else { return false }
        return parts[0].unicodeScalars.allSatisfy { ("A"..."Z").contains($0) || ("0"..."9").contains($0) }
    }

    // Only the push ids the computer answers (engine/phonenotice.js parseId); any other notice is left as it came.
    static func isAskable(id: String) -> Bool {
        id.count <= 300 && (id.hasPrefix("report:") || id.hasPrefix("reply:"))
    }

    // A host name and nothing else: the address goes into a URL's host, so no scheme, port, path or user part.
    static func isHostName(_ s: String) -> Bool {
        !s.isEmpty && s.count <= 253 && !s.hasPrefix(".") && !s.hasPrefix("-") && !s.contains("..")
            && s.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "." || $0 == "-" }
    }

    // The kept session, only when it is for the very computer this notice came from.
    static func saved(_ stored: String?, forAddress address: String) -> Saved? {
        guard let stored, let s = try? JSONDecoder().decode(Saved.self, from: Data(stored.utf8)),
              !s.cookie.isEmpty, s.address.lowercased() == address.lowercased(), isHostName(address.lowercased())
        else { return nil }
        return s
    }

    private static func request(host: String, path: String, query: [URLQueryItem]?, cookie: String) -> URLRequest? {
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = host
        parts.path = path
        parts.queryItems = query
        guard let url = parts.url else { return nil }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        // The cookie goes by hand on this one request; the extension keeps no cookie jar of its own.
        r.httpShouldHandleCookies = false
        r.setValue("\(cookieName)=\(cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    // The request for this notification's words, or nil when there is nothing to ask (not one of ours, no kept session
    // for that computer, or a malformed push).
    static func wordsRequest(userInfo: [AnyHashable: Any], stored: String?) -> URLRequest? {
        guard let id = userInfo["id"] as? String, isAskable(id: id),
              let address = userInfo["address"] as? String,
              let s = saved(stored, forAddress: address)
        else { return nil }
        return request(host: address.lowercased(), path: "/api/phone/notice", query: [URLQueryItem(name: "id", value: id)], cookie: s.cookie)
    }

    // The words, from a 200 JSON answer that names the same agent the push did; nil for anything else.
    static func words(status: Int, contentType: String?, data: Data, userInfo: [AnyHashable: Any]) -> Words? {
        guard status == 200, (contentType ?? "").lowercased().hasPrefix("application/json"), data.count <= maxAnswerBytes,
              let w = try? JSONDecoder().decode(Words.self, from: data),
              !w.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !w.agent.isEmpty
        else { return nil }
        if let pushed = userInfo["session"] as? String, !pushed.isEmpty, pushed != w.session { return nil }
        return w
    }

    // The request for the agent's picture: only the board's own avatar route, on the same computer.
    static func pictureRequest(_ w: Words, userInfo: [AnyHashable: Any], stored: String?) -> URLRequest? {
        guard let path = w.picture, path.hasPrefix("/api/agent/"), path.hasSuffix("/avatar"), !path.contains(".."),
              !path.contains("?"), !path.contains("#"),
              let address = userInfo["address"] as? String, let s = saved(stored, forAddress: address),
              var r = request(host: address.lowercased(), path: "/", query: nil, cookie: s.cookie),
              let url = URL(string: path, relativeTo: r.url)?.absoluteURL, url.host == address.lowercased()
        else { return nil }
        r.url = url
        r.setValue("image/*", forHTTPHeaderField: "Accept")
        return r
    }

    // kosmos#7017: the category that offers Reply, set once the words are in. Must match NotificationCategories.replyCategory
    // in the app (a different target); LogicTests checks the two are equal.
    static let replyCategory = "KOSMOS_REPLY"

    // Reply is offered only on an agent's direct reply (the computer's `reply` kind), never on a needs-you `report`.
    static func offersReply(_ w: Words) -> Bool { w.kind == "reply" }

    // kosmos#6487: true needs Kosmos.entitlements to ask for Communication Notifications. False sends the picture as
    // the notice's attachment.
    static let messageStyleKey = "KosmosMessageStyle"

    // The file name ending iOS needs to show a picture as an attachment, from the picture's content type; nil for a
    // kind an attachment cannot show (it would fail the whole attachment).
    static func attachmentExtension(contentType: String?) -> String? {
        let type = (contentType ?? "").lowercased().split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        switch type {
        case "image/png": return "png"
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/gif": return "gif"
        case "image/heic": return "heic"
        default: return nil
        }
    }

    // The largest side a notice's picture is drawn at. A lock screen shows it small, and the extension's memory is
    // small: a little file can still be a huge picture, which a full decode could not hold.
    static let pictureMaxPixels = 300

    // A picture iOS can show in a notice: as it came when it is a type iOS takes and no bigger than needed, otherwise
    // (a WebP picture, which the board accepts, or a large one) redrawn as a small PNG. Nil when it is not a picture.
    static func attachable(_ data: Data, contentType: String?) -> (Data, String)? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let w = props?[kCGImagePropertyPixelWidth] as? Int ?? 0
        let h = props?[kCGImagePropertyPixelHeight] as? Int ?? 0
        if let ext = attachmentExtension(contentType: contentType), w > 0, h > 0, max(w, h) <= pictureMaxPixels {
            return (data, ext)
        }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: pictureMaxPixels,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return (out as Data, "png")
    }

    // A picture answer worth showing: a 200 image, not empty, not huge.
    static func pictureData(status: Int, contentType: String?, data: Data) -> Data? {
        guard status == 200, (contentType ?? "").lowercased().hasPrefix("image/"), !data.isEmpty, data.count <= maxPictureBytes
        else { return nil }
        return data
    }
}
