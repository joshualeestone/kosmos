import Foundation

// kosmos#7074: what the native task page holds and does: the task as last read, its activity, Mark as done / Reopen, and
// marking it seen. The words are TaskPageLogic.swift's. UIKit-free and driven through `send` (BoardClient.throughMac in
// the app, a fake in ios/LogicTests/run-taskpage.sh), so every path is tested without a Mac.
@MainActor
final class TaskPageModel: ObservableObject {
    typealias Send = (@escaping (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)?

    let project: String
    let number: Int

    // The task as last read; gone when the Mac's list no longer has it; failed when the last read gave no list.
    @Published private(set) var page: Board.TaskPage?
    @Published private(set) var gone = false
    @Published private(set) var readFailed = false
    // The activity as last read (nil until one is), and whether the last read of it failed.
    @Published private(set) var activity: [Board.ActivityRow]?
    @Published private(set) var activityFailed = false
    // A press in the air, and the Mac's sentence for the last one it refused.
    @Published private(set) var pressing = false
    @Published private(set) var refusal: String?

    private let send: Send
    // The project list parsed off the main thread (a large fleet's list every 5 seconds must not stall a scroll); a
    // parameter so a test can hold one parse while a newer read lands.
    typealias Parse = (Data, String, Int) async -> Board.TaskPageRead
    nonisolated static func parseOffMain(_ data: Data, _ project: String, _ number: Int) async -> Board.TaskPageRead {
        await Task.detached { Board.parseTaskPage(data, project: project, number: number) }.value
    }
    private let parse: Parse
    private let buildRows: BuildRows

    // Published only when it changes: a 5-second tick that changes nothing must not redraw the page (and its history).
    private func set(_ key: ReferenceWritableKeyPath<TaskPageModel, Bool>, _ value: Bool) {
        if self[keyPath: key] != value { self[keyPath: key] = value }
    }
    private let sleep: (TimeInterval) async -> Void
    private let epoch: () -> Int
    private let now: () -> Date
    // Whether the person is in front of the page (the board's tkPresent: the page on screen, the app in front, and a
    // touch in the last two minutes). Set by the view as it changes, read live at every mark and retry.
    var onScreen = false
    var appActive = true
    // VoiceOver or Switch Control is running: their reading and double-taps reach no gesture this page can see, so
    // the person is counted as there whenever the page is on screen and the app in front.
    var assistive = false
    private(set) var lastTouch: Date = .distantPast
    static let presentFor: TimeInterval = 120
    func touched() { lastTouch = now() }
    var present: Bool { onScreen && appActive && (assistive || now().timeIntervalSince(lastTouch) < Self.presentFor) }
    // The 5-second tick, as the board's: the task itself is read on every tick while the page is on screen and the app
    // in front (loadProjects repaints an open task page whatever tkPresent says), so its state and button never go
    // stale; its activity, and the seen mark after it, only while the person is there (tkPollIfThere), and always the
    // first time so the page has something to show.
    var shouldReadTask: Bool { onScreen && appActive }
    func shouldReadActivity(first: Bool) -> Bool { first || present }
    // The chats' forgetting count this page was opened under: another account or Mac makes it a page about nothing.
    private let openedIn: Int
    // Reads are numbered, so a slow earlier one never undoes a newer one.
    private var pageReads = 0
    private var pageShown = 0
    private var activityReads = 0
    private var activityShown = 0
    // The activity's state the person has been shown seen for (the board's tkMarkSeen, once per state drawn).
    private var seenKey: String?
    // The state the Mac last recorded as seen (a 2xx): only that one is recorded again on a return, as the board's
    // tkTabReturn re-records only a recorded state.
    private var recordedKey: String?
    // The activity's count and its last event's time and kind, for its key (the rows themselves are built off the main
    // thread and only those come back).
    private var activityShape: (count: Int, lastAt: String, lastKind: String)?

    init(project: String, number: Int, send: @escaping Send, sleep: @escaping (TimeInterval) async -> Void, epoch: @escaping () -> Int,
         now: @escaping () -> Date = Date.init, parse: @escaping Parse = { await TaskPageModel.parseOffMain($0, $1, $2) },
         buildRows: @escaping BuildRows = { await TaskPageModel.buildOffMain($0, $1) }) {
        self.project = project
        self.number = number
        self.send = send
        self.parse = parse
        self.buildRows = buildRows
        self.sleep = sleep
        self.epoch = epoch
        self.now = now
        self.openedIn = epoch()
    }

    private var current: Bool { epoch() == openedIn }

    // GET /api/projects, then the task by its number.
    func read() async {
        // Not for a page opened under another account or Mac: its project id means nothing to the one now.
        guard current else { return }
        pageReads += 1
        let mine = pageReads
        let answer = await send { Board.projectsRequest(mac: $0) }
        // A read cut short (the page left, the loop restarted) says nothing about the Mac: no failure is recorded.
        guard !Task.isCancelled, current, mine > pageShown else { return }
        pageShown = mine
        guard let (data, response) = answer, (200...299).contains(response.statusCode) else { set(\.readFailed, true); return }
        let parsed = await parse(data, project, number)
        // A newer read that landed while this one was parsing stands (its answer or its failure).
        guard !Task.isCancelled, current, mine == pageShown else { return }
        switch parsed {
        case .page(let p):
            // A refusal is about the press it answered: once the task reads otherwise (another device did it), it goes.
            if refusal != nil, let was = page, was.act != p.act { refusal = nil }
            if p != page { page = p }
            set(\.gone, false)
            set(\.readFailed, false)
        case .gone:
            set(\.gone, true)
            set(\.readFailed, false)
        case .unreadable:
            set(\.readFailed, true)
        }
    }

    // GET .../activity. A failed read keeps the rows already shown (the board's: it says so only when it has none).
    // `names` is a snapshot (the project's members over the roster), so the rows can be phrased off the main thread: a
    // repeating task's history can run to thousands of events, read every 5 seconds. True when this read's state is the
    // one now shown (what a seen mark may then record).
    typealias BuildRows = ([String: String], Data) async -> (rows: [Board.ActivityRow], count: Int, lastAt: String, lastKind: String)?
    nonisolated static func buildOffMain(_ names: [String: String], _ data: Data) async -> (rows: [Board.ActivityRow], count: Int, lastAt: String, lastKind: String)? {
        await Task.detached { () -> (rows: [Board.ActivityRow], count: Int, lastAt: String, lastKind: String)? in
            guard let events = Board.parseActivity(data) else { return nil }
            let last = events.last
            return (Board.activityRows(events, name: { names[$0] ?? $0 }), events.count,
                    last?["at"] as? String ?? "", last?["kind"] as? String ?? "")
        }.value
    }
    @discardableResult
    func readActivity(names: [String: String]) async -> Bool {
        guard current else { return false }
        activityReads += 1
        let mine = activityReads
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskActivityRequest(mac: $0, project: project, number: number) }
        guard !Task.isCancelled, current, mine > activityShown else { return false }
        activityShown = mine
        guard let (data, response) = answer, (200...299).contains(response.statusCode) else { set(\.activityFailed, true); return false }
        let built = await buildRows(names, data)
        // A newer read that landed while this one was building stands.
        guard !Task.isCancelled, current, mine == activityShown else { return false }
        guard let built else { set(\.activityFailed, true); return false }
        set(\.activityFailed, false)
        activityShape = (built.count, built.lastAt, built.lastKind)
        if built.rows != activity { activity = built.rows }
        return true
    }

    // The board's key for "this state of the conversation": its count and its last event.
    var activityKey: String? {
        guard activity != nil else { return nil }
        let shape = activityShape ?? (0, "", "")
        return "\(project)#\(number)#\(shape.count)#" + shape.lastAt + "#" + shape.lastKind
    }

    // Mark as done or Reopen, as the button showed it. A press whose button no longer matches the task (another
    // device closed it meanwhile) sends nothing: the page already shows the new state. Then both are read again.
    func press(_ shown: Board.TaskAct, names: [String: String]) async {
        guard !pressing, current, let page, page.act == shown else { return }
        pressing = true
        refusal = nil
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskActRequest(mac: $0, project: project, number: number, act: shown) }
        guard current else { return }
        if case .refused(let why) = Board.taskActResult(status: answer?.1.statusCode ?? 0, body: answer?.0) { refusal = why }
        await read()
        await readActivity(names: names)
        guard current else { return }
        pressing = false
    }

    // POST .../seen for the activity state on screen, once per state, only while the person is there (present); a 5xx
    // or no answer is tried once more 3 s later, only if that state is still the one shown and they are still there
    // (the board's tkMarkSeen). Called after every read and when a new state is drawn, so a state that landed while
    // they were away or idle is marked once they are back. `again` (the page appearing, the app coming back) records
    // the same state once more, as the board's tkTabReturn does, so "seen at" moves to now.
    func markSeen(again: Bool = false) async {
        if again, seenKey != nil, seenKey == recordedKey { seenKey = nil }
        guard current, let key = activityKey, key != seenKey, present else { return }
        seenKey = key
        let (project, number) = (self.project, self.number)
        let first = await send { Board.taskSeenRequest(mac: $0, project: project, number: number) }
        // Only while it is still the state being marked: an older mark answering late never stands for a newer one.
        if let s = first?.1.statusCode, (200...299).contains(s), seenKey == key { recordedKey = key }
        // Cut short (the loop restarted, the page left): not an answer from the Mac, so the state is left unmarked and
        // the next mark sends it.
        if Task.isCancelled && recordedKey != key { if seenKey == key { seenKey = nil }; return }
        guard Board.seenRetries(status: first?.1.statusCode ?? 0) else { return }
        await sleep(3)
        if Task.isCancelled { if seenKey == key { seenKey = nil }; return }
        // Not tried again (the person left, or the state moved on): left unmarked, so the next mark of it is sent, as
        // the board's tkMarkSeen settles it with onDone(false).
        guard current, activityKey == key, present else { if seenKey == key { seenKey = nil }; return }
        let second = await send { Board.taskSeenRequest(mac: $0, project: project, number: number) }
        if let s = second?.1.statusCode, (200...299).contains(s), seenKey == key { recordedKey = key }
        if Task.isCancelled && recordedKey != key { if seenKey == key { seenKey = nil }; return }
    }
}
