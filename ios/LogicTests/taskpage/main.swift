import Foundation
import Combine
// Tests for the native task page (kosmos#7074), compiled for macOS with the app files run-taskpage.sh lists.
// projects-tasks.json and activity-<n>.json are what the Mac's own engine produced (engine/projects.js list, engine/
// tasks.js create/close/setBuilt/setDue/addPart/setPartClosed/setOnHold/say, engine/taskchat.js read) in a throwaway
// folder: the answers of GET /api/projects and GET .../task/<n>/activity. Not hand-written. The project folder path in
// them was replaced with a neutral one.
// It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() {
        passed += 1
        print("  ok   \(name)")
    } else {
        failed += 1
        print("  FAIL \(name) (line \(line))")
    }
}
func section(_ name: String) { print(name) }
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
func fixture(_ name: String) -> Data { (try? Data(contentsOf: here.appendingPathComponent(name))) ?? Data() }
let projectsData = fixture("projects-tasks.json")
check(!projectsData.isEmpty, "premise: the captured projects read is there")
var cal = Calendar(identifier: .gregorian)
cal.timeZone = TimeZone(identifier: "UTC")!
let roster = ["dana": "Dana (roster)", "gus": "Gus"]
func page(_ n: Int) -> Board.TaskPage? {
    if case .page(let p) = Board.parseTaskPage(projectsData, project: "springcatalogue", number: n) { return p }
    return nil
}
func names(_ p: Board.TaskPage?) -> (String) -> String { { s in p?.name(s, roster: roster) ?? s } }

section("reading a task from the projects read")
let parent = page(1)
check(parent?.projectName == "Spring catalogue" && parent?.sentence == "Print-ready catalogue", "the project and the task's title")
check(parent?.detail == "All **twelve** pages, checked against the price sheet.", "its detail, as written (formatted when drawn)")
check(parent?.subtasks.map(\.number) == [2, 3, 4] && parent?.subtasks.map(\.status) == ["Done", "Built", "Open"],
      "its subtasks in number order, each Done, Built or Open")
check(parent?.allSubtasksDone == false && parent?.allSubtasksBuilt == false, "one subtask still open: neither all-done line")
// kosmos#8146: a held subtask reads On hold, as the board's task page does since #8140. The captured read with its
// open subtask (4) and its built one (3) put on hold, as engine/tasks.js setOnHold stores it (onHold: true): a held
// one is never Built (the board's built() leaves held out, kosmos#5956).
func withHeld(_ numbers: Set<Int>) -> Data {
    guard var top = try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any],
          var projects = top["projects"] as? [[String: Any]],
          let i = projects.firstIndex(where: { $0["id"] as? String == "springcatalogue" }),
          var list = projects[i]["tasks"] as? [[String: Any]] else { return Data() }
    for j in list.indices where numbers.contains((list[j]["number"] as? NSNumber)?.intValue ?? -1) { list[j]["onHold"] = true }
    projects[i]["tasks"] = list
    top["projects"] = projects
    return (try? JSONSerialization.data(withJSONObject: top)) ?? Data()
}
func statuses(_ d: Data) -> [String]? {
    if case .page(let p) = Board.parseTaskPage(d, project: "springcatalogue", number: 1) { return p.subtasks.map(\.status) }
    return nil
}
check(statuses(withHeld([4])) == ["Done", "Built", "On hold"], "a held open subtask reads On hold, not Open")
check(statuses(withHeld([3])) == ["Done", "On hold", "Open"], "a held built subtask reads On hold, not Built")
check(statuses(withHeld([2])) == ["Done", "Built", "Open"], "a closed subtask still reads Done when held (closing drops a hold)")
check(statuses(withHeld([])) == ["Done", "Built", "Open"], "CONTROL: the rebuilt read with nothing held reads as the captured one")
check(parent?.stateLine(roster: roster) == "Open" && parent?.act == .close && parent?.act.title == "Mark as done", "open: Mark as done")
let createdAt = Tasks.parseISO("2026-10-25T00:36:58.000Z")!
check(parent?.added(now: createdAt, calendar: cal) == "You, today", "added by the person, today")
check(parent?.addedLine(now: createdAt, calendar: cal) == "Added by you, today" && page(5)?.addedLine(now: createdAt, calendar: cal) == "Added by eli, today",
      "the line drawn: the board's fixed opening lowered, a name left as it is")
check(parent?.added(now: createdAt.addingTimeInterval(86_400), calendar: cal) == "You, yesterday"
      && parent?.added(now: createdAt.addingTimeInterval(3 * 86_400), calendar: cal) == "You, 3 days ago", "yesterday, then days ago")
check(parent?.partLines(roster: roster).map(\.who) == ["Nobody yet"] && parent?.closeNote(roster: roster) == nil,
      "nobody on it: Nobody yet, and no close note")

let built = page(3)
check(built?.stateLine(roster: roster) == "Open, marked built by Dana: captions need a check", "built: who marked it and the note")
// kosmos#8939: the page says what the mark waits on, after who and before the note; a value not in the table says nothing.
func withBuiltWaiting(_ v: String) -> Board.TaskPage? {
    guard var top = try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any],
          var projects = top["projects"] as? [[String: Any]],
          let i = projects.firstIndex(where: { $0["id"] as? String == "springcatalogue" }),
          var list = projects[i]["tasks"] as? [[String: Any]] else { return nil }
    for j in list.indices where (list[j]["number"] as? NSNumber)?.intValue == 3 { list[j]["builtWaitingOn"] = v }
    projects[i]["tasks"] = list
    top["projects"] = projects
    guard let d = try? JSONSerialization.data(withJSONObject: top), case .page(let p) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) else { return nil }
    return p
}
check(withBuiltWaiting("person")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on you: captions need a check", "built, waiting on you")
check(withBuiltWaiting("review")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on a review: captions need a check", "built, waiting on a review")
check(withBuiltWaiting("release")?.stateLine(roster: roster) == "Open, marked built by Dana, waiting on a release: captions need a check", "built, waiting on a release")
check(withBuiltWaiting("__proto__")?.stateLine(roster: roster) == "Open, marked built by Dana: captions need a check", "a value not in the table says nothing")
check(built?.parentNumber == 1 && built?.parentSentence == "Print-ready catalogue", "the task it is part of")
check(built?.partLines(roster: roster) == [Board.TaskPage.PartLine(id: "1", who: "Dana", line: nil, say: nil, done: false)],
      "Dana by the project's own name; a could-not-tell claim says nothing on the part")
check(built?.whyLine(roster: roster) == "We could not check whether Dana is on this: we cannot tell whether this is the same agent, so we cannot say whether it holds this task.",
      "the why line says the reason in full")
check(built?.closeNote(roster: roster) == "Marking it done closes it here. It does not stop Dana or change what Dana is doing.", "the close note")

let parts = page(5)
check(parts?.stateWord == "1 of 2 parts done", "two parts, one done: the count")
check(parts?.partLines(roster: roster).map { "\($0.who)|\($0.line ?? "")|\($0.done)" } == ["Eli||true", "Dana|Check linen prices|false"],
      "each part: who, its own words when they differ, and done")
check(parts?.holdLine == "You put this on hold, so only you can take it off, here. Kosmos does not nudge anyone about it or hand it out.",
      "held by the person: said, and where it is taken off (here, since #8958 slice B2)")
check(parts?.added(now: createdAt, calendar: cal) == "eli, today", "added by an agent: the board's own words (its session name)")

let replaced = page(6)
check(replaced?.stateWord == "Replaced by task 7" && replaced?.act == .reopen && replaced?.act.title == "Reopen", "replaced: says so, and Reopen")
check(replaced?.closeNote(roster: roster) == nil && replaced?.holdLine == nil, "a closed task has no close note and no hold line")
check(page(7)?.stateLine(roster: roster) == "Open. Replaces task 6", "the task that replaced it names it")
check(page(2)?.closed == true && page(2)?.closeNote(roster: roster) == nil && page(2)?.partLines(roster: roster).first?.who == "Dana",
      "a finished task with an agent on it: no close note (closing it again stops nobody)")
check(page(4)?.dueDate == "2026-10-30" && page(1)?.dueDate == nil, "the due date as the Mac keeps it, or none")

check(Board.parseTaskPage(projectsData, project: "springcatalogue", number: 99) == .gone, "a task the list does not have is gone")
check(Board.parseTaskPage(projectsData, project: "nosuch", number: 1) == .gone, "so is a project it does not have")
check(Board.parseTaskPage(Data("<html>".utf8), project: "springcatalogue", number: 1) == .unreadable, "a page that is not the list is unreadable")

section("the words for states the fixture does not hold")
func synthetic(_ task: String, agents: String = #"[{"sessionName":"dana","name":"Dana"}]"#, paused: Bool = false) -> Board.TaskPage? {
    let json = #"{"projects":[{"id":"p1","name":"P","paused":\#(paused),"agents":\#(agents),"tasks":[\#(task)]}]}"#
    if case .page(let p) = Board.parseTaskPage(Data(json.utf8), project: "p1", number: 1) { return p }
    return nil
}
let claimedTrue = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S","closedAt":null}],"progress":{"done":0,"total":1,"closed":false},"claim":{"claimed":true,"about":"dana"}}"#)
check(claimedTrue?.partLines(roster: roster).first?.say == "says it is on this", "a claim: said on the agent's part")
check(claimedTrue?.closeNote(roster: roster) == "Dana says it is on this. Marking it done closes it here. It does not stop Dana or change what Dana is doing.",
      "and its premise starts the close note")
let notReported = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S","closedAt":null}],"claim":{"claimed":null,"neverReported":true,"about":"dana"}}"#)
check(notReported?.partLines(roster: roster).first?.say == "has not reported what it is working on yet" && notReported?.whyLine(roster: roster) == nil,
      "not reported: said once, on the part")
let stranger = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"gus","sentence":"S","closedAt":null}]}"#)
check(stranger?.partLines(roster: roster).first?.who == "Gus (not on this project)", "an agent holding open work without being a member")
let allDoneOpen = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"sentence":"S"}],"progress":{"done":1,"total":1,"closed":true}}"#)
check(allDoneOpen?.closed == true && allDoneOpen?.act == .reopen, "every part done with no closedAt: closed by its progress, so Reopen")
// kosmos#7788: an agent's hold for the person says it waits on them; a plain agent hold keeps the outside words (control).
check(synthetic(#"{"number":1,"sentence":"S","onHold":true,"onHoldForPerson":true}"#)?.holdLine?.hasPrefix("An agent put this on hold because it waits on you.") == true,
      "an agent's hold for you says it waits on you")
check(synthetic(#"{"number":1,"sentence":"S","onHold":true}"#)?.holdLine?.hasPrefix("This was put on hold outside this screen") == true,
      "control: a plain agent hold keeps its words")
// The board's page, found from this file (ios/LogicTests/taskpage/main.swift -> the repo root): run-taskpage.sh passes no repo.
let boardPage = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("web/index.html")
check(String(data: (try? Data(contentsOf: boardPage)) ?? Data(), encoding: .utf8)?
        .contains("'An agent put this on hold because it waits on you. Once you have answered, take it off hold here, or tell the agent.") == true,
      "the board's hint opens with the same words")
check(synthetic(#"{"number":1,"sentence":"S"}"#, paused: true)?.holdLine == "This project is paused, so Kosmos does not nudge anyone about its tasks or hand them out.",
      "a paused project says so")
let webhook = synthetic(#"{"number":1,"sentence":"S","addedBy":"Shop","addedVia":"webhook","createdAt":"2026-10-01T10:00:00.000Z"}"#)
check(webhook?.added(now: Tasks.parseISO("2026-10-24T10:00:00.000Z")!, calendar: cal) == "Shop (a webhook), Oct 1", "a webhook's task, a while ago: the date")
let youName = synthetic(#"{"number":1,"sentence":"S","addedBy":"You Need A Budget","addedVia":"webhook","createdAt":"2026-10-24T10:00:00.000Z"}"#)
check(youName?.addedLine(now: Tasks.parseISO("2026-10-24T11:00:00.000Z")!, calendar: cal) == "Added by You Need A Budget (a webhook), today",
      "a name that starts like a fixed word is left as it is")
check(synthetic(#"{"number":1,"sentence":"S","addedVia":"process"}"#)?.addedLine(now: Date(), calendar: cal) == "Added by an agent",
      "a fixed opening is lowered")
check(synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"sentence":"S"},{"id":2,"sentence":"T","closedAt":"2026-10-24T10:00:00.000Z"}]}"#)?.stateWord == "Open",
      "no progress from the engine: Open or Done, never a count of its own")

section("Mark as done, Reopen and seen: the requests")
let mac = URL(string: "https://studio.kosmosplus.com")!
let close = Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .close)
check(close?.httpMethod == "POST" && close?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/springcatalogue/task/3/close" && close?.httpBody == nil,
      "close: a POST to the task's own route, with no body")
let coordinatorURL = URL(string: "https://login.kosmosplus.com")!
check(close.map { Board.forMac($0, coordinator: coordinatorURL) }?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin",
      "Board.forMac marks it as the board's own (BoardClient applies it to every request, kosmos#7075), so the Mac's isViaScreen reads it as the person's")
check(Board.taskActRequest(mac: mac, project: "springcatalogue", number: 3, act: .reopen)?.url?.path == "/api/project/springcatalogue/task/3/reopen", "reopen")
check(Board.taskActRequest(mac: mac, project: "../x", number: 3, act: .close) == nil && Board.taskActRequest(mac: mac, project: "p", number: 0, act: .close) == nil,
      "not a project id or not a task number: no request")
let seen = Board.taskSeenRequest(mac: mac, project: "springcatalogue", number: 3)
check(seen?.url?.path == "/api/project/springcatalogue/task/3/seen" && seen?.httpMethod == "POST", "seen: a POST to the task's own route")
check(Board.taskActivityRequest(mac: mac, project: "springcatalogue", number: 3)?.url?.path == "/api/project/springcatalogue/task/3/activity", "the activity read")
check(Board.taskActResult(status: 200, body: Data(#"{"task":{}}"#.utf8)) == .done, "a 2xx is done")
check(Board.taskActResult(status: 409, body: Data(#"{"error":"the person set this task to repeat"}"#.utf8)) == .refused("the person set this task to repeat"), "a refusal: the Mac's words")
check(Board.taskActResult(status: 500, body: nil) == .refused("we could not change that task") && Board.taskActResult(status: 0, body: nil) == .refused("we could not change that task"),
      "no words, or no answer: the board's sentence")
check(Board.seenRetries(status: 503) && Board.seenRetries(status: 0) && !Board.seenRetries(status: 403) && !Board.seenRetries(status: 200), "seen tries once more only after a 5xx or no answer")

section("the activity, in the board's words")
func rows(_ n: Int) -> [String] {
    Board.parseActivity(fixture("activity-\(n).json")).map { Board.activityRows($0, name: names(page(n))).map(\.text) } ?? ["unparsed"]
}
check(rows(1) == ["Created"], "a task made with nobody on it")
check(rows(3) == ["Created and given to Dana, under task 1", "Dana marked it built: captions need a check", "Use the March photos"],
      "given to an agent under a parent, marked built, a message")
check(rows(5) == ["Created and given to Eli", "A part added: Check linen prices", "A part marked done", "Put on hold"], "parts and a hold")
check(rows(6) == ["Created", "Closed as replaced by task 7"], "replaced")
check(Board.activityPhrase(["kind": "closed", "via": "parent", "parent": 4], name: { $0 }) == "Marked done with task 4"
      && Board.activityPhrase(["kind": "closed"], name: { $0 }) == "Marked done",
      "kosmos#7514: a subtask closed with its parent names the parent, as engine/taskactphrase.js does; a plain close as before")
let runs: [[String: Any]] = [
    ["kind": "run", "at": "2026-10-20T10:00:00Z", "unchanged": true, "by": "dana"],
    ["kind": "run", "at": "2026-10-21T10:00:00Z", "unchanged": true, "inferred": true, "by": "dana"],
    ["kind": "run", "at": "2026-10-22T10:00:00Z", "unchanged": true, "late": true, "by": "dana"],
    ["kind": "reopened", "at": "2026-10-23T10:00:00Z", "person": true, "why": "not finished"],
]
let folded = Board.activityRows(runs, name: { $0 == "dana" ? "Dana" : $0 })
check(folded.map(\.text) == ["2 runs found nothing new or repeated the same note", "Dana ran it, late, nothing new", "You put it back: not finished"],
      "two quiet runs fold into one row; a late run never folds")
check(folded.first?.at == Tasks.parseISO("2026-10-21T10:00:00Z"), "a folded row is dated by its last run")
check(Board.activityPhrase(["kind": "something-new"], name: { $0 }) == "something-new", "an unknown kind shows its own name")
// kosmos#8679: edited (kosmos#8664) and check-reported read as the page reads them (engine/taskactphrase.test.js's fixtures).
let named: (String) -> String = { $0 == "mara" ? "Mara" : $0 == "leo" ? "Leo" : $0 }
check(Board.activityPhrase(["kind": "edited", "person": true, "fromTitle": "Fix login", "title": "Fix login on iPhone"], name: named) == "You changed the title from Fix login to Fix login on iPhone", "edited: the person's new title")
check(Board.activityPhrase(["kind": "edited", "by": "mara", "detail": "new words"], name: named) == "Mara changed the detail", "edited: an agent's new detail")
check(Board.activityPhrase(["kind": "edited", "by": "leo", "fromTitle": "a", "title": "b", "fromDetail": "x", "detailCleared": true], name: named) == "Leo changed the title from a to b and cleared the detail", "edited: both, the detail cleared")
check(Board.activityPhrase(["kind": "edited", "fromTitle": "a", "title": "b"], name: named) == "Changed the title from a to b", "edited: nobody named")
check(Board.activityPhrase(["kind": "edited"], name: named) == "Changed the task", "edited: no fields")
check(Board.activityPhrase(["kind": "check-reported", "by": "mara", "check": 2, "met": true, "how": "node --test, 40 of 40"], name: named) == "Mara says done-when check 2 is met: node --test, 40 of 40", "check-reported: met, with how")
check(Board.activityPhrase(["kind": "check-reported", "check": 1, "met": false], name: named) == "An agent says done-when check 1 is not met", "check-reported: unmet, nobody named")
check(Board.activityPhrase(["kind": "edited"], name: named) != "edited", "CONTROL: edited no longer shows its bare kind")
check(Board.activityPhrase(["kind": "run", "missedBefore": 1e300], name: { $0 }) == "Ran, after 1000000000 missed runs"
      && Board.activityPhrase(["kind": "undone", "files": 1e300], name: { $0 }) == "File changes undone (1000000000 files)",
      "a count far too large is clamped, never a crash")
let unnamed = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#, agents: #"[{"sessionName":"dana","name":""}]"#)
check(unnamed?.partLines(roster: ["dana": "Dana"]).first?.who == "Dana", "a member with no name of its own: the roster's name (tkMemberName)")
check(Board.activityPhrase(["kind": "kept-dropped", "to": "dana", "person": true], name: { _ in "Dana" })
      == "Your message to Dana was never sent: Kosmos kept it while Dana was out of usage and could not send it within a day", "a dropped message")
check(Board.activityPhrase(["kind": "missed", "count": 3, "told": "dana", "reached": false], name: { _ in "Dana" }) == "3 runs missed; Kosmos could not reach Dana",
      "missed runs, the reviewer not reached")
// kosmos#8581: a due run told to its holder, reached and not, as engine/taskactphrase.js words it.
check(Board.activityPhrase(["kind": "due-told", "told": "dana", "reached": true], name: { _ in "Dana" }) == "A run was due; Dana was told",
      "a due run, the holder told")
check(Board.activityPhrase(["kind": "due-told", "told": "dana", "reached": false], name: { _ in "Dana" }) == "A run was due; Kosmos could not reach Dana",
      "a due run, the holder not reached")

section("the page's model, against a fake Mac")
// kosmos#7751: on the main actor, as the model is. Unisolated, asyncSend ran on another thread (Swift 5 mode runs a
// nonisolated async method off the caller's actor), so a test's yield loop did not wait for it and the two raced on
// `held` and `asked`. ThreadSanitizer reported that race before this change.
@MainActor
final class FakeMac {
    var projects: (Int, Data)? = (200, projectsData)
    var activity: (Int, Data)? = (200, fixture("activity-3.json"))
    var actAnswers: [(Int, String)?] = []
    var seenAnswers: [(Int, String)?] = []
    var asked: [String] = []
    var epoch = 0
    var onSend: ((URLRequest) -> Void)?
    // When set, a request is held until release() (for reads that land out of order). Set it with holdTheNext().
    private(set) var holdNext = false
    private var held: CheckedContinuation<Void, Never>?
    var holding: Bool { held != nil }
    // Arms a hold only when none is armed or held, so the hold a test then waits for is the one it armed.
    func holdTheNext(line: Int = #line) {
        if holdNext || held != nil { endRun("a hold was armed while an earlier one was still armed or held", line: line) }
        holdNext = true
    }
    func release() { let h = held; held = nil; h?.resume() }
    // kosmos#8958 slice B3b: holds EVERY request while set, in the order sent, so two can be out at once and answered in
    // any order (release(at:)): a tick read started before a save, landing while the save's own read is still out.
    var queueing = false
    private var queued: [CheckedContinuation<Void, Never>] = []
    var queuedCount: Int { queued.count }
    func release(at i: Int) { queued.remove(at: i).resume() }
    func asyncSend(_ build: (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)? {
        let answer = send(build)
        if holdNext {
            holdNext = false
            // Never drop a held continuation: it would never resume.
            if held != nil { endRun("a second request was held while one already was") }
            await withCheckedContinuation { held = $0 }
        }
        if queueing { await withCheckedContinuation { queued.append($0) } }
        // As URLSession: a request whose task was cancelled gives no answer.
        return Task.isCancelled ? nil : answer
    }
    func send(_ build: (URL) -> URLRequest?) -> (Data, HTTPURLResponse)? {
        guard let r = build(URL(string: "https://studio.kosmosplus.com")!) else { return nil }
        asked.append((r.httpMethod ?? "GET") + " " + r.url!.path)
        onSend?(r)
        func answer(_ a: (Int, Data)?) -> (Data, HTTPURLResponse)? {
            a.map { ($0.1, HTTPURLResponse(url: r.url!, statusCode: $0.0, httpVersion: nil, headerFields: nil)!) }
        }
        let path = r.url!.path
        if path == "/api/projects" { return answer(projects) }
        if path.hasSuffix("/activity") { return answer(activity) }
        if path.hasSuffix("/seen") { return answer(seenAnswers.isEmpty ? (200, Data("{}".utf8)) : seenAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) }) }
        return answer(actAnswers.isEmpty ? (200, Data("{}".utf8)) : actAnswers.removeFirst().map { ($0.0, Data($0.1.utf8)) })
    }
}
// Ends the run as a FAIL with its verdict line. A precondition would not do: in this suite's -O build it traps with no
// message, which reads in the log as the bare crash kosmos#7751 was.
func endRun(_ why: String, line: Int = #line) -> Never {
    check(false, why, line: line)
    print("")
    print("VERDICT: FAIL \(failed) of \(passed + failed)")
    exit(1)
}
// Wait until a request, parse or build the test holds is held. Never carry on without it: a test that went on would
// release nothing and leave the hold armed for some later request.
@MainActor
func waitUntil(_ reached: () -> Bool, _ what: String, line: Int = #line) async {
    // Only for holds on the main actor: yields there do not wait for another thread (kosmos#7751), so a hold reached
    // off it could take longer than this bound and FAIL a correct test.
    for _ in 0..<100_000 { if reached() { return }; await Task.yield() }
    endRun("the test never reached its hold: \(what)", line: line)
}
@MainActor
func modelTests() async {
    let mac = FakeMac()
    var slept: [TimeInterval] = []
    var clock = Date(timeIntervalSince1970: 1_800_000_000)
    func model(_ n: Int) -> TaskPageModel {
        let m = TaskPageModel(project: "springcatalogue", number: n, send: { await mac.asyncSend($0) }, sleep: { slept.append($0) },
                              epoch: { mac.epoch }, now: { clock })
        m.onScreen = true
        m.touched()
        return m
    }
    let m = model(3)
    let nm = ["dana": "Dana"]
    await m.read()
    await m.readActivity(names: nm)
    check(m.page?.number == 3 && m.activity?.count == 3 && !m.gone && !m.readFailed, "a read fills the page and its activity")

    mac.asked = []
    mac.actAnswers = [(409, #"{"error":"the person set this task to repeat, or chose who reviews it, so only they can close it"}"#)]
    await m.press(.close, names: nm)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/close", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "Mark as done: the close, then the page and its activity read again")
    check(m.refusal == "the person set this task to repeat, or chose who reviews it, so only they can close it" && !m.pressing, "a refusal is said, and the button is back")
    // The task closed elsewhere meanwhile: the refusal about the close goes with the next read that shows it.
    let savedProjects = mac.projects
    mac.projects = (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","closedAt":"2026-10-25T02:00:00.000Z","progress":{"done":1,"total":1,"closed":true}}]}]}"#.utf8))
    await m.read()
    check(m.page?.act == .reopen && m.refusal == nil, "closed elsewhere after a refused close: the refusal goes, and the button says Reopen")
    mac.projects = savedProjects
    await m.read()

    mac.asked = []
    await m.press(.reopen, names: nm)
    check(mac.asked.isEmpty, "a press whose button no longer matches the task sends nothing (the page already shows what is true)")

    mac.asked = []
    var during: Bool?
    mac.onSend = { r in if r.url!.path.hasSuffix("/close") { during = m.pressing } }
    await m.press(.close, names: nm)
    mac.onSend = nil
    check(during == true && m.refusal == nil, "while it is in the air the button is off; a press that goes clears the last refusal")

    // Seen: once per state of the activity; a 5xx tried once more after 3 s, only while it is still on screen.
    mac.asked = []
    mac.seenAnswers = [(503, "{}"), (200, "{}")]
    await m.markSeen()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen", "POST /api/project/springcatalogue/task/3/seen"] && slept == [3],
          "a 503 is tried once more after 3 s, and the same state is not marked again")
    mac.asked = []
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:00:00Z","kind":"said","text":"new"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    m.onScreen = false
    await m.markSeen()
    check(mac.asked == ["GET /api/project/springcatalogue/task/3/activity"], "not on screen: not marked seen")
    mac.seenAnswers = [(403, #"{"error":"only the person's page can mark a task seen"}"#)]
    mac.asked = []
    m.onScreen = true
    m.touched()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"],
          "the state that landed while it was off screen is marked when the page is back; a 4xx settles it with no retry")

    // The person must be there (the board's tkPresent): no touch for two minutes, or the app in the background.
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:05:00Z","kind":"said","text":"newer"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    clock += TaskPageModel.presentFor + 1
    mac.asked = []
    await m.markSeen()
    check(mac.asked.isEmpty, "nobody has touched it for two minutes: not marked seen (a phone left open on a stand)")
    m.touched()
    await m.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a touch after being idle: the next mark records the state that arrived meanwhile")
    mac.asked = []
    clock += TaskPageModel.presentFor + 1
    m.assistive = true
    await m.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"],
          "with VoiceOver running the person counts as there without a touch; again records the same state once more (the board's tab return)")
    await m.markSeen()
    check(mac.asked.count == 1, "and without again the same state is not sent twice")
    m.assistive = false
    mac.asked = []
    m.touched()
    m.appActive = false
    await m.markSeen(again: true)
    check(mac.asked.isEmpty, "the app in the background: not marked seen")
    m.appActive = true
    // A state the Mac has never recorded, so only the skipped retry's handling can make the return send it.
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T01:10:00Z","kind":"said","text":"newest"}],"count":1}"#.utf8))
    await m.readActivity(names: nm)
    mac.asked = []
    mac.seenAnswers = [(502, "{}")]
    mac.onSend = { r in if r.url!.path.hasSuffix("/seen") { m.onScreen = false } }
    await m.markSeen()
    mac.onSend = nil
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a retry is not sent once the person has left the page")
    m.onScreen = true
    m.touched()
    mac.asked = []
    await m.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "and that state is sent again when they come back (left unmarked, not settled)")

    // A failed activity read keeps the rows shown.
    let shownRows = m.activity
    mac.activity = (500, Data())
    await m.readActivity(names: nm)
    check(m.activityFailed && m.activity == shownRows, "a failed activity read keeps what is shown")

    // The task gone, a failed read, another account.
    let g = model(99)
    await g.read()
    check(g.gone && g.page == nil, "a task the Mac no longer lists is gone")
    mac.projects = (502, Data())
    let f = model(3)
    await f.read()
    check(f.readFailed && f.page == nil, "a read with no list fails")
    mac.projects = (200, projectsData)
    let e = model(3)
    mac.onSend = { r in if r.url!.path == "/api/projects" { mac.epoch += 1 } }
    await e.read()
    mac.onSend = nil
    check(e.page == nil && !e.readFailed, "a read that lands after another account or Mac changes nothing")
    let ep = model(3)
    await ep.read()
    check(ep.page != nil, "premise: a page read under the account before")
    mac.epoch += 1
    mac.asked = []
    await ep.press(.close, names: nm)
    await ep.read()
    check(mac.asked.isEmpty, "a page from before another account or Mac sends nothing, though it has a task shown: no press, no read")

    // The 5-second tick: the task on every tick while on screen; its activity first, then only while the person is there.
    let t = model(3)
    check(t.shouldReadTask && t.shouldReadActivity(first: true) && t.shouldReadActivity(first: false), "present: every tick reads both")
    clock += TaskPageModel.presentFor + 1
    check(t.shouldReadTask && t.shouldReadActivity(first: true) && !t.shouldReadActivity(first: false),
          "idle: the task is still read (its state and button never go stale), its activity only the first time")
    t.appActive = false
    check(!t.shouldReadTask, "the app in the background: nothing is read")

    // Again re-records only a state the Mac recorded (tkTabReturn): a refused one is not sent again on every return.
    let rr = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await rr.readActivity(names: nm)
    mac.seenAnswers = [(403, "{}")]
    mac.asked = []
    await rr.markSeen(again: true)
    await rr.markSeen(again: true)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a state the Mac refused is not re-sent on a return")
    mac.asked = []
    let rec = model(3)
    await rec.readActivity(names: nm)
    await rec.markSeen()
    await rec.markSeen(again: true)
    check(mac.asked.filter { $0.hasSuffix("/seen") }.count == 2, "a recorded state is recorded again on a return")

    // A seen mark cut short (the loop restarted while it was on its way) is not a failure: the next mark sends it.
    let cm = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await cm.readActivity(names: nm)
    mac.asked = []
    mac.holdTheNext()
    let cut = Task { await cm.markSeen() }
    await waitUntil({ mac.holding }, "a request held")
    cut.cancel()
    mac.release()
    await cut.value
    check(mac.asked.first == "POST /api/project/springcatalogue/task/3/seen", "premise: the cut mark had started its POST")
    mac.asked = []
    await cm.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a cancelled seen mark leaves the state unmarked, so the next mark sends it")
    mac.holdTheNext()
    let cutRead = Task { await cm.read() }
    await waitUntil({ mac.holding }, "a request held")
    cutRead.cancel()
    mac.release()
    await cutRead.value
    check(!cm.readFailed, "a read cut short records no failure")

    // A parse held while a newer read lands: the newer answer stands, and so does a newer failure.
    @MainActor final class ParseGate {
        private(set) var hold = false
        private var held: CheckedContinuation<Void, Never>?
        var waiting: Bool { held != nil }
        func release() { let h = held; held = nil; h?.resume() }
        // As FakeMac's: a second hold would drop the first one's continuation, so the run ends instead.
        func arm(line: Int = #line) {
            if hold || held != nil { endRun("a parse or build hold was armed while an earlier one was still armed or held", line: line) }
            hold = true
        }
        func park(line: Int = #line) async {
            guard hold else { return }
            hold = false
            if held != nil { endRun("a second parse or build was held while one already was", line: line) }
            await withCheckedContinuation { held = $0 }
        }
    }
    for newerFails in [false, true] {
        let gate = ParseGate()
        let pm = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                               now: { clock }, parse: { data, project, number in
                                   await gate.park()
                                   return Board.parseTaskPage(data, project: project, number: number)
                               })
        mac.projects = (200, projectsData)
        gate.arm()
        let older = Task { await pm.read() }
        await waitUntil({ gate.waiting }, "a parse held")
        mac.projects = newerFails ? (502, Data()) : (200, Data(#"{"projects":[]}"#.utf8))
        await pm.read()
        gate.release()
        await older.value
        check(pm.page == nil && (newerFails ? pm.readFailed : pm.gone),
              newerFails ? "a newer read's failure stands over an older parse finishing after it" : "a newer answer stands over an older parse finishing after it")
    }
    mac.projects = (200, projectsData)

    // A retry cut short is not attempted either: the state stays unmarked.
    let rc = model(3)
    mac.activity = (200, Data(#"{"events":[{"at":"2026-10-25T03:00:00Z","kind":"said","text":"retry-cut"}],"count":1}"#.utf8))
    await rc.readActivity(names: nm)
    mac.asked = []
    mac.seenAnswers = [(503, "{}")]
    var retryTask: Task<Void, Never>?
    mac.onSend = { r in if r.url!.path.hasSuffix("/seen") && mac.asked.count == 2 { mac.holdTheNext() } }
    retryTask = Task { await rc.markSeen() }
    await waitUntil({ mac.holding }, "a request held")
    check(mac.asked.count == 2, "premise: the retry is in the air")
    retryTask?.cancel()
    mac.release()
    await retryTask?.value
    mac.onSend = nil
    mac.asked = []
    await rc.markSeen()
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/seen"], "a cancelled retry leaves the state unmarked, so the next mark sends it")

    // An activity build held while a newer read lands: the newer rows stand, and so does a newer failure.
    for newerFails in [false, true] {
        let gate = ParseGate()
        let am = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                               now: { clock }, buildRows: { names, data in
                                   await gate.park()
                                   return await TaskPageModel.buildOffMain(names, data)
                               })
        mac.activity = (200, fixture("activity-3.json"))
        gate.arm()
        let olderBuild = Task { await am.readActivity(names: nm) }
        await waitUntil({ gate.waiting }, "a build held")
        mac.activity = newerFails ? (502, Data()) : (200, Data(#"{"events":[],"count":0}"#.utf8))
        let newerShown = await am.readActivity(names: nm)
        gate.release()
        let olderShown = await olderBuild.value
        check(!olderShown && (newerFails ? (!newerShown && am.activityFailed && am.activity == nil) : (newerShown && am.activity == [])),
              newerFails ? "a newer activity failure stands over an older build finishing after it" : "newer activity rows stand over an older build finishing after it")
    }
    mac.activity = (200, fixture("activity-3.json"))

    // readActivity says whether its state is the one drawn, so a return marks only what was just read.
    let ra = model(3)
    let drew = await ra.readActivity(names: nm)
    check(drew, "a read that draws its state says so")
    mac.activity = (500, Data())
    let failedReturn = await ra.readActivity(names: nm)
    check(!failedReturn, "a failed read says it drew nothing (the view then sends no seen mark for the old state)")
    mac.activity = (200, fixture("activity-3.json"))

    // A tick that changes nothing publishes nothing (the page and its history are not redrawn).
    let quiet = model(3)
    await quiet.read()
    await quiet.readActivity(names: nm)
    var published = 0
    let sub = quiet.objectWillChange.sink { _ in published += 1 }
    await quiet.read()
    await quiet.readActivity(names: nm)
    sub.cancel()
    check(published == 0, "an unchanged read and activity read publish nothing (\(published))")

    // The tick (TaskPageView's loop body): a return marks only after its own read draws.
    let tk = model(3)
    mac.activity = (200, fixture("activity-3.json"))
    await tk.tick(first: true, returning: true, names: nm)
    mac.asked = []
    await tk.tick(first: true, returning: true, names: nm)
    check(mac.asked == ["GET /api/projects", "GET /api/project/springcatalogue/task/3/activity", "POST /api/project/springcatalogue/task/3/seen"],
          "a return reads the task and its activity, then records the state it drew once more")
    mac.activity = (500, Data())
    mac.asked = []
    await tk.tick(first: true, returning: true, names: nm)
    check(!mac.asked.contains { $0.hasSuffix("/seen") }, "a return whose activity read fails sends no seen mark (nothing new was drawn)")
    mac.activity = (200, fixture("activity-3.json"))
    clock += TaskPageModel.presentFor + 1
    mac.asked = []
    await tk.tick(first: false, returning: false, names: nm)
    check(mac.asked == ["GET /api/projects"], "an idle tick reads the task only")

    // The same answer and names again: the rows are not rebuilt.
    var builds = 0
    let bm = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch },
                           now: { clock }, buildRows: { names, data in builds += 1; return await TaskPageModel.buildOffMain(names, data) })
    let b1 = await bm.readActivity(names: nm)
    let b2 = await bm.readActivity(names: nm)
    check(b1 && b2 && builds == 1, "an unchanged answer is not rebuilt, and still counts as drawn (\(builds) builds)")
    _ = await bm.readActivity(names: ["dana": "Dana R."])
    check(builds == 2 && bm.activity?.first?.text == "Created and given to Dana R., under task 1", "new names rebuild the rows")
    // Once the task has been read, the project's own member names win over the roster's (tkMemberName).
    let mn = model(3)
    await mn.read()
    _ = await mn.readActivity(names: ["dana": "Dana (roster)"])
    check(mn.activity?.first?.text == "Created and given to Dana, under task 1", "the project's member name is used over the roster's")

    // A return that cannot mark leaves the recorded state recorded.
    let rs = model(3)
    await rs.readActivity(names: nm)
    await rs.markSeen()
    rs.appActive = false
    await rs.markSeen(again: true)
    rs.appActive = true
    mac.asked = []
    await rs.markSeen()
    check(mac.asked.isEmpty, "a blocked return does not make the next ordinary mark re-send a recorded state")

    // Reads that land out of order: the newer answer stands.
    mac.epoch = 0
    let o = model(3)
    mac.holdTheNext()
    let first = Task { await o.read() }
    await waitUntil({ mac.holding }, "a request held")
    mac.projects = (200, Data(#"{"projects":[]}"#.utf8))
    await o.read()
    check(o.gone, "premise: the newer read says the task is gone")
    mac.release()
    await first.value
    check(o.gone && o.page == nil, "the older read, landing after it, does not bring the task back")
    mac.projects = (200, projectsData)
    mac.activity = (200, fixture("activity-3.json"))
    mac.holdTheNext()
    let firstActivity = Task { await o.readActivity(names: nm) }
    await waitUntil({ mac.holding }, "a request held")
    mac.activity = (200, Data(#"{"events":[],"count":0}"#.utf8))
    await o.readActivity(names: nm)
    mac.release()
    await firstActivity.value
    check(o.activity == [], "an older activity read landing after a newer one does not replace it")
}
section("#8137: the task page says who is still to finish")
let whoJSON = #"{"projects":[{"id":"p1","name":"Launch","tasks":[{"number":7,"sentence":"Two agents","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"},{"id":2,"who":"gus"}],"whoIsLeft":{"finished":["dana"],"left":["gus"]}},{"number":8,"sentence":"One agent","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#
func whoPage(_ n: Int) -> Board.TaskPage? {
    if case .page(let p) = Board.parseTaskPage(Data(whoJSON.utf8), project: "p1", number: n) { return p }
    return nil
}
check(whoPage(7)?.whoLeftLine(roster: roster) == "Reported finished: Dana (roster). Still to finish: Gus.", "names from the roster, as the part lines have them")
check(whoPage(7) != nil && whoPage(8) != nil, "premise: both pages parsed")
check(whoPage(8)?.whoLeftLine(roster: roster) == nil, "control: one agent, no line")

await modelTests()

section("#8958 slice B1: a message on the task, the due date, and the words")
let macURL = URL(string: "https://studio.kosmosplus.com")!
func bodyOf(_ r: URLRequest?) -> [String: Any]? { r?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
let say = Board.taskMessageRequest(mac: macURL, project: "springcatalogue", number: 4, text: "  Use the March photos.\n")
check(say?.httpMethod == "POST" && say?.url?.path == "/api/project/springcatalogue/task/4/message"
      && bodyOf(say)?["text"] as? String == "Use the March photos.", "a message posts its trimmed words to the task's message route")
check(Board.taskMessageRequest(mac: macURL, project: "springcatalogue", number: 4, text: " \n ") == nil, "an empty box sends nothing")
let due = Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "2026-11-30")
check(due?.url?.path == "/api/project/springcatalogue/task/4/due" && bodyOf(due)?["dueDate"] as? String == "2026-11-30", "a due date posts the calendar date")
let clear = Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: nil)
check(bodyOf(clear)?["dueDate"] is NSNull, "clearing the due date sends null")
check(Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "2026-02-30") == nil
      && Board.taskDueRequest(mac: macURL, project: "springcatalogue", number: 4, due: "30/11/2026") == nil, "no request for a date that is not a real calendar date")
var central = Calendar(identifier: .gregorian); central.timeZone = TimeZone(identifier: "America/Chicago")!
check(Board.dueDay("2026-11-30", calendar: central).map { Board.dueString($0, calendar: central) } == "2026-11-30", "a due date reads and writes back as the same day")
check(Board.keptDraft("2026-10-30", stored: "2026-10-30") == nil && Board.keptDraft("2026-11-02", stored: "2026-10-30") == "2026-11-02"
      && Board.keptDraft("2026-02-30", stored: nil) == nil && Board.keptDraft(nil, stored: "2026-10-30") == nil,
      "a draft is kept only while it is a real day that differs from the stored one")
check(Board.dueControls(stored: "2026-10-30", draft: "2026-10-30") == .stored("2026-10-30"), "a draft back on the stored day: just the stored date (Clear)")
check(Board.dueControls(stored: "2026-10-30", draft: "2026-11-02") == .choosing("2026-11-02"), "a different day being chosen: Set and Cancel")
check(Board.dueControls(stored: nil, draft: "2026-12-01") == .choosing("2026-12-01"), "no stored date, a day being chosen: Set and Cancel")
check(Board.dueControls(stored: nil, draft: nil) == .none, "no date at all: Set a due date")
check(Board.dueControls(stored: "soon", draft: nil) == .unreadable("soon"), "a stored date that is not a day: said as kept")
check(Board.keptDraft("2026-11-02", stored: "2026-11-02") == nil, "the stored day moving to the draft's day drops the draft")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "", openedTitle: "Pages 1 to 8", openedDetail: nil) == .nothing, "nothing changed: nothing is sent")
check(Board.taskEdit(title: "  ", detail: "x", openedTitle: "Pages 1 to 8", openedDetail: nil) == .needsTitle, "an empty title is refused before sending")
check(Board.taskEdit(title: " Pages 1 to 9 ", detail: "keep", openedTitle: "Pages 1 to 8", openedDetail: "keep") == .send(["sentence": "Pages 1 to 9"]),
      "only the title, when only it changed (trimmed)")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "  ", openedTitle: "Pages 1 to 8", openedDetail: "old words") == .send(["detail": String?.none]),
      "an emptied detail is sent as cleared")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "a\nb", openedTitle: "Pages 1 to 8", openedDetail: "a\r\nb") == .nothing,
      "line ends compared as the board's textarea gives them back")
check(bodyOf(Board.taskTextRequest(mac: macURL, project: "springcatalogue", number: 4, body: Board.taskTextBody(["detail": String?.none])))?["detail"] is NSNull,
      "the cleared detail goes on the wire as null")
check(Board.taskTextRequest(mac: macURL, project: "springcatalogue", number: 4, body: [:]) == nil, "no request with nothing to say")
check(Board.taskWriteResult(status: 200, body: nil, failed: "f", unreached: "u") == .done, "a 2xx is done")
check(Board.taskWriteResult(status: 400, body: Data(#"{"error":"that is not a real date"}"#.utf8), failed: "f", unreached: "u") == .refused("that is not a real date"),
      "a refusal is the Mac's own words")
check(Board.taskWriteResult(status: 500, body: nil, failed: "f", unreached: "u") == .refused("f")
      && Board.taskWriteResult(status: 0, body: nil, failed: "f", unreached: "u") == .refused("u"), "else the board's words, and its could-not-reach words with no answer")
func said(_ json: String) -> String? { Board.taskSaidLine(Data(json.utf8), name: { ["dana": "Dana", "eli": "Eli"][$0] ?? $0 }) }
check(said(#"{"delivered":[{"agent":"dana","state":"placed"}]}"#) == nil, "every assignee reached: no line")
check(said(#"{"delivered":[]}"#) == "No agent is assigned to this task, so nobody was told.", "nobody assigned is said")
check(said(#"{"ok":true}"#) == nil, "CONTROL: no list, no line")
check(said(#"{"delivered":[{"agent":"dana","state":"could_not","because":"dana is switched off in this project"}]}"#)
      == "Dana is switched off in this project, so it was not told. Switch it on in the project's members to send it work here. Your message stays on the task.",
      "switched off, by its card name, and the message stays")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldFor":"signin"}]}"#)
      == "Eli is signed out. Kosmos will try to send your message to Eli once it is signed in again.", "signed out")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldUntil":"2999-01-01T00:00:00Z"}]}"#)
      == "Eli is out of usage. Kosmos will try to send your message to Eli once its usage resets.", "out of usage, without the board's time")
check(said(#"{"delivered":[{"agent":"dana","state":"placed"},{"agent":"dana","state":"could_not","because":"x"}]}"#)
      == "Kosmos could not reach Dana, so it was not told. Your message stays on the task.", "listed twice: its worst outcome")
check(said(#"{"delivered":[{"agent":"eli","state":"unconfirmed"}]}"#) == "Kosmos could not confirm that Eli got it.", "anything else: not confirmed")
check(said(#"{"delivered":[{"agent":"eli","state":"could_not","because":"eli is not on this project any more"}]}"#)
      == "Eli is not on this project any more, so it was not told. Your message stays on the task.", "not on the project any more")
check(said(#"{"delivered":[{"agent":"eli","state":"could_not","because":"Kosmos could not keep this one"}]}"#)
      == "Kosmos could not keep your message for Eli, so it was not told. Your message stays on the task.", "could not keep it")
check(said(#"{"delivered":[{"agent":"eli","state":"held","because":"it still has messages kept"}]}"#)
      == "Kosmos will try to send your message to Eli after the ones already waiting for it.", "behind messages already kept")
check(said(#"{"delivered":[{"agent":"eli","state":"held"}]}"#) == "Kosmos is keeping your message and will try to send it to Eli later.",
      "held with no time known")
check(said(#"{"delivered":[{"agent":"eli","state":"held","heldUntil":"2000-01-01T00:00:00Z"}]}"#)
      == "Kosmos is keeping your message and will try to send it to Eli later.", "a reset time already past is not called out of usage")
check(said(#"{"delivered":[{"agent":null,"state":"could_not","because":"x"}]}"#)
      == "Kosmos could not reach an agent, so it was not told. Your message stays on the task.", "an agent with no name")
check(said(#"{"delivered":[{"agent":"","state":"held","heldFor":"signin"}]}"#)
      == "An agent is signed out. Kosmos will try to send your message to an agent once it is signed in again.", "a sentence opening with no name")
check(said(#"{"delivered":[null]}"#) == nil, "a list with no usable entry: no line, as the board (its list was not empty)")
check(Board.capped(String(repeating: "\u{1F600}", count: 3), 4).utf16.count == 4 && Board.capped("abc", 4) == "abc",
      "the caps count UTF-16 units, as the board's maxlength")
check(Board.boardLineEnds("a\rb\r\nc") == "a\nb\nc", "a lone CR and a CRLF are both line ends, as the board's form")
check(Board.taskEdit(title: "Pages 1\nto 9", detail: "", openedTitle: "Pages 1 to 8", openedDetail: nil) == .send(["sentence": "Pages 1 to 9"]),
      "a line break in a title is a space (one line, as the board's text input)")
check(Board.taskEdit(title: "Pages 1 to 8", detail: "", openedTitle: "Pages 1\nto 8", openedDetail: nil) == .nothing,
      "a stored title with a line break is not sent back by a Save that changed nothing")

await b1ModelTests()

section("#8958 slice B2: Put on hold and Take off hold")
// Declared before the B2 tests run: a main.swift global below its first use is still empty there.
// The unhold route's answer: the task as it now is (open, Dana on it), and who has it next.
let unheldAnswer = #"{"task":{"number":3,"sentence":"Pages 9 to 12","parts":[{"id":1,"who":"dana"}]},"next":"It stays with Dana."}"#
let heldTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","onHold":true,"createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#.utf8)
let noTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[]}]}"#.utf8)
let closedTask3 = Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","closedAt":"2026-10-25T12:00:00.000Z","createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana","closedAt":"2026-10-25T12:00:00.000Z"}],"progress":{"done":1,"total":1,"closed":true}}]}]}"#.utf8)
let hold = Board.taskHoldRequest(mac: macURL, project: "springcatalogue", number: 4, onHold: true)
check(hold?.httpMethod == "POST" && hold?.url?.path == "/api/project/springcatalogue/task/4/hold" && bodyOf(hold)?["onHold"] as? Bool == true,
      "Put on hold posts onHold true to the task's hold route")
check(bodyOf(Board.taskHoldRequest(mac: macURL, project: "springcatalogue", number: 4, onHold: false))?["onHold"] as? Bool == false, "Take off hold posts false")
check(Board.holdTitle(onHold: false) == "Put on hold" && Board.holdTitle(onHold: true) == "Take off hold", "the board's two words")
check(Board.holdNextLine(Data(#"{"task":{},"next":"It stays with Dana."}"#.utf8)) == "It stays with Dana.", "an unhold's next sentence is said")
check(Board.holdNextLine(Data(#"{"next":"Nobody is on it, and the Assigner is off, so it waits for a person. To choose who, assign it now."}"#.utf8))
      == "Nobody is on it, and the Assigner is off, so it waits for a person. To choose who, open this task on your computer's board.",
      "the board's assign ask is cut (no picker here yet) and the person told where choosing happens")
let looseBeside = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"},{"id":2,"sentence":"T"}]}"#)
let allOn = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#)
check(Board.holdNextLine(Data(#"{"next":"It stays with Dana."}"#.utf8), page: looseBeside) == "It stays with Dana. To choose who, open this task on your computer's board.",
      "a free part beside one somebody is on (the board's looseBesideHeld): where to choose is said too")
check(Board.holdNextLine(Data(#"{"next":"It stays with Dana."}"#.utf8), page: allOn) == "It stays with Dana.", "CONTROL: every open part has somebody: nothing added")
if let a = allOn, let held = synthetic(#"{"number":1,"sentence":"S","onHold":true,"parts":[{"id":1,"who":"dana","sentence":"S"}]}"#),
   let paused = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#, paused: true),
   let other = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"eli","sentence":"S"}]}"#) {
    let nameless = synthetic(#"{"number":1,"sentence":"S","parts":[{"id":1,"who":"dana","sentence":"S"}]}"#,
                             agents: #"[{"sessionName":"dana","name":"Dana"},{"sessionName":"eli"}]"#)
    check(nameless.map { Board.holdNextSig($0) != Board.holdNextSig(a) } == true,
          "a member with no name of its own joining changes the signature (the board's every sessionName)")
    check(Board.holdNextSig(held) != Board.holdNextSig(a) && Board.holdNextSig(paused) != Board.holdNextSig(a) && Board.holdNextSig(other) != Board.holdNextSig(a),
          "the signature changes when the task is held again, the project paused, or someone else is on it")
} else { check(false, "the signature fixtures parse") }
check(Board.holdNextLine(Data(#"{"task":{}}"#.utf8)) == nil, "a hold answers with no next: nothing said")

await b2ModelTests()

@MainActor
func b2ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    check(m.page?.onHold == false && m.page?.closed == false, "premise: task 3 is open and not on hold")
    mac.asked = []
    await m.toggleHold(wasOnHold: false, names: nm)
    check(mac.asked == ["GET /api/projects", "POST /api/project/springcatalogue/task/3/hold", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "Put on hold reads the task first, then posts, then reads the page and activity again")
    check(!m.holding && m.holdSay == nil && !m.holdRefused, "a hold has no next line")
    // Already on hold elsewhere: the first read shows it, nothing is posted.
    let saved = mac.projects
    mac.projects = (200, Data(#"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","tasks":[{"number":3,"sentence":"Pages 9 to 12","onHold":true,"createdAt":"2026-10-24T12:00:00.000Z","parts":[{"id":1,"who":"dana"}]}]}]}"#.utf8))
    mac.asked = []
    await m.toggleHold(wasOnHold: false, names: nm)
    check(!mac.asked.contains { $0.hasSuffix("/hold") } && m.holdSay == Board.holdAlready, "already on hold: nothing sent, and said so")
    // Take off hold: posted at once, and the next sentence said.
    mac.asked = []
    mac.actAnswers = [(200, unheldAnswer)]
    mac.projects = saved   // the Mac takes it off: the read after the post shows it open
    await m.toggleHold(wasOnHold: true, names: nm)
    check(mac.asked.first == "POST /api/project/springcatalogue/task/3/hold" && m.holdSay == "It stays with Dana.", "Take off hold posts at once and says who has it next")
    await m.read()
    mac.actAnswers = [(409, #"{"error":"a finished task cannot be put on hold"}"#)]
    await m.toggleHold(wasOnHold: false, names: nm)
    check(m.holdSay == "a finished task cannot be put on hold" && !m.holding && m.holdRefused, "a refusal is the Mac's words, drawn as a refusal")
    mac.asked = []
    await m.toggleHold(wasOnHold: true, names: nm)
    check(mac.asked.isEmpty, "a press whose button no longer matches the task sends nothing")
    await b2ReviewTests()
}


// kosmos#8958 slice B2 review 1: the guards no check above could tell from their absence.
@MainActor
func b2ReviewTests() async {
    let nm = ["dana": "Dana"]
    func fresh(_ mac: FakeMac, parse: TaskPageModel.Parse? = nil) async -> TaskPageModel {
        let m = parse.map { TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch }, parse: $0) }
            ?? TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
        m.onScreen = true
        await m.read()
        return m
    }
    let posted: (FakeMac) -> Bool = { $0.asked.contains { $0.hasSuffix("/hold") } }

    // The check is its own read: the tick's read overtaking it cannot leave the check on the task as it was (WARNING 1).
    do {
        final class Gate { var armed = false; var held: CheckedContinuation<Void, Never>? }
        let gate = Gate()
        let mac = FakeMac()
        let m = await fresh(mac, parse: { data, project, number in
            if gate.armed { gate.armed = false; await withCheckedContinuation { gate.held = $0 } }
            return Board.parseTaskPage(data, project: project, number: number)
        })
        check(m.page?.onHold == false, "premise: shown as not on hold")
        mac.projects = (200, heldTask3)   // an agent has just put it on hold
        mac.asked = []
        mac.holdTheNext()
        let pressing = Task { await m.toggleHold(wasOnHold: false, names: nm) }
        await waitUntil({ mac.holding }, "the press's check held on the wire")
        gate.armed = true
        let tick = Task { await m.read() }
        await waitUntil({ gate.held != nil }, "the tick's read held in its parse")
        mac.release()
        await pressing.value
        check(!posted(mac) && m.holdSay == Board.holdAlready, "a tick read overtaking the press's check: the agent's hold is seen, nothing is posted")
        gate.held?.resume(); gate.held = nil
        await tick.value
    }
    // Two presses at once: the second sends nothing.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.holdTheNext()
        let first = Task { await m.toggleHold(wasOnHold: false, names: nm) }
        await waitUntil({ mac.holding }, "the first press's check held")
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked == ["GET /api/projects"], "a second press while one is out sends nothing")
        // Mark as done waits for the hold too (WARNING 3).
        guard let act = m.page?.act else { check(false, "premise: a task to act on"); mac.release(); await first.value; return }
        await m.press(act, names: nm)
        check(mac.asked == ["GET /api/projects"], "Mark as done while a hold is out sends nothing")
        mac.release()
        await first.value
        check(mac.asked.filter { $0.hasSuffix("/hold") }.count == 1, "the first press still posts its one hold")
    }
    // A closed task: no hold is sent.
    do {
        let mac = FakeMac(); mac.projects = (200, closedTask3); let m = await fresh(mac)
        check(m.page?.closed == true, "premise: task 3 reads closed")
        mac.asked = []
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked.isEmpty && m.holdSay == nil, "a closed task: nothing sent")
    }
    // Gone by the check, and a check that could not read: nothing posted, and the board's words.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.projects = (200, noTask3); mac.asked = []
        await m.toggleHold(wasOnHold: false, names: nm)
        check(!posted(mac) && m.holdSay == Board.holdTaskGone && m.gone, "gone by the check: nothing posted, said so, and the page knows")
        let mac2 = FakeMac(); let m2 = await fresh(mac2)
        mac2.projects = (500, Data("{}".utf8)); mac2.asked = []
        await m2.toggleHold(wasOnHold: false, names: nm)
        check(!posted(mac2) && m2.holdSay == Board.holdCheckFailed && !m2.holding, "a check that could not read: nothing posted, said so")
        mac2.projects = nil
        await m2.toggleHold(wasOnHold: false, names: nm)
        check(m2.holdSay == Board.holdCheckFailed, "no answer at all: the same")
    }
    // Signed out while the hold is in the air: nothing more is read or said.
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.onSend = { r in if r.url!.path.hasSuffix("/hold") { mac.epoch += 1 } }
        mac.actAnswers = [(200, unheldAnswer)]
        mac.projects = (200, heldTask3)
        await m.read()   // the page shows it held, so Take off hold
        mac.asked = []
        await m.toggleHold(wasOnHold: true, names: nm)
        check(mac.asked == ["POST /api/project/springcatalogue/task/3/hold"] && m.holdSay == nil, "signed out mid-press: no read after, nothing said")
    }
    // The next line goes when the task no longer reads as it did (WARNING 2), and stays while it does.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana.", "premise: the next line is said")
        await m.read()
        check(m.holdSay == "It stays with Dana.", "CONTROL: a tick that reads the same keeps the line")
        mac.projects = (200, heldTask3)   // an agent holds it again
        await m.read()
        check(m.holdSay == nil, "held again elsewhere: the stale next line goes")
    }
    // The line is about the task in the answer (review 2): said only while the page shows that task as it was.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, #"{"task":{"number":3,"sentence":"Pages 9 to 12","parts":[{"id":1,"who":null}]},"next":"Kosmos hands it to the next free agent."}"#)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == nil && !m.holding, "a hand-out landing before the read (the page shows Dana, the answer nobody): nothing said")
        let mac2 = FakeMac(); mac2.projects = (200, heldTask3); let m2 = await fresh(mac2)
        mac2.actAnswers = [(200, unheldAnswer)]
        mac2.onSend = { r in if r.url!.path.hasSuffix("/hold") { mac2.projects = (500, Data("{}".utf8)) } }
        await m2.toggleHold(wasOnHold: true, names: nm)
        check(m2.holdSay == nil && m2.page?.onHold == true, "the read after the post failed (the page still shows it held): nothing said")
        let mac3 = FakeMac(); mac3.projects = (200, heldTask3); let m3 = await fresh(mac3)
        mac3.projects = (200, projectsData)
        mac3.actAnswers = [(200, #"{"next":"It stays with Dana."}"#)]
        await m3.toggleHold(wasOnHold: true, names: nm)
        check(m3.holdSay == nil, "an answer with no task: nothing said, as the board's")
        // CONTROL for all three: the same press with the answer's task matching the page is said.
        let mac4 = FakeMac(); mac4.projects = (200, heldTask3); let m4 = await fresh(mac4)
        mac4.projects = (200, projectsData)
        mac4.actAnswers = [(200, unheldAnswer)]
        await m4.toggleHold(wasOnHold: true, names: nm)
        check(m4.holdSay == "It stays with Dana." && !m4.holdRefused, "CONTROL: the answer's task as the page shows it: said")
    }
    // The line goes when the task does.
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana.", "premise: said")
        mac.projects = (200, noTask3)
        await m.read()
        check(m.holdSay == nil && m.gone, "the task gone: the line goes with it")
    }
    // Each press starts clean (review 3): a refusal's colour does not carry to the next line, and a next line's
    // signature does not carry to a refusal (which a later tick would then wipe).
    do {
        let mac = FakeMac(); mac.projects = (200, heldTask3); let m = await fresh(mac)
        mac.actAnswers = [(409, #"{"error":"not now"}"#)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdRefused && m.holdSay == "not now", "premise: a refusal")
        mac.projects = (200, projectsData)
        mac.actAnswers = [(200, unheldAnswer)]
        await m.toggleHold(wasOnHold: true, names: nm)
        check(m.holdSay == "It stays with Dana." && !m.holdRefused, "the next press's line is not drawn as a refusal")
        // Now a next line's signature is recorded; a refusal follows, then the task changes elsewhere.
        mac.actAnswers = [(409, #"{"error":"a finished task cannot be put on hold"}"#)]
        await m.toggleHold(wasOnHold: false, names: nm)
        check(m.holdSay == "a finished task cannot be put on hold", "premise: the refusal replaced the next line")
        mac.projects = (200, heldTask3)
        await m.read()
        check(m.holdSay == "a finished task cannot be put on hold", "a tick after a refusal keeps the refusal (the old line's signature went with it)")
    }
    check(Board.holdNextLine(Data(#"{"next":" To choose who, assign it now."}"#.utf8)) == nil, "a next that is only the assign ask: nothing said")
    // A hold pressed while Mark as done is out sends nothing (review 2: the other direction).
    do {
        let mac = FakeMac(); let m = await fresh(mac)
        mac.asked = []
        mac.holdTheNext()
        guard let act = m.page?.act else { check(false, "premise: a task to act on"); return }
        let pressing = Task { await m.press(act, names: nm) }
        await waitUntil({ mac.holding }, "Mark as done held on the wire")
        let before = mac.asked
        await m.toggleHold(wasOnHold: false, names: nm)
        check(mac.asked == before, "Put on hold while Mark as done is out sends nothing")
        mac.release()
        await pressing.value
    }
}

@MainActor
func b1ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    mac.asked = []
    mac.actAnswers = [(200, #"{"ok":true,"delivered":[{"agent":"dana","state":"could_not","because":"input box already holds text"}]}"#)]
    let recorded = await m.say("Check the captions", name: { nm[$0] ?? $0 }, names: nm)
    check(recorded && mac.asked == ["POST /api/project/springcatalogue/task/3/message", "GET /api/project/springcatalogue/task/3/activity"],
          "a message is posted, then the activity read again (where it now shows)")
    check(m.sayLine == "Dana's input box held text that had not been sent, so it was not told. Your message stays on the task." && !m.sayRefused && !m.saying,
          "the line says who it did not reach")
    mac.asked = []
    mac.actAnswers = [(400, #"{"error":"keep the message to 2000 characters or fewer"}"#)]
    let refused = await m.say("x", name: { $0 }, names: nm)
    check(!refused && m.sayRefused && m.sayLine == "keep the message to 2000 characters or fewer" && mac.asked.count == 1,
          "a refusal keeps the box (false), says the Mac's words, and reads nothing more")
    mac.asked = []
    let empty = await m.say("   ", name: { $0 }, names: nm)
    check(!empty && mac.asked.isEmpty, "an empty box sends nothing")

    mac.asked = []
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    await m.setDue("2026-11-30", names: nm)
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/due", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"]
          && m.dueRefusal == nil && !m.dueSaving, "a due date is saved, then the task and its activity read again")
    mac.actAnswers = [(400, #"{"error":"that is not a real date"}"#)]
    await m.setDue("2026-11-29", names: nm)
    check(m.dueRefusal == "that is not a real date", "a refused date is said")
    mac.actAnswers = [nil]
    let unanswered = await m.setDue("2026-11-28", names: nm)
    check(!unanswered && m.dueRefusal == Board.taskDueUnreached, "no answer: the could-not-reach words, and not recorded")
    mac.asked = []
    let badDay = await m.setDue("2026-02-30", names: nm)
    check(!badDay && m.dueRefusal == Board.taskDueFailed && mac.asked.isEmpty, "a date that is not a day is refused here, never sent")

    mac.asked = []
    let nothing = await m.saveText(title: "Pages 9 to 12", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(nothing && mac.asked.isEmpty, "Save with nothing changed closes the form and sends nothing")
    let untitled = await m.saveText(title: " ", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(!untitled && m.editRefusal == Board.taskEditNeedsTitle && mac.asked.isEmpty, "no title: said, nothing sent")
    var sent: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/text") { sent = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{},"changed":true}"#)]
    var lockedThroughRead: Bool?
    let earlier = mac.onSend
    mac.onSend = { r in earlier?(r); if r.url!.path == "/api/projects" { lockedThroughRead = m.editSaving } }
    let saved = await m.saveText(title: "Pages 9 to 13", detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(saved && m.editRefusal == nil && sent?["sentence"] as? String == "Pages 9 to 13" && sent?["detail"] == nil,
          "a changed title is saved alone, and the form closes")
    check(lockedThroughRead == true && !m.editSaving, "the form stays locked through the page's re-read, then unlocks")
    mac.onSend = nil
    mac.actAnswers = [(400, #"{"error":"say what needs doing in 200 characters or fewer; the detail has the room"}"#)]
    let long = await m.saveText(title: String(repeating: "a", count: 201), detail: "", openedTitle: "Pages 9 to 12", openedDetail: nil, names: nm)
    check(!long && m.editRefusal == "say what needs doing in 200 characters or fewer; the detail has the room", "a refused save keeps the form open with the Mac's words")
}

section("slice B3: how often it repeats (kosmos#8958)")
do {
    typealias C = Board.RepeatChoice
    check(Board.repeatStored(nil) == C(every: .never) && Board.repeatStored(NSNull()) == C(every: .never), "no rule: Never")
    check(Board.repeatStored(["every": "hour", "minute": 20]) == C(every: .hour), "an hourly rule an agent set at :20 shows as Every hour")
    check(Board.repeatStored(["every": "minutes", "n": 45]) == C(every: .minutes, minutes: "45"), "every 45 minutes fills the minutes box")
    check(Board.repeatStored(["every": "day", "at": "07:30"]) == C(every: .day, at: "07:30"), "a daily time fills the time box")
    check(Board.repeatStored(["every": "day", "at": ["09:00", "17:00"]]) == C(every: .day, at: "09:00", others: ["17:00"]),
          "several daily times: the first in the box, the rest kept (kosmos#5752)")
    check(Board.repeatStored(["every": "week", "day": 1, "at": "09:30"]) == C(every: .week, at: "09:30", on: "mon")
          && Board.repeatStored(["every": "week", "day": 0, "at": "08:00"])?.on == "sun", "weekly: the engine's day number (Sunday 0) as the route's day")
    check(Board.repeatStored(["every": "fortnight"]) == nil && Board.repeatStored(["every": "week", "day": 9, "at": "09:00"]) == nil
          && Board.repeatStored("daily") == nil, "a rule the controls cannot show is nil, never shown as another rule")

    check(Board.repeatWire(C(every: .never)) == .clear && Board.repeatWire(C(every: .hour)) == .hour, "Never clears; Every hour")
    check(Board.repeatWire(C(every: .minutes, minutes: " 030 ")) == .minutes("30") && Board.repeatWire(C(every: .minutes, minutes: "60")) == .hour,
          "minutes are sent as the board stores them: 030 is 30, and 60 is hourly")
    check(Board.repeatWire(C(every: .minutes, minutes: "")) == .needsMinutes && Board.repeatNeeds(.needsMinutes) == "Say how many minutes",
          "an empty minutes box is no choice yet, said in the board's words")
    check(Board.repeatWire(C(every: .minutes, minutes: "12x")) == .minutes("12x"), "a minutes box that is not a number is sent for the Mac to refuse")
    check(Board.repeatWire(C(every: .day, at: "")) == .needsTime && Board.repeatNeeds(.needsTime) == "Choose a time", "an empty time: Choose a time")
    check(Board.repeatWire(C(every: .day, at: "18:00", others: ["09:00", "18:00"])) == .day("09:00,18:00"),
          "the box and the other times go as one sorted list, each once")
    check(Board.repeatWire(C(every: .week, at: "09:00", on: "fri")) == .week(on: "fri", at: "09:00"), "weekly sends its day and time")
    check(Board.repeatBody(.clear)?["clear"] as? Bool == true && Board.repeatBody(.minutes("30"))?["at"] as? String == "30"
          && Board.repeatBody(.week(on: "fri", at: "09:00"))?["on"] as? String == "fri" && Board.repeatBody(.needsTime) == nil,
          "the bodies are the board's: clear, the minutes as at, the day as on; nothing while a box is empty")

    let stored = C(every: .day, at: "09:00", others: ["17:00"])
    var moved = stored; moved.at = "10:00"
    check(Board.keptRepeatDraft(stored, stored: stored) == nil, "a draft that is the stored rule is no draft")
    check(Board.keptRepeatDraft(moved, stored: stored).map(Board.repeatWire) == .day("10:00,17:00"), "moving the box keeps the other time")
    var onto = stored; onto.at = "17:00"
    check(Board.keptRepeatDraft(onto, stored: stored).map(Board.repeatWire) == .day("17:00"), "moving the box onto the other time leaves one time")
    let agentChanged = C(every: .day, at: "08:00", others: ["20:00"])
    check(Board.keptRepeatDraft(moved, stored: agentChanged).map(Board.repeatWire) == .day("10:00,20:00"),
          "an edit under a rule changed elsewhere stands, and its other times follow the new rule (round 3 on the board)")
    var weekly = stored; weekly.every = .week
    check(Board.keptRepeatDraft(weekly, stored: stored)?.every == .week, "a frequency change is a draft")
    check(Board.keptRepeatDraft(moved, stored: nil) == nil, "a rule the controls cannot show drops the draft")
    var past = stored; past.at = "20:00"
    let savedPast = C(every: .day, at: "17:00", others: ["20:00"])   // as the read after the save gives it, sorted
    check(Board.repeatWire(past) == .day("17:00,20:00") && Board.keptRepeatDraft(past, stored: savedPast) == nil,
          "a box moved past the other time and saved: the read of the saved rule ends the draft (no time dropped)")
    check(Board.followStored(past, old: stored, new: savedPast) == nil, "and so does the change the save itself caused")
    check(Board.repeatShown(savedPast, box: "20:00") == C(every: .day, at: "20:00", others: ["17:00"]),
          "and the box stays on the time the person saved, though it sorts second")
    check(Board.repeatShown(savedPast, box: "17:00") == savedPast && Board.repeatShown(savedPast, box: "06:00") == savedPast
          && Board.repeatShown(savedPast, box: nil) == savedPast && Board.repeatShown(C(every: .hour), box: "20:00") == C(every: .hour),
          "a box the list does not hold, none, or a rule that is not daily: shown as stored")
    check(Board.repeatShown(savedPast, box: "20:00").map(Board.repeatWire) == Board.repeatWire(savedPast), "showing the box there changes nothing that would be sent")
    var weeklyThenDaily = C(every: .week, at: "09:00", others: ["17:00"], on: "fri")
    weeklyThenDaily = Board.followStored(weeklyThenDaily, old: stored, new: agentChanged) ?? weeklyThenDaily
    weeklyThenDaily.every = .day
    check(Board.repeatWire(weeklyThenDaily) == .day("09:00,20:00"),
          "a weekly draft over a daily rule changed elsewhere, switched back to daily, sends the new rule's other time, not the removed one")
    let never = C(every: .never), hourly = C(every: .hour)
    check(Board.followStored(never, old: never, new: stored) == nil,
          "a draft put back on the old rule follows a rule changed elsewhere (never left showing Never over a daily rule)")
    check(Board.followStored(hourly, old: never, new: stored).map(Board.repeatWire) == .hour, "a real edit stands when the rule changes elsewhere")
    check(Board.followStored(moved, old: stored, new: agentChanged).map(Board.repeatWire) == .day("10:00,20:00"),
          "an edited daily time stands and takes the new rule's other times")
    check(Board.followStored(nil, old: never, new: stored) == nil && Board.followStored(hourly, old: never, new: hourly) == nil,
          "no draft stays none; a draft the new rule now equals goes")
    check(Board.repeatTimeString(Board.repeatTime("07:05")) == "07:05" && Board.repeatTimeString(Board.repeatTime("23:59")) == "23:59",
          "a time goes through the picker's Date and back unchanged")

    let req = Board.taskRepeatRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3, wire: .day("09:00"))
    let sentBody = req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(req?.httpMethod == "POST" && req?.url?.absoluteString == "https://studio.kosmosplus.com/api/project/springcatalogue/task/3/repeat"
          && sentBody?["every"] as? String == "day" && sentBody?["at"] as? String == "09:00", "POST .../repeat with the board's body")
    check(Board.taskRepeatRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "x", number: 1, wire: .needsMinutes) == nil,
          "nothing is built while a box is empty")

    // A task that repeats, read from the projects read: the fields engine/taskrepeat.fieldsOf adds to it.
    var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
    var projs = doc["projects"] as? [[String: Any]] ?? []
    var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
    if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
        tks[i]["repeat"] = ["every": "day", "at": ["09:00", "17:00"]]
        tks[i]["repeatWords"] = "every day at 9am and 5pm"
        tks[i]["repeatNextWords"] = "today at 5pm"
        tks[i]["repeatMissed"] = 1
        tks[i]["repeatMissedWords"] = "today at 9am"
    }
    if !projs.isEmpty { projs[0]["tasks"] = tks }
    doc["projects"] = projs
    let repeating = (try? JSONSerialization.data(withJSONObject: doc)).map { Board.parseTaskPage($0, project: "springcatalogue", number: 3) }
    if case .page(let rp)? = repeating, let row = rp.repeatRow {
        check(rp.repeatStored == C(every: .day, at: "09:00", others: ["17:00"]), "the page reads the stored rule for its controls")
        check(Tasks.repeatSentence(row, now: Date()) { $0 } == "Missed the run due today at 9am. Repeats every day at 9am and 5pm. Next today at 5pm.",
              "the page's line is the board's sentence, the missed run first")
        check(!Tasks.repeatMissed(row).isEmpty, "a missed run marks the line (drawn red)")
    } else {
        check(false, "a repeating task reads as a page with its repeat row")
    }
    check(page(3)?.repeatRow == nil && page(3)?.repeatStored == C(every: .never), "a task that does not repeat has no line, and Never")
}
await b3ModelTests()

section("slice B3b: who is told when a run is missed (kosmos#8958)")
do {
    // The fields engine/tasks.js setReviewer writes, on task 3 of the captured read.
    func pageWith(_ fields: [String: Any]) -> Board.TaskPage? {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) { for (k, v) in fields { tks[i][k] = v } }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        guard let d = try? JSONSerialization.data(withJSONObject: doc), case .page(let pg) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) else { return nil }
        return pg
    }
    let rule: [String: Any] = ["every": "hour"]
    check(page(3)?.repeatReviewer == "none" && page(3)?.memberOrder == ["dana", "eli"], "no reviewer reads as none; members in the project's order")
    do {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var agents = projs.first?["agents"] as? [[String: Any]] ?? []
        if let first = agents.first { agents.append(first) }
        if !projs.isEmpty { projs[0]["agents"] = agents }
        doc["projects"] = projs
        if let d = try? JSONSerialization.data(withJSONObject: doc), case .page(let twice) = Board.parseTaskPage(d, project: "springcatalogue", number: 3) {
            check(twice.memberOrder == ["dana", "eli"], "an agent listed twice is one choice")
        } else { check(false, "a page with an agent listed twice") }
    }
    check(pageWith(["repeat": rule, "repeatReviewerPerson": true])?.repeatReviewer == "me", "the person as reviewer reads as me")
    check(pageWith(["repeat": rule, "repeatReviewer": "eli"])?.repeatReviewer == "eli", "an agent as reviewer reads as its session")
    check(pageWith(["repeat": rule, "repeatReviewerPerson": true, "repeatReviewer": "eli"])?.repeatReviewer == "me",
          "the person's mark wins over an agent's name, as the board's tkReviewerOf")
    if let pg = pageWith(["repeat": rule, "repeatReviewer": "eli"]) {
        check(Board.reviewerOptions(pg, roster: roster).map(\.words) == ["Nobody", "Me", "Dana", "Eli"]
              && Board.reviewerOptions(pg, roster: roster).map(\.value) == ["none", "me", "dana", "eli"], "Nobody, Me, then the project's agents by name")
    } else { check(false, "a page with a reviewer") }
    if let gone = pageWith(["repeat": rule, "repeatReviewer": "gus"]) {
        check(Board.reviewerOptions(gone, roster: roster).last == Board.ReviewerOption(value: "gus", words: "Gus (left the project)"),
              "a stored reviewer no longer on the project stays listed, and says so")
    } else { check(false, "a page with a reviewer who left") }
    let req = Board.taskReviewerRequest(mac: URL(string: "https://studio.kosmosplus.com")!, project: "springcatalogue", number: 3, reviewer: "me")
    check(req?.url?.path == "/api/project/springcatalogue/task/3/repeat"
          && (req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?.keys.sorted() == ["reviewer"],
          "POST .../repeat with the reviewer alone, so the rule is left as it is")
}
await b3bModelTests()

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)

@MainActor
func b3ModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    await m.read()
    // The rule the Mac stores once the save lands, so the read after it shows it (as the real board does).
    func withRule(_ rule: Any, closed: Bool = false) -> Data {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            tks[i]["repeat"] = rule
            if closed { tks[i]["progress"] = ["done": 1, "total": 1, "closed": true]; tks[i]["closedAt"] = "2026-11-24T15:00:00.000Z" }
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (try? JSONSerialization.data(withJSONObject: doc)) ?? Data()
    }
    mac.asked = []
    let unchanged = await m.saveRepeat(.clear, names: nm)
    check(!unchanged && mac.asked.isEmpty, "Save of the rule already stored (none) sends nothing")
    let empty = await m.saveRepeat(.needsTime, names: nm)
    check(!empty && mac.asked.isEmpty, "nothing is sent while a box is empty")
    var body: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/repeat") { body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{},"words":"every week on Friday at 9am"}"#)]
    mac.projects = (200, withRule(["every": "week", "day": 5, "at": "09:00"]))
    let saved = await m.saveRepeat(.week(on: "fri", at: "09:00"), names: nm)
    check(saved && body?["every"] as? String == "week" && body?["on"] as? String == "fri" && body?["at"] as? String == "09:00",
          "a weekly rule is posted with its day and time")
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/repeat", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "then the page and its activity are read again")
    check(m.repeatSay == Board.repeatSaved && !m.repeatRefused && !m.repeatSaving && m.page?.repeatStored?.on == "fri", "Saved., and the page shows the new rule")
    mac.asked = []
    let again = await m.saveRepeat(.week(on: "fri", at: "09:00"), names: nm)
    check(!again && mac.asked.isEmpty, "the same rule again sends nothing")
    await m.read()
    check(m.repeatSay == Board.repeatSaved, "Saved. stays through a read that still shows the saved rule")
    mac.projects = (200, withRule(["every": "hour"]))
    await m.read()
    check(m.repeatSay == nil, "Saved. goes once the rule is changed elsewhere")
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let toDaily = await m.saveRepeat(.day("08:00"), names: nm)
    mac.projects = (200, withRule(["every": "day", "at": "08:00"], closed: true))
    await m.read()
    check(toDaily && m.page?.closed == true && m.repeatSay == nil, "Saved. goes when the task is finished, even with its rule unchanged")
    mac.projects = (200, withRule(["every": "hour"]))   // open again for the refusals below
    await m.read()
    mac.onSend = nil
    mac.actAnswers = [(400, #"{"error":"every so many minutes takes a number from 15 to 720"}"#)]
    let refused = await m.saveRepeat(.minutes("5"), names: nm)
    check(!refused && m.repeatSay == "every so many minutes takes a number from 15 to 720" && m.repeatRefused && !m.repeatSaving,
          "a refusal is the Mac's own sentence, marked as a refusal")
    mac.projects = (200, withRule(["every": "hour"], closed: true))
    await m.read()
    check(m.repeatSay == nil && !m.repeatRefused, "a refusal goes when the task is finished")
    mac.projects = (200, withRule(["every": "hour"]))
    await m.read()
    mac.actAnswers = [(400, #"{"error":"every so many minutes takes a number from 15 to 720"}"#)]
    _ = await m.saveRepeat(.minutes("5"), names: nm)
    m.clearRepeatSay()
    check(m.repeatSay == nil && !m.repeatRefused, "a new choice retires the last answer")
    mac.actAnswers = [nil]
    let unreached = await m.saveRepeat(.minutes("30"), names: nm)
    check(!unreached && m.repeatSay == Board.repeatUnreached, "no answer: the could-not-reach words")

    // The guards between Save and Mark as done, each way, and Save on a finished task.
    mac.actAnswers = []
    mac.holdTheNext()
    let saving = Task { await m.saveRepeat(.minutes("45"), names: nm) }
    await waitUntil({ mac.holding }, "the repeat save held")
    let duringSave = mac.asked.count
    if let act = m.page?.act { await m.press(act, names: nm) }
    check(m.repeatSaving && mac.asked.count == duringSave, "Mark as done sends nothing while a Repeats save is out")
    mac.release()
    _ = await saving.value
    mac.holdTheNext()
    let pressing = Task { if let act = m.page?.act { await m.press(act, names: nm) } }
    await waitUntil({ mac.holding }, "the press held")
    let duringPress = mac.asked.count
    let savedDuringPress = await m.saveRepeat(.minutes("50"), names: nm)
    check(!savedDuringPress && mac.asked.count == duringPress, "Save sends nothing while Mark as done is out")
    mac.release()
    await pressing.value
    mac.projects = (200, withRule(["every": "hour"], closed: true))
    await m.read()
    mac.asked = []
    let onClosed = await m.saveRepeat(.minutes("30"), names: nm)
    check(m.page?.closed == true && !onClosed && mac.asked.isEmpty, "Save on a finished task sends nothing")
}

@MainActor
func b3bModelTests() async {
    let mac = FakeMac()
    let m = TaskPageModel(project: "springcatalogue", number: 3, send: { await mac.asyncSend($0) }, sleep: { _ in }, epoch: { mac.epoch })
    m.onScreen = true
    m.touched()
    let nm = ["dana": "Dana"]
    func with(_ fields: [String: Any], closed: Bool = false) -> Data {
        var doc = (try? JSONSerialization.jsonObject(with: projectsData) as? [String: Any]) ?? [:]
        var projs = doc["projects"] as? [[String: Any]] ?? []
        var tks = projs.first?["tasks"] as? [[String: Any]] ?? []
        if let i = tks.firstIndex(where: { ($0["number"] as? NSNumber)?.intValue == 3 }) {
            for (k, v) in fields { tks[i][k] = v }
            if closed { tks[i]["progress"] = ["done": 1, "total": 1, "closed": true]; tks[i]["closedAt"] = "2026-11-24T15:00:00.000Z" }
        }
        if !projs.isEmpty { projs[0]["tasks"] = tks }
        doc["projects"] = projs
        return (try? JSONSerialization.data(withJSONObject: doc)) ?? Data()
    }
    let rule: [String: Any] = ["every": "hour"]
    await m.read()
    mac.asked = []
    let noRule = await m.saveReviewer("me", names: nm)
    check(!noRule && mac.asked.isEmpty, "a task that does not repeat sends nothing")
    mac.projects = (200, with(["repeat": rule]))
    await m.read()
    mac.asked = []
    let same = await m.saveReviewer("none", names: nm)
    check(!same && mac.asked.isEmpty, "the reviewer already stored sends nothing")
    var body: [String: Any]?
    mac.onSend = { r in if r.url!.path.hasSuffix("/repeat") { body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } } }
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    let saved = await m.saveReviewer("dana", names: nm)
    check(saved && body?["reviewer"] as? String == "dana" && body?.count == 1, "the reviewer is posted alone")
    check(mac.asked == ["POST /api/project/springcatalogue/task/3/repeat", "GET /api/projects", "GET /api/project/springcatalogue/task/3/activity"],
          "then the page and its activity are read")
    check(m.reviewerSay == Board.repeatSaved && m.reviewerSaving == nil && m.page?.repeatReviewer == "dana", "Saved., and the page shows the new reviewer")
    await m.read()
    check(m.reviewerSay == Board.repeatSaved, "Saved. stays through a read that still shows the saved reviewer")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes once the reviewer is changed elsewhere")
    // Recorded, but the read after it failed: the choice keeps showing what was saved until a read succeeds.
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (500, Data())
    let unread = await m.saveReviewer("dana", names: nm)
    check(unread && m.reviewerSay == Board.repeatSaved && m.reviewerShown == "dana" && m.page?.repeatReviewer == "eli",
          "a save whose read failed: Saved., and the choice shows what was saved, not the old reviewer")
    // Picking the page's (stale) reviewer back while the saved one shows is a change, and is sent.
    mac.asked = []
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let back = await m.saveReviewer("eli", names: nm)
    check(back && mac.asked.first == "POST /api/project/springcatalogue/task/3/repeat", "choosing the old reviewer back while the saved one shows is sent, not ignored")
    mac.projects = (500, Data())
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    _ = await m.saveReviewer("dana", names: nm)
    check(m.reviewerShown == "dana", "premise: the saved reviewer shows again after a second unread save")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    await m.read()
    check(m.reviewerShown == nil && m.page?.repeatReviewer == "dana", "the next read that lands shows the page")
    // A tick read started BEFORE the save, landing (with the old reviewer) while the save's own read is still out, and
    // that own read then failing: the tick is not the save's read, so the saved reviewer still shows.
    mac.queueing = true
    let tick = Task { await m.read() }
    await waitUntil({ mac.queuedCount == 1 }, "the tick read queued")
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    let racing = Task { await m.saveReviewer("me", names: nm) }
    await waitUntil({ mac.queuedCount == 2 }, "the save's post queued")
    mac.projects = (500, Data())
    mac.release(at: 1)                                   // the post is recorded; the save's own read is sent and fails
    await waitUntil({ mac.queuedCount == 2 }, "the save's own read queued")
    mac.release(at: 0)                                   // the older tick lands, with the old reviewer
    await tick.value
    mac.queueing = false
    mac.release(at: 0)                                   // the save's own read answers, failed
    _ = await racing.value
    check(m.page?.repeatReviewer == "dana" && m.reviewerShown == "me",
          "a tick read started before the save and landing during it does not stand for the save's own read")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "me"]))
    await m.read()
    mac.projects = (200, with(["repeat": NSNull()]))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes when the task stops repeating")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "dana"]))
    await m.read()
    mac.actAnswers = [(200, #"{"task":{}}"#)]
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    _ = await m.saveReviewer("eli", names: nm)
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"], closed: true))
    await m.read()
    check(m.reviewerSay == nil, "Saved. goes when the task is finished")
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    mac.actAnswers = [nil]
    let unreached = await m.saveReviewer("me", names: nm)
    check(!unreached && m.reviewerSay == Board.reviewerUnreached && m.reviewerRefused, "no answer: the could-not-reach words")
    mac.onSend = nil
    mac.actAnswers = [(403, #"{"error":"only the person can name themselves as the reviewer"}"#)]
    let refused = await m.saveReviewer("me", names: nm)
    check(!refused && m.reviewerSay == "only the person can name themselves as the reviewer" && m.reviewerRefused && m.reviewerSaving == nil,
          "a refusal is the Mac's own sentence, marked as a refusal")
    await m.read()
    check(m.reviewerRefused && m.reviewerSay != nil, "a refusal stays through a read that still shows the task repeating")
    mac.projects = (200, with(["repeat": NSNull()]))
    await m.read()
    check(m.reviewerSay == nil && !m.reviewerRefused, "a refusal goes when the task stops repeating")
    mac.projects = (200, with(["repeat": rule]))
    await m.read()
    mac.actAnswers = [(403, #"{"error":"only the person can name themselves as the reviewer"}"#)]
    _ = await m.saveReviewer("dana", names: nm)
    mac.projects = (200, with(["repeat": rule], closed: true))
    await m.read()
    check(m.reviewerSay == nil && !m.reviewerRefused, "a refusal goes when the task is finished")
    mac.projects = (200, with(["repeat": NSNull()]))
    await m.read()
    mac.projects = (200, with(["repeat": rule]))
    await m.read()

    // The guards each way: a reviewer save against Mark as done and against a Repeats save.
    mac.actAnswers = []
    mac.holdTheNext()
    let saving = Task { await m.saveReviewer("eli", names: nm) }
    await waitUntil({ mac.holding }, "the reviewer save held")
    let during = mac.asked.count
    if let act = m.page?.act { await m.press(act, names: nm) }
    let repeatDuring = await m.saveRepeat(.minutes("30"), names: nm)
    check(m.reviewerSaving == "eli" && !repeatDuring && mac.asked.count == during, "Mark as done and a Repeats save send nothing while a reviewer save is out")
    mac.release()
    _ = await saving.value
    mac.projects = (200, with(["repeat": rule, "repeatReviewer": "eli"]))
    await m.read()
    mac.holdTheNext()
    let repeatSaving = Task { await m.saveRepeat(.minutes("30"), names: nm) }
    await waitUntil({ mac.holding }, "the repeat save held")
    let duringRepeat = mac.asked.count
    let reviewerDuring = await m.saveReviewer("me", names: nm)
    check(!reviewerDuring && mac.asked.count == duringRepeat, "a reviewer save sends nothing while a Repeats save is out")
    mac.release()
    _ = await repeatSaving.value
    mac.holdTheNext()
    let pressing = Task { if let act = m.page?.act { await m.press(act, names: nm) } }
    await waitUntil({ mac.holding }, "the press held")
    let duringPress = mac.asked.count
    let reviewerPress = await m.saveReviewer("me", names: nm)
    check(!reviewerPress && mac.asked.count == duringPress, "a reviewer save sends nothing while Mark as done is out")
    mac.release()
    await pressing.value
    mac.projects = (200, with(["repeat": rule], closed: true))
    await m.read()
    mac.asked = []
    let onClosed = await m.saveReviewer("me", names: nm)
    check(!onClosed && mac.asked.isEmpty, "a finished task sends nothing")
}
