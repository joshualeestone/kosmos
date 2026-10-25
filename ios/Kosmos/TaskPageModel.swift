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
    private let sleep: (TimeInterval) async -> Void
    private let epoch: () -> Int
    // The chats' forgetting count this page was opened under: another account or Mac makes it a page about nothing.
    private let openedIn: Int
    // Reads are numbered, so a slow earlier one never undoes a newer one.
    private var pageReads = 0
    private var pageShown = 0
    private var activityReads = 0
    private var activityShown = 0
    // The activity's state the person has been shown seen for (the board's tkMarkSeen, once per state drawn).
    private var seenKey: String?
    private var rawEvents: [[String: Any]] = []

    init(project: String, number: Int, send: @escaping Send, sleep: @escaping (TimeInterval) async -> Void, epoch: @escaping () -> Int) {
        self.project = project
        self.number = number
        self.send = send
        self.sleep = sleep
        self.epoch = epoch
        self.openedIn = epoch()
    }

    private var current: Bool { epoch() == openedIn }

    // GET /api/projects, then the task by its number.
    func read() async {
        pageReads += 1
        let mine = pageReads
        let answer = await send { Board.projectsRequest(mac: $0) }
        guard current, mine > pageShown else { return }
        pageShown = mine
        guard let (data, response) = answer, (200...299).contains(response.statusCode) else { readFailed = true; return }
        switch Board.parseTaskPage(data, project: project, number: number) {
        case .page(let p):
            if p != page { page = p }
            gone = false
            readFailed = false
        case .gone:
            gone = true
            readFailed = false
        case .unreadable:
            readFailed = true
        }
    }

    // GET .../activity. A failed read keeps the rows already shown (the board's: it says so only when it has none).
    func readActivity(names: @escaping (String) -> String) async {
        activityReads += 1
        let mine = activityReads
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskActivityRequest(mac: $0, project: project, number: number) }
        guard current, mine > activityShown else { return }
        activityShown = mine
        guard let (data, response) = answer, (200...299).contains(response.statusCode), let events = Board.parseActivity(data) else {
            activityFailed = true
            return
        }
        activityFailed = false
        rawEvents = events
        let rows = Board.activityRows(events, name: names)
        if rows != activity { activity = rows }
    }

    // The board's key for "this state of the conversation": its count and its last event.
    var activityKey: String? {
        guard activity != nil else { return nil }
        let last = rawEvents.last
        return "\(project)#\(number)#\(rawEvents.count)#" + (last?["at"] as? String ?? "") + "#" + (last?["kind"] as? String ?? "")
    }

    // Mark as done or Reopen, as the button showed it. A press whose button no longer matches the task (another
    // device closed it meanwhile) sends nothing: the page already shows the new state. Then both are read again.
    func press(_ shown: Board.TaskAct, names: @escaping (String) -> String) async {
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

    // POST .../seen for the activity state on screen, once per state; a 5xx or no answer is tried once more 3 s later,
    // only if that state is still the one shown (the board's tkMarkSeen). `onScreen` says the page is still in front of
    // the person when the retry comes.
    func markSeen(onScreen: @escaping () -> Bool) async {
        guard current, let key = activityKey, key != seenKey, onScreen() else { return }
        seenKey = key
        let (project, number) = (self.project, self.number)
        let first = await send { Board.taskSeenRequest(mac: $0, project: project, number: number) }
        guard Board.seenRetries(status: first?.1.statusCode ?? 0) else { return }
        await sleep(3)
        guard current, activityKey == key, onScreen() else { return }
        _ = await send { Board.taskSeenRequest(mac: $0, project: project, number: number) }
    }
}
