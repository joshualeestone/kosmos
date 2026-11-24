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
    // kosmos#8958 slice B6: closing the built subtasks with the task is the press in the air.
    @Published private(set) var closingSubtasks = false
    // The subtasks as they read when a refusal about closing them was said; it goes when they change. When the read after the
    // closes failed, the next read that works says what they were (refusalAwaits): against an older one, the closes themselves
    // would be the change.
    private var refusalSubtasks: [Board.SubtaskRow]?
    private var refusalAwaits = false
    private func clearRefusal() {
        if refusal != nil { refusal = nil }
        refusalSubtasks = nil
        refusalAwaits = false
    }
    // kosmos#8958 slice B7: the part write in the air, and the line under the parts (who was told, or the Mac's refusal).
    @Published private(set) var partWriting: Board.PartWrite?
    @Published private(set) var partSay: String?
    @Published private(set) var partRefused = false
    @Published private(set) var partAtHold = false
    private var partSig: Board.PartSig?
    private var partSigAwaits = false
    private var partWrote: Board.PartWrite?
    private var partUnsureOf: (Board.PartWrite, [Board.TaskPart], (Board.TaskPage, String) -> String)?
    // An Add nobody answered and no read has shown yet; and the words of one a later read did show, for the box to let go of.
    private var addUnsettled: (words: String, before: [Board.TaskPart])?
    @Published private(set) var partAdded: String?
    // kosmos#8958 slice B1: a message on its way, and the line under the box (who it did not reach, or the refusal).
    @Published private(set) var saying = false
    @Published private(set) var sayLine: String?
    @Published private(set) var sayRefused = false
    // The due date being saved, and the Mac's refusal of the last one.
    @Published private(set) var dueSaving = false
    @Published private(set) var dueRefusal: String?
    // kosmos#8958 slice B2: Put on hold / Take off hold in the air, and the line under it (the board's tk-hold-msg).
    @Published private(set) var holding = false
    @Published private(set) var holdSay: String?
    // holdSay is the Mac refusing the press (drawn as Mark as done's refusal is), not a line about the task (review 2).
    @Published private(set) var holdRefused = false
    // kosmos#8958 slice B7: Choose who, under that line.
    @Published private(set) var holdChoose = false
    // What the task read as when holdSay was the unhold's next sentence (Board.holdNextSig): the line goes once the task
    // reads otherwise, as the board's repaint takes it down (review 1).
    private var holdSaySig: String?
    // kosmos#8958 slice B3: the Repeats Save in the air, and the line under it (the board's tk-repeat-msg): "Saved." or
    // the Mac's refusal (repeatRefused). "Saved." goes once the stored rule reads as something else (the board's review
    // 2: a rule changed elsewhere retires it).
    @Published private(set) var repeatSaving = false
    @Published private(set) var repeatSay: String?
    @Published private(set) var repeatRefused = false
    private var repeatSavedAs: Board.RepeatWire?
    // kosmos#8958 slice B3b: "If missed, tell" being saved (the choice sent), and the line under it (tk-review-msg).
    @Published private(set) var reviewerSaving: String?
    @Published private(set) var reviewerSay: String?
    @Published private(set) var reviewerRefused = false
    private var reviewerSavedAs: String?
    // A reviewer the Mac recorded when the read after it failed: shown until a read of the page succeeds, so the choice
    // does not jump back to the old reviewer under "Saved." (as the Repeats controls keep what was saved).
    @Published private(set) var reviewerShown: String?
    // The number of the newest page read that succeeded (reads are numbered by pageReads), so a save can tell whether a
    // read that started after it was recorded has landed: a tick read started before it, landing with the old page, does
    // not count.
    private var pageReadOK = 0
    // kosmos#8958 slice B4: a closed task's receipt as last read; nil while there is none to show.
    @Published private(set) var receipt: Board.Receipt?
    // The closed state (TaskPage.receiptKey) the receipt was asked for, and the last one whose read failed, with when.
    private var receiptAsked: String?
    private var receiptFailed: (key: String, at: Date)?
    private var receiptReads = 0
    // The read in the air, nil when there is none.
    private(set) var receiptReading: Task<Void, Never>?
    static let receiptRetry: TimeInterval = 30
    // kosmos#8958 slice B5: what an undo of this closed task's file changes would do (nil: nothing is offered), one on its
    // way, what the last one did, and the line in the list (a refusal, or that nothing was chosen).
    @Published private(set) var undoPlan: Board.UndoPlan?
    @Published private(set) var undoing = false
    @Published private(set) var undoDone: String?
    @Published private(set) var undoSay: String?
    @Published private(set) var undoRefused = false
    // The closed state the plan was asked for, the last one whose read failed, and reads numbered (a hide counts too, so
    // neither a read nor an undo still out draws after it).
    private var undoAsked: String?
    // The close the plan (or the line about what was done) is for.
    private var undoPlanKey: String?
    private var undoFailedRead: (key: String, at: Date)?
    private var undoReads = 0
    private(set) var undoReading: Task<Void, Never>?
    // The title and detail being saved, and the line for the last save (the board's tk-msg for the form).
    // Like `pressing`, saying, dueSaving and editSaving stay set when the epoch moves mid-request: the page is then about
    // nothing.
    @Published private(set) var editSaving = false
    @Published private(set) var editRefusal: String?

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
    // The last answer and names the rows were built from: the same again (most ticks) is not rebuilt.
    private var builtFrom: (data: Data, names: [String: String])?

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
            pageReadOK = max(pageReadOK, mine)
            // Only when set: assigning a published value redraws the page, and a quiet tick must redraw nothing.
            if reviewerShown != nil { reviewerShown = nil }
            // A refusal is about the press it answered: once the task reads otherwise (another device did it), it goes.
            if refusal != nil, let was = page, was.act != p.act { clearRefusal() }
            if p != page { page = p }
            if refusalAwaits {
                refusalAwaits = false
                refusalSubtasks = p.subtasks
                if refusal == Board.subtasksCloseUnsureUnread { refusal = Board.subtasksCloseUnsure }   // the list is read now
            }
            if let was = refusalSubtasks, was != p.subtasks { clearRefusal() }
            keepPartLine(p)
            if let sig = holdSaySig, Board.holdNextSig(p) != sig { holdSay = nil; holdChoose = false; holdSaySig = nil }
            if let w = repeatSavedAs, p.closed || p.repeatStored.map(Board.repeatWire) != w { repeatSay = nil; repeatSavedAs = nil }
            // Nothing about Repeats outlives the task being finished (the board's tkPaintRepeat, review 2).
            if p.closed && repeatRefused { repeatSay = nil; repeatRefused = false }
            // "Saved." for the reviewer goes once the stored reviewer reads otherwise, the task finishes or stops repeating;
            // a refusal goes with the section (the board's review 7).
            if let w = reviewerSavedAs, p.closed || p.repeatRow == nil || p.repeatReviewer != w { reviewerSay = nil; reviewerSavedAs = nil }
            if reviewerRefused && (p.closed || p.repeatRow == nil) { reviewerSay = nil; reviewerRefused = false }
            set(\.gone, false)
            set(\.readFailed, false)
            syncReceipt()
        case .gone:
            if holdSaySig != nil { holdSay = nil; holdChoose = false; holdSaySig = nil }
            hideUndo()
            set(\.gone, true)
            set(\.readFailed, false)
        case .unreadable:
            set(\.readFailed, true)
        }
    }

    // GET .../activity. A failed read keeps the rows already shown (the board's: it says so only when it has none).
    // `names` is a snapshot of the roster; the project's own member names (tkMemberName's first choice) are laid over it
    // here from the task as last read, so the rows can be phrased off the main thread: a
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
    func readActivity(names roster: [String: String]) async -> Bool {
        guard current else { return false }
        let names = roster.merging(page?.members ?? [:]) { _, member in member }
        activityReads += 1
        let mine = activityReads
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskActivityRequest(mac: $0, project: project, number: number) }
        guard !Task.isCancelled, current, mine > activityShown else { return false }
        activityShown = mine
        guard let (data, response) = answer, (200...299).contains(response.statusCode) else { set(\.activityFailed, true); return false }
        if let was = builtFrom, was.data == data, was.names == names, activity != nil {
            set(\.activityFailed, false)
            return true
        }
        let built = await buildRows(names, data)
        // A newer read that landed while this one was building stands.
        guard !Task.isCancelled, current, mine == activityShown else { return false }
        guard let built else { set(\.activityFailed, true); return false }
        set(\.activityFailed, false)
        builtFrom = (data, names)
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

    // One 5-second tick of the page (TaskPageView's loop): the task while on screen, then its activity and the seen
    // mark only while the person is there. `returning` (the page appearing, the app coming back) records the state once
    // more, as the board's tkTabReturn does, but only the state this tick just read: a read that fails records nothing,
    // so a nudge that arrived while they were away is never marked before it is shown.
    func tick(first: Bool, returning: Bool, names: [String: String]) async {
        if first || shouldReadTask { await read() }
        guard shouldReadActivity(first: first) else { return }
        if await readActivity(names: names) { await markSeen(again: first && returning) }
    }

    // Mark as done or Reopen, as the button showed it. A press whose button no longer matches the task (another
    // device closed it meanwhile) sends nothing: the page already shows the new state. Then both are read again.
    func press(_ shown: Board.TaskAct, names: [String: String]) async {
        // Not while a hold is out either (review 1): a close landing between a hold's check and its post would answer the
        // hold with the Mac's refusal for a closed task.
        // Nor while a Repeats or reviewer save is out (B3, B3b): its answer would be about a task this press is closing.
        guard !pressing, !holding, !repeatSaving, reviewerSaving == nil, partWriting == nil, current, let page, page.act == shown else { return }
        pressing = true
        clearRefusal()
        clearPart()
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskActRequest(mac: $0, project: project, number: number, act: shown) }
        guard current else { return }
        if case .refused(let why) = Board.taskActResult(status: answer?.1.statusCode ?? 0, body: answer?.0) { refusal = why }
        await read()
        await readActivity(names: names)
        guard current else { return }
        pressing = false
    }

    // kosmos#8958 slice B6: the board's "Close them and this task": each built subtask in number order, then this task, through
    // the route Mark as done uses. The first refusal, or no answer, stops it there. The task is read first (the page may be
    // an hour old): nothing is sent unless the subtasks are still as the line said, nor while another press is out. Then
    // both are read again. True when all of them are closed: every close was answered so, or they read so (an answer lost).
    @discardableResult
    func closeWithSubtasks(names: [String: String]) async -> Bool {
        guard !pressing, !holding, !repeatSaving, reviewerSaving == nil, partWriting == nil, current, let page, page.allSubtasksBuilt else { return false }
        pressing = true
        closingSubtasks = true
        clearRefusal()
        clearPart()
        let (project, number) = (self.project, self.number)
        let built = page.subtasks.filter { $0.status == "Built" }.map(\.number)
        enum Stop { case unsent(String), refused(at: Int?, why: String, closed: Int), unsure }
        var stopped: Stop?
        let fresh = await freshRead()
        guard current else { return false }
        var same = false
        if case .some(.page(let p)) = fresh { same = p.allSubtasksBuilt && p.subtasks.filter { $0.status == "Built" }.map(\.number) == built }
        if !same { stopped = .unsent(fresh == nil ? Board.subtasksCheckFailed : Board.subtasksChanged) }
        if stopped == nil {
            for (closed, n) in (built + [number]).enumerated() {
                let answer = await send { Board.taskActRequest(mac: $0, project: project, number: n, act: .close) }
                guard current else { return false }
                if let stop = Board.closeStop(status: answer?.1.statusCode ?? 0, body: answer?.0) {
                    if case .refused(let why) = stop { stopped = .refused(at: closed < built.count ? n : nil, why: why, closed: closed) }
                    else { stopped = .unsure }
                    break
                }
            }
        }
        // As saveReviewer's: the number read() gives the read below.
        let ownRead = pageReads + 1
        await read()
        guard current else { return false }
        let readOK = pageReadOK >= ownRead
        await readActivity(names: names)
        guard current else { return false }
        pressing = false
        closingSubtasks = false
        guard let stopped else { return true }
        // Read after the press: this task and all its subtasks are closed, whatever an answer said or was lost.
        let shut = self.page?.closed == true
        if shut, self.page?.subtasks.allSatisfy(\.closed) == true { return true }
        switch stopped {
        case .unsent(let words):
            // Closed elsewhere: the page says that, and nothing was sent.
            if shut { return false }
            refusal = words
        case .refused(let at, let why, let closed): refusal = Board.subtasksStopped(at: at, why: why, closed: closed, open: !shut)
        case .unsure: refusal = readOK ? Board.subtasksCloseUnsure : Board.subtasksCloseUnsureUnread
        }
        if readOK { refusalSubtasks = self.page?.subtasks } else { refusalAwaits = true }
        return false
    }

    // kosmos#8958 slice B7: the board's tkPartPost: one part write, then the task and activity read again and who was told
    // said. Nothing is sent for a part the page does not have, or that already reads so. Who is on a part is read fresh
    // first (partChoosable), and so is an Add of words whose last Add could not be told. No answer is judged by the read
    // after it. `atHold` says the line by Choose who. True when it was made.
    @discardableResult
    func writePart(_ write: Board.PartWrite, atHold: Bool = false, name: @escaping (Board.TaskPage, String) -> String, names: [String: String]) async -> Bool {
        guard partWriting == nil, !pressing, !holding, !repeatSaving, reviewerSaving == nil, current, let page else { return false }
        var words: String?
        if case .add(let said) = write {
            words = said.trimmingCharacters(in: .whitespacesAndNewlines)
            if words == "" { return false }
        } else {
            guard page.parts.contains(where: { $0.id == Board.partId(write) }), !Board.partWritten(write, before: page.parts, now: page.parts) else { return false }
        }
        partWriting = write
        clearPart()
        partAtHold = atHold
        var before = page.parts
        let (project, number) = (self.project, self.number)
        var answer: (Data, HTTPURLResponse)?
        var unsent: String?
        var already = false
        var again = false
        if let open = addUnsettled, open.words == words { again = true; before = open.before }
        if again || Board.partChecked(write) {
            let fresh = await freshRead()
            guard current else { return false }
            if case .some(.page(let p)) = fresh {
                if again { already = Board.partWritten(write, before: before, now: p.parts) }
                else if !Board.partChoosable(write, on: p) { unsent = Board.partChanged }
            } else { unsent = fresh == nil ? Board.holdCheckFailed : Board.holdTaskGone }
        }
        if unsent == nil, !already {
            answer = await send { Board.partRequest(mac: $0, project: project, number: number, write) }
            guard current else { return false }
        }
        let ownRead = pageReads + 1
        await read()
        guard current else { return false }
        let readOK = pageReadOK >= ownRead
        func told(_ session: String) -> String { self.page.map { name($0, session) } ?? session }
        var made = false
        var say: String?
        var refused = false
        let status = answer?.1.statusCode ?? 0
        if let unsent {
            say = unsent; refused = true
        } else if already || (200...299).contains(status) {
            say = Board.heardLine(answer?.0, name: told)
            made = true
        } else {
            switch Board.unfinished(status: status, body: answer?.0, failed: Board.partFailed) {
            case .refused(let why): say = why; refused = true
            case .unsure:
                made = self.page.map { Board.partWritten(write, before: before, now: $0.parts) } ?? false
                if made {
                    if case .who(_, let who?, _) = write { say = Board.partUntold(told(who)) }
                } else {
                    say = Board.partUnsure; refused = true
                    partUnsureOf = (write, before, name)
                    if let words { addUnsettled = (words, before) }
                }
            }
        }
        // Kept against the parts as read here, before the activity's read, which can take as long again.
        partSay = say
        partRefused = refused
        partWrote = write
        if say != nil { if readOK { partSig = self.page.map { Board.partSig($0, write) } } else { partSigAwaits = true } }
        if made, words != nil { addUnsettled = nil }
        await readActivity(names: names)
        guard current else { return false }
        partWriting = nil
        return made
    }
    private func clearPart() {
        if partSay != nil { partSay = nil }
        if partRefused { partRefused = false }
        if partAtHold { partAtHold = false }
        partSig = nil
        partSigAwaits = false
        partUnsureOf = nil
        partWrote = nil
    }
    // Each read of the task: what could not be told may be settled by it, and a line goes once what it was said of reads
    // otherwise. After a write whose own read failed, the next that works is what the line is kept against (the write itself
    // would be the change).
    private func keepPartLine(_ p: Board.TaskPage) {
        if let open = addUnsettled, Board.partWritten(.add(open.words), before: open.before, now: p.parts) {
            addUnsettled = nil
            partAdded = open.words
            if case .add = partUnsureOf?.0 { clearPart() }
        }
        if let (write, before, name) = partUnsureOf, Board.partWritten(write, before: before, now: p.parts) {
            clearPart()
            if case .who(_, let who?, _) = write {
                partSay = Board.partUntold(name(p, who))
                partWrote = write
                partSig = Board.partSig(p, write)
            }
        }
        if partSigAwaits { partSigAwaits = false; partSig = Board.partSig(p, partWrote) }
        if let was = partSig, was != Board.partSig(p, partWrote) { clearPart() }
    }
    // The view has emptied its box of the added words.
    func tookAdded() { partAdded = nil }

    // Choosing with nobody on the project to choose: goes when somebody is.
    func sayNoMembers() {
        guard partWriting == nil, let page else { return }
        clearPart()
        partSay = Board.partNoMembers
        partSig = Board.partSig(page, nil)
    }
    // As the board's Choose who with no members: its line goes, and says where people come from instead.
    func sayNoMembersOnHold() { holdSay = Board.holdChooseNobody; holdChoose = false; holdSaySig = nil }

    // The receipt's read in the air is given up: another is wanted, the task is open, or the page left the screen or the app
    // the front. A read cut short is no failure, and is asked for again on the next read of the task (the Mac goes on working
    // it out meanwhile, and shares it).
    func stopReceipt() {
        stopUndoRead()
        guard let reading = receiptReading else { return }
        reading.cancel()
        receiptReading = nil
        receiptReads += 1
        receiptAsked = nil
    }

    // kosmos#8958 slice B4: the board's tkReceiptSync and paintTaskReceipt, after every read of the task. Asked only when the
    // closed state changed since it was last asked, and again 30 s after a read that failed. Not awaited: the Mac's first
    // read of long transcripts can take seconds, and the page's own tick must not wait for it. One read at a time: an
    // older one is cancelled (it would hold one of the few connections every call to the Mac shares), and only the newest
    // ask draws.
    func syncReceipt() {
        guard current, let page, !gone else { return }
        guard let key = page.receiptKey else {
            // Open: no receipt, and one still in the air draws nothing.
            stopReceipt()
            hideUndo()
            receiptAsked = nil
            if receipt != nil { receipt = nil }
            return
        }
        guard key != receiptAsked else {
            if receiptReading == nil { syncUndo(key) }
            return
        }
        stopReceipt()   // one still out is for another close
        // So is what an undo of the last one would do: the files, and why each is or is not chosen, may differ now. An undo
        // still out keeps its list until it answers.
        if undoPlanKey != key, !undoing { hideUndo() }
        // Only while the page is in front: a press's read landing after the person left asks for nothing; the read on their
        // return does.
        guard shouldReadTask else { return }
        if let f = receiptFailed, f.key == key, now().timeIntervalSince(f.at) < Self.receiptRetry { return }
        receiptAsked = key
        receiptReads += 1
        let mine = receiptReads
        let (project, number) = (self.project, self.number)
        receiptReading = Task { [weak self, send] in
            let answer = await send { Board.taskReceiptRequest(mac: $0, project: project, number: number) }
            guard let self, mine == self.receiptReads else { return }
            self.receiptReading = nil
            guard self.current else { return }
            var read = Board.ReceiptRead.unreadable
            if let (data, response) = answer, (200...299).contains(response.statusCode) {
                // Replaced or never run as the task reads now, not as it did when this was asked.
                read = Board.parseReceipt(data, replaced: self.page?.replacedBy != nil, unrun: self.page?.closedUnrun == true)
            }
            var shown: Board.Receipt?
            switch read {
            case .receipt(let r): shown = r; self.receiptFailed = nil
            case .none: self.receiptFailed = nil
            // Asked again after receiptRetry, not left hidden while the page stays open.
            case .unreadable: self.receiptFailed = (key, self.now()); self.receiptAsked = nil
            }
            if self.receipt != shown { self.receipt = shown }
            if shown == nil { self.hideUndo() } else { self.syncUndo(key) }
        }
    }

    // kosmos#8958 slice B5: the board's paintTaskUndo, once a receipt is drawn: what an undo would do, offered only when the
    // Mac has files to offer. A read that failed offers nothing, and is asked again after receiptRetry, as the receipt is.
    // Not while an undo is out: its answer is about the list it was chosen from.
    private func syncUndo(_ key: String) {
        guard current, !gone, shouldReadTask, receipt != nil, !undoing, key != undoAsked else { return }
        if let f = undoFailedRead, f.key == key, now().timeIntervalSince(f.at) < Self.receiptRetry { return }
        stopUndoRead()
        undoAsked = key
        undoReads += 1
        let mine = undoReads
        let (project, number) = (self.project, self.number)
        undoReading = Task { [weak self, send] in
            let answer = await send { Board.taskUndoRequest(mac: $0, project: project, number: number) }
            guard let self, mine == self.undoReads else { return }
            self.undoReading = nil
            guard self.current else { return }
            var read = Board.UndoRead.unreadable
            if let (data, response) = answer, (200...299).contains(response.statusCode) { read = Board.parseUndoPlan(data) }
            var plan: Board.UndoPlan?
            self.undoFailedRead = nil
            switch read {
            case .plan(let p): plan = p
            case .off: break
            case .unreadable: self.undoFailedRead = (key, self.now()); self.undoAsked = nil
            }
            self.clearUndoSay()
            self.undoPlanKey = key
            if self.undoPlan != plan { self.undoPlan = plan }
        }
    }

    // The plan's read in the air is given up, and asked for again on the next read of the task.
    private func stopUndoRead() {
        guard let reading = undoReading else { return }
        reading.cancel()
        undoReading = nil
        undoReads += 1
        undoAsked = nil
    }

    // The board's tkUndoHide: the receipt went (the task was put back, or is gone), and the undo with it.
    private func hideUndo() {
        stopUndoRead()
        undoReads += 1
        undoAsked = nil
        clearUndoSay()
        if undoDone != nil { undoDone = nil }
        if undoPlan != nil { undoPlan = nil }
    }

    // The list opens: no read of the plan lands under it and takes the person's choices away (the board shows the link again
    // only once its read is in). Another close still reads its own.
    func openUndo() {
        clearUndoSay()
        stopUndoRead()
        undoAsked = undoPlanKey
    }
    // The list was left without an undo (the board's Cancel): the plan is read again.
    func leaveUndo() {
        clearUndoSay()
        guard undoPlan != nil, !undoing, let key = page?.receiptKey else { return }
        undoAsked = nil
        syncUndo(key)
    }
    func clearUndoSay() {
        if undoSay != nil { undoSay = nil }
        if undoRefused { undoRefused = false }
    }

    // "Undo the chosen files" of `list`, the plan the person chose from. Nothing is sent for no files, while one is on its
    // way, or when what is offered is not that list any more. The line that says what was done takes the offer's place; a
    // refusal keeps the list with its words. Then the activity is read, after a refusal too: an undo whose answer was lost
    // shows there.
    func undo(_ paths: [String], of list: Board.UndoPlan, names: [String: String]) async {
        guard !undoing, current, undoPlan == list else { return }
        clearUndoSay()
        guard !paths.isEmpty else { undoSay = Board.undoChoose; return }
        // The list is of an earlier close (it stayed open under a refusal): what it says of each file may be wrong now.
        guard page?.receiptKey == undoPlanKey else { undoSay = Board.undoClosedAgain; undoRefused = true; return }
        stopUndoRead()   // one still out would draw over this one's answer
        undoing = true
        let mine = undoReads
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskUndoApply(mac: $0, project: project, number: number, paths: paths) }
        guard current else { return }
        undoing = false
        // Put back meanwhile: there is no receipt for this to stand under.
        if mine == undoReads {
            switch Board.undoResult(status: answer?.1.statusCode ?? 0, body: answer?.0) {
            case .refused(let why):
                undoSay = why
                undoRefused = true
            case .done(let line):
                undoDone = line
                undoPlan = nil
                undoPlanKey = self.page?.receiptKey
            }
            // Closed again while it was out, maybe: this close is taken as asked, so the next read does not wipe the words.
            undoAsked = self.page?.receiptKey
        }
        await readActivity(names: names)
    }

    // kosmos#8958 slice B2: the board's tk-hold button, as the button showed it (`wasOnHold`). Putting it on hold reads the
    // task first, because a hold from the screen sets exactly what it sends and would replace what an agent's hold, not
    // yet shown here, waits for; if it is already on hold, nothing is sent. Then the page and activity are read, and an
    // unhold's sentence about who has it next is said.
    // The board's tkHoldFresh: one read of this task for this press alone, so the shared tick's read (numbered, and
    // dropped when a newer one overtakes it) can never leave the check looking at the task as it was before the press.
    // nil when the Mac gave no list.
    private func freshRead() async -> Board.TaskPageRead? {
        let answer = await send { Board.projectsRequest(mac: $0) }
        guard let (data, response) = answer, (200...299).contains(response.statusCode) else { return nil }
        let parsed = await parse(data, project, number)
        if case .unreadable = parsed { return nil }
        return parsed
    }

    func toggleHold(wasOnHold: Bool, names: [String: String]) async {
        guard !holding, !pressing, partWriting == nil, current, let page, !page.closed, page.onHold == wasOnHold else { return }
        holding = true
        clearPart()
        holdSay = nil
        holdChoose = false
        holdSaySig = nil
        holdRefused = false
        if !wasOnHold {
            // Putting on hold sets exactly what it sends, so it would replace an agent's hold (its until and why) not
            // yet shown: the task is read fresh first, and nothing is sent if it is already on hold, gone or unread.
            let fresh = await freshRead()
            guard current else { return }
            switch fresh {
            case .none, .some(.unreadable):
                holdSay = Board.holdCheckFailed; holding = false; return
            case .some(.gone):
                await read()
                guard current else { return }
                holdSay = Board.holdTaskGone; holding = false; return
            case .some(.page(let p)) where p.onHold:
                await read()
                await readActivity(names: names)
                guard current else { return }
                holdSay = Board.holdAlready
                holding = false
                return
            case .some(.page):
                break
            }
        }
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskHoldRequest(mac: $0, project: project, number: number, onHold: !wasOnHold) }
        guard current else { return }
        if case .refused(let why) = Board.taskWriteResult(status: answer?.1.statusCode ?? 0, body: answer?.0,
                                                          failed: Board.holdFailed, unreached: Board.holdUnreached) {
            holdSay = why
            holdRefused = true
            holding = false
            return
        }
        await read()
        await readActivity(names: names)
        guard current else { return }
        // As the board's tkHoldSayNext: the sentence is about the task in the answer, and is said only while the page
        // still shows that task as it was (a hand-out landing before the read, or a read that failed, says nothing).
        if let told = Board.holdAnswerTask(answer?.0, project: project, number: number), let shown = self.page,
           Board.holdNextSig(told, project: shown) == Board.holdNextSig(shown),
           let next = Board.holdNextLine(answer?.0, page: told) {
            holdSay = next.words
            holdChoose = next.choose
            holdSaySig = Board.holdNextSig(shown)
        }
        holding = false
    }

    // kosmos#8958 slice B1: a message on the task (the board's tkSayPost). true when the Mac recorded it, so the box can
    // be emptied; the line under it then says who it did not reach. Nothing is sent for an empty box or while one is
    // on its way. Then the activity is read again, where the message now shows.
    func say(_ text: String, name: @escaping (String) -> String, names: [String: String]) async -> Bool {
        guard !saying, current, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        saying = true
        sayLine = nil
        sayRefused = false
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskMessageRequest(mac: $0, project: project, number: number, text: text) }
        guard current else { return false }
        saying = false
        let status = answer?.1.statusCode ?? 0
        if case .refused(let why) = Board.taskWriteResult(status: status, body: answer?.0, failed: Board.taskSayFailed, unreached: Board.taskSayUnreached) {
            sayLine = why
            sayRefused = true
            return false
        }
        sayLine = Board.taskSaidLine(answer?.0, name: name)
        await readActivity(names: names)
        return true
    }

    // The due date set (a YYYY-MM-DD) or cleared (nil), as the board's saveTaskDue; then the task and activity are read.
    // true when the Mac recorded it (false when refused, or when nothing was sent).
    @discardableResult
    func setDue(_ due: String?, names: [String: String]) async -> Bool {
        guard !dueSaving, current else { return false }
        // A date the Mac would refuse is said here, not sent (and never read as the Mac being out of reach).
        if let due, Board.dueDay(due) == nil { dueRefusal = Board.taskDueFailed; return false }
        dueSaving = true
        dueRefusal = nil
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskDueRequest(mac: $0, project: project, number: number, due: due) }
        guard current else { return false }
        var recorded = true
        if case .refused(let why) = Board.taskWriteResult(status: answer?.1.statusCode ?? 0, body: answer?.0,
                                                          failed: Board.taskDueFailed, unreached: Board.taskDueUnreached) { dueRefusal = why; recorded = false }
        await read()
        await readActivity(names: names)
        guard current else { return false }
        dueSaving = false
        return recorded
    }

    // The board's tk-editform Save: true when the form can close (saved, or nothing changed). The words compared are the
    // ones the form opened with, so a change made elsewhere meanwhile is never sent back over.
    func saveText(title: String, detail: String, openedTitle: String, openedDetail: String?, names: [String: String]) async -> Bool {
        guard !editSaving, current else { return false }
        editRefusal = nil
        let body: [String: String?]
        switch Board.taskEdit(title: title, detail: detail, openedTitle: openedTitle, openedDetail: openedDetail) {
        case .nothing: return true
        case .needsTitle: editRefusal = Board.taskEditNeedsTitle; return false
        case .send(let b): body = b
        }
        editSaving = true
        let (project, number) = (self.project, self.number)
        let wire = Board.taskTextBody(body)
        let answer = await send { Board.taskTextRequest(mac: $0, project: project, number: number, body: wire) }
        guard current else { return false }
        if case .refused(let why) = Board.taskWriteResult(status: answer?.1.statusCode ?? 0, body: answer?.0,
                                                          failed: Board.taskEditFailed, unreached: Board.taskEditFailed) {
            editRefusal = why
            editSaving = false
            return false
        }
        // Locked until the page is read again (the phone's own choice: the board unlocks before its reload), so a second
        // Save in between cannot send the same change again.
        await read()
        await readActivity(names: names)
        guard current else { return false }
        editSaving = false
        return true
    }
    // kosmos#8958 slice B3: the board's Repeats Save (tk-repeat-save). Nothing is sent while a box is empty, while one is
    // on its way, while a reviewer save or Mark as done is out, on a finished task, or for the rule already stored. A
    // hold in flight does not stop it: the board's repeat and hold routes change different fields, and a held task can
    // still repeat. true when the Mac recorded it; then the task and activity are read.
    func saveRepeat(_ wire: Board.RepeatWire, names: [String: String]) async -> Bool {
        guard !repeatSaving, reviewerSaving == nil, !pressing, partWriting == nil, current, let page, !page.closed, Board.repeatBody(wire) != nil,
              page.repeatStored.map(Board.repeatWire) != wire else { return false }
        repeatSaving = true
        repeatSay = nil
        repeatSavedAs = nil
        repeatRefused = false
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskRepeatRequest(mac: $0, project: project, number: number, wire: wire) }
        guard current else { return false }
        if case .refused(let why) = Board.taskWriteResult(status: answer?.1.statusCode ?? 0, body: answer?.0,
                                                          failed: Board.repeatFailed, unreached: Board.repeatUnreached) {
            repeatSay = why
            repeatRefused = true
            repeatSaving = false
            return false
        }
        await read()
        await readActivity(names: names)
        guard current else { return false }
        repeatSay = Board.repeatSaved
        repeatSavedAs = wire
        repeatSaving = false
        return true
    }
    // kosmos#8958 slice B3b: the board's tk-review-who change. Nothing is sent for the reviewer already stored, while one
    // is on its way, while a Repeats save or Mark as done is out, or on a task that is finished or does not repeat.
    // true when the Mac recorded it; then the task and activity are read.
    func saveReviewer(_ want: String, names: [String: String]) async -> Bool {
        // Compared with what the choice shows: after a save whose read failed that is the saved reviewer, not the page's.
        guard reviewerSaving == nil, !repeatSaving, !pressing, partWriting == nil, current, let page, !page.closed, page.repeatRow != nil,
              (reviewerShown ?? page.repeatReviewer) != want else { return false }
        reviewerSaving = want
        reviewerSay = nil
        reviewerSavedAs = nil
        reviewerRefused = false
        let (project, number) = (self.project, self.number)
        let answer = await send { Board.taskReviewerRequest(mac: $0, project: project, number: number, reviewer: want) }
        guard current else { return false }
        if case .refused(let why) = Board.taskWriteResult(status: answer?.1.statusCode ?? 0, body: answer?.0,
                                                          failed: Board.reviewerFailed, unreached: Board.reviewerUnreached) {
            reviewerSay = why
            reviewerRefused = true
            reviewerSaving = nil
            return false
        }
        // The number read() gives the read below: read() is on the main actor and counts before its first suspension.
        let ownRead = pageReads + 1
        await read()
        guard current else { return false }
        if pageReadOK < ownRead { reviewerShown = want }
        await readActivity(names: names)
        guard current else { return false }
        // Said only while the choice shows what was saved: a read showing someone else (changed elsewhere in between)
        // would otherwise put "Saved." under that other name.
        if (reviewerShown ?? self.page?.repeatReviewer) == want {
            reviewerSay = Board.repeatSaved   // the same word on purpose: the board says "Saved." for both
            reviewerSavedAs = want
        }
        reviewerSaving = nil
        return true
    }

    // A new choice retires the last answer (the board's review 1).
    func clearRepeatSay() { repeatSay = nil; repeatSavedAs = nil; repeatRefused = false }
    func clearEditRefusal() { editRefusal = nil }
    func clearDueRefusal() { dueRefusal = nil }

    // POST .../seen for the activity state on screen, once per state, only while the person is there (present); a 5xx
    // or no answer is tried once more 3 s later, only if that state is still the one shown and they are still there
    // (the board's tkMarkSeen). Called after every read and when a new state is drawn, so a state that landed while
    // they were away or idle is marked once they are back. `again` (the page appearing, the app coming back) records
    // the same state once more, as the board's tkTabReturn does, so "seen at" moves to now.
    func markSeen(again: Bool = false) async {
        // The reset for a return happens only when the mark can go now, so a return that cannot mark (the app not in
        // front, nobody there) leaves the recorded state recorded.
        let reset = again && seenKey != nil && seenKey == recordedKey
        guard current, let key = activityKey, present, reset || key != seenKey else { return }
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
