import Foundation

// kosmos#7679 (Josh 10-31: "I feel like we need to add the files to the agents and projects"): an agent's and a project's
// Files on the phone, read from the board's own routes, so the phone and the board list the same files. The words are the
// board's (web/index.html paintAgentFilesAll, pjDocMeta, pjSize, the Documents view), checked by ios/LogicTests/files.
// Opening a file is the chat's: fetched through BoardClient.fetchFile and shown in Quick Look, whose share button is the
// share sheet.
extension Board {
    // Whose Files: an agent's (by session) or a project's (by id).
    enum FilesOwner: Hashable {
        case agent(String)
        case project(String)
    }

    // A file as the route lists it. `name` is its path inside the owner's Files (a subfolder's files carry it), and is
    // what the download route takes back.
    struct ListedFile: Equatable, Identifiable {
        let name: String
        let size: Int?
        let modified: Date?
        let changedBy: String?
        var id: String { name }
        // The last part, for a row inside a folder that the breadcrumbs already name.
        var shownName: String { name.split(separator: "/").last.map(String.init) ?? name }
    }
    struct ListedFolder: Equatable, Identifiable {
        let name: String
        var id: String { name }
        var shownName: String { name.split(separator: "/").last.map(String.init) ?? name }
    }

    // One read of a folder (agent) or of the whole list (project). `missing`: the agent has no Files folder yet, which
    // the board shows as empty, never as a failure. `total` is every file the route counted, past any cap.
    struct FilesPage: Equatable {
        let dir: String
        let dirs: [ListedFolder]
        let files: [ListedFile]
        let missing: Bool
        let truncated: Bool
        let total: Int
    }
    enum FilesRead: Equatable { case page(FilesPage), refused(String), noAnswer }

    // The agent page's section shows the newest few, as the board's agent panel shows AGENT_FILES_SHOWN (10).
    static let filesShown = 10
    // The project list reads up to the route's own bound, as the board's Documents view does (limit=500).
    static let projectFilesCap = 500

    // The board's words (checked against web/index.html), except filesCannotRead (the agent page's own unread line),
    // filesTooBig and filesMore, which the board has no need of.
    static let filesAgentEmpty = "This agent has no files yet."
    static let filesFolderEmpty = "This folder is empty."
    static let filesProjectEmpty = "Nothing here yet. Files you or your agents put in this project\u{2019}s folder show up here."
    static let filesDidNotOpen = "That file did not open."
    static let filesCannotRead = "We cannot read this right now."
    static let filesTitle = "Files"
    static let filesAll = "All files"
    // Review 2: a file is read whole into memory to open it, so one past this is not fetched (a 3 GB recording would get
    // the app killed, or run for minutes over cellular). It stays in Files on the computer.
    static let filesMaxOpenBytes = 100 * 1024 * 1024
    // Review 3: where it is, by owner: an agent's Files folder, or the project's folder.
    static func filesTooBig(_ owner: FilesOwner) -> String { "This file is too big to open on the phone. " + filesStillThere(owner, "It is") }
    static func filesStillThere(_ owner: FilesOwner, _ lead: String) -> String {
        switch owner {
        case .agent: return lead + " in Files on your computer."
        case .project: return lead + " in the project\u{2019}s folder on your computer."
        }
    }
    static func filesTooBigToOpen(_ f: ListedFile) -> Bool { (f.size ?? 0) > filesMaxOpenBytes }

    // Review 1: a list cut short says so (the route stops at 500 project files, or 1000 entries in one agent folder), so
    // a missing file is never read as not there.
    static func filesMore(_ page: FilesPage, owner: FilesOwner) -> String? {
        guard page.truncated || page.total > page.files.count + page.dirs.count else { return nil }
        let shown = page.files.count + page.dirs.count
        return "Showing the first \(shown). " + filesStillThere(owner, "The rest are")
    }

    // The read for a list. Agent: with no `dir`, the newest `limit` (the section); with one ("" is the top), that folder
    // (the browser). Project: its whole list, flat (the route recurses and has no browse); `dir` is not used.
    static func filesRequest(mac: URL, owner: FilesOwner, dir: String? = nil, limit: Int = filesShown) -> URLRequest? {
        let path: String
        var items: [URLQueryItem] = []
        switch owner {
        case .agent(let session):
            guard isAgentSession(session) else { return nil }
            if let dir {
                guard safeRelPath(dir, allowEmpty: true) else { return nil }
                path = "/api/agent/\(session)/files/browse"
                items = [URLQueryItem(name: "dir", value: dir)]
            } else {
                guard (1...500).contains(limit) else { return nil }
                path = "/api/agent/\(session)/files"
                items = [URLQueryItem(name: "limit", value: String(limit))]
            }
        case .project(let id):
            guard isProjectId(id) else { return nil }
            path = "/api/project/\(id)/documents"
            items = [URLQueryItem(name: "limit", value: String(projectFilesCap))]
        }
        var parts = URLComponents(url: URL(string: path, relativeTo: mac)!.absoluteURL, resolvingAgainstBaseURL: true)
        // Review 1: encoded as the download path is, never through queryItems, which leaves a + as it is, and the
        // server's URLSearchParams reads + as a space (a folder "C++ notes" was asked for as "C   notes").
        parts?.percentEncodedQuery = items.compactMap { item -> String? in
            guard let v = item.value?.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) else { return nil }
            return item.name + "=" + v
        }.joined(separator: "&")
        guard let url = parts?.url else { return nil }
        var r = URLRequest(url: url)
        // Without it a signed-out gate answers 200 with its sign-in page (BoardLogic's statusRequest note).
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // A path inside the owner's Files as the routes take it: relative, no empty, dot or dot-dot part, no backslash.
    static func safeRelPath(_ s: String, allowEmpty: Bool = false) -> Bool {
        if s.isEmpty { return allowEmpty }
        guard !s.hasPrefix("/"), !s.contains("\\"), !s.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7F }) else { return false }
        return s.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }

    // The board path a listed file downloads from (the board's kplusDownload), for fetchFile; nil for a name the routes
    // would refuse anyway. The query is percent-encoded, so a name with & or # stays one name.
    static func filesDownloadPath(owner: FilesOwner, name: String) -> String? {
        guard safeRelPath(name) else { return nil }
        let base: String
        switch owner {
        case .agent(let s): guard isAgentSession(s) else { return nil }; base = "/api/agent/\(s)/files/download"
        case .project(let id): guard isProjectId(id) else { return nil }; base = "/api/project/\(id)/file-download"
        }
        // The board's encodeURIComponent, and the dot too: everything but letters, digits and -_!~*'() is encoded, so
        // & = + # ? and a slash inside a name all reach the route as part of the one name (URLComponents would leave
        // & = + alone), and a name like "notes..txt" is not refused by isBoardPath's ".." rule (the route decodes %2E).
        guard let value = name.addingPercentEncoding(withAllowedCharacters: queryValueAllowed) else { return nil }
        return base + "?name=" + value
    }
    private static let queryValueAllowed = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!~*'()")

    // A listed file as the chat's attachment, so it opens through fetchFile and Quick Look exactly as a chat file does.
    // `id` names the folder it is saved in for Quick Look, so it is fresh per open (closed() removes that folder).
    static func filesAttachment(owner: FilesOwner, file: ListedFile, id: String) -> Attachment? {
        guard let url = filesDownloadPath(owner: owner, name: file.name), isBoardPath(url) else { return nil }
        return Attachment(id: id, name: file.shownName, type: "", size: file.size, kind: "file", url: url, preview: nil)
    }

    // The answer, read. A 200 that is not a list this build can read is "cannot read", never an empty folder.
    static func filesResult(status: Int, body: Data?) -> FilesRead {
        if status == 0 { return .noAnswer }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if status == 200, let obj, obj["ok"] as? Bool == true {
            let missing = obj["missing"] as? Bool == true
            guard let rawFiles = obj["files"] as? [Any] else { return .refused(filesCannotRead) }
            let files = rawFiles.compactMap { ($0 as? [String: Any]).flatMap(listedFile) }
            let dirs = (obj["dirs"] as? [Any] ?? []).compactMap { d -> ListedFolder? in
                guard let n = (d as? [String: Any])?["name"] as? String, safeRelPath(n) else { return nil }
                return ListedFolder(name: n)
            }
            let total = (obj["total"] as? Int) ?? files.count
            return .page(FilesPage(dir: obj["dir"] as? String ?? "", dirs: dirs, files: files, missing: missing,
                                   truncated: obj["truncated"] as? Bool == true, total: total))
        }
        // The agent routes say `because`; the project routes say `error`.
        if let why = (obj?["because"] as? String) ?? (obj?["error"] as? String), !why.isEmpty { return .refused(sentence(why)) }
        return .refused(filesCannotRead)
    }

    private static let isoWithMs: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static func listedFile(_ o: [String: Any]) -> ListedFile? {
        guard let name = o["name"] as? String, safeRelPath(name) else { return nil }
        let size = (o["size"] as? NSNumber).flatMap { n -> Int? in n.doubleValue >= 0 ? n.intValue : nil }
        // The board sends toISOString() (milliseconds); a plain ISO time or epoch milliseconds are read too.
        var when: Date?
        if let s = o["modified"] as? String { when = isoWithMs.date(from: s) ?? isoPlain.date(from: s) }
        else if let n = o["modified"] as? NSNumber { when = Date(timeIntervalSince1970: n.doubleValue / 1000) }
        let by = (o["changedBy"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return ListedFile(name: name, size: size, modified: when, changedBy: by)
    }

    // A row's small line, as the board's pjDocMeta: size, date, and the agent that changed it last when recorded. (The
    // board's fingerprint is left off: twelve hex characters mean nothing on a phone's row.)
    static func filesMeta(_ f: ListedFile, date: (Date) -> String) -> String {
        var parts: [String] = []
        let size = sizeText(f.size)   // review 2: the one pjSize the app already has
        if !size.isEmpty { parts.append(size) }
        if let m = f.modified { parts.append(date(m)) }
        var line = parts.joined(separator: " \u{00B7} ")
        if let by = f.changedBy { line += (line.isEmpty ? "" : " \u{00B7} ") + "changed by " + by }
        return line
    }

    // The empty line, as the board's: a folder inside, the agent's top, or the project's list.
    static func filesEmpty(owner: FilesOwner, dir: String) -> String {
        switch owner {
        case .project: return filesProjectEmpty
        case .agent: return dir.isEmpty ? filesAgentEmpty : filesFolderEmpty
        }
    }

    // Breadcrumbs for a folder: Files first, then each folder down to this one, each with the path it opens.
    static func filesCrumbs(_ dir: String) -> [(name: String, path: String)] {
        var out: [(name: String, path: String)] = [(filesTitle, "")]
        var at = ""
        for part in dir.split(separator: "/") {
            at = at.isEmpty ? String(part) : at + "/" + part
            out.append((String(part), at))
        }
        return out
    }
}
