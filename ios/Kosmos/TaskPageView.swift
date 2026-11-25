import SwiftUI

// kosmos#7074 (a gap in #6838's plan): a task's page, native, opened from Today's Check it and from a Tasks row. It draws
// what TaskPageLogic.swift says and does what TaskPageModel.swift does: the board's task page (web/index.html,
// paintTaskPage) for reading, and its human verbs: Mark as done / Reopen, and (kosmos#8958 slice B1) a message on the
// task, its due date, and editing its title or detail, (slice B2) Put on hold / Take off hold, and (slice B3) how often
// it repeats, and (B3b) who is told when a run is missed; (B4) a closed task's receipt; (B5) undoing its file changes; and
// (B6) its subtasks; (B7) who is on each part, Done and Put back, and adding one; (B8) what a hold waits for and why; and (B9)
// when it is done and what it waits to wake on. What is left on the board's page alone is in taskchecks-8958's plan, and none of
// it needs a way out to it from here.
struct TaskPageRef: Hashable {
    let project: String
    let number: Int
}

struct TaskPageView: View {
    @ObservedObject var client: BoardClient
    let ref: TaskPageRef
    @StateObject private var model: TaskPageModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var visible = false
    @State private var loop: Task<Void, Never>?
    @State private var openSub: Int?
    // kosmos#8958 slice B1: the message being typed, and the edit form with the words it opened with.
    @State private var sayText = ""
    @State private var editing: (title: String, detail: String?)?
    @State private var editTitle = ""
    @State private var editDetail = ""
    // The Due section's picker: the date being chosen, saved only by Set (the board's date field saves once, on change,
    // when a date is committed, never on each day tapped).
    @State private var dueDraft: String?
    // kosmos#8958 slice B3: the Repeats choice being made, nil while the controls show the stored rule.
    @State private var repeatDraft: Board.RepeatChoice?
    // The stored rule the draft was started from, or last followed: what a change to the stored rule is compared with.
    @State private var repeatDraftBase: Board.RepeatChoice?
    // The daily time the person had in the box when they last saved (Board.repeatShown).
    @State private var repeatBox: String?
    // kosmos#8958 slice B4: the receipt's agents whose file list is open.
    @State private var receiptFilesOpen: Set<Int> = []
    // kosmos#8958 slice B5: whether the undo list is open, the plan as it opened, and the files chosen in it. The plan stays
    // while the sheet slides away, so it never empties in view.
    @State private var undoOpen = false
    @State private var undoList = Board.UndoPlan(files: [])
    @State private var undoChosen: Set<String> = []
    // kosmos#8958 slice B6: the Add subtask sheet, its draft and held words (kept past the page, subKept), and the line it leaves.
    @State private var adding: NewTaskStart?
    @State private var subDraft = NewTask.Draft()
    @State private var subHeld: NewTask.Held?
    @State private var subAdded: String?
    private static var subKept = NewTask.KeptDrafts()
    // kosmos#8958 slice B7: the part being typed.
    @State private var newPart = ""
    // kosmos#8958 slice B9: the folded runs that are open.
    @State private var runsOpen: Set<String> = []
    // kosmos#8958 slice B8: what the hold form holds while it differs from the stored hold, and the stored hold it was made
    // against, or last followed.
    @State private var holdDraft: Board.HoldChoice?
    @State private var holdBase: Board.HoldChoice?

    init(client: BoardClient, ref: TaskPageRef) {
        self.client = client
        self.ref = ref
        #if DEBUG
        var send: TaskPageModel.Send = { [weak client] build in await client?.throughMac(build) }
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { send = Self.sampleSend }
        #else
        let send: TaskPageModel.Send = { [weak client] build in await client?.throughMac(build) }
        #endif
        _model = StateObject(wrappedValue: TaskPageModel(
            project: ref.project, number: ref.number,
            send: send,
            sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) },
            epoch: { [weak client] in client?.chatEpoch ?? -1 }))
    }

    // The roster's names, for an agent the project does not list.
    private var roster: [String: String] { Dictionary(client.agents.map { ($0.session, $0.name) }, uniquingKeysWith: { a, _ in a }) }
    // The roster's names, as a snapshot; the model lays the project's own over them after it has read the task.
    private var names: [String: String] { roster }

    var body: some View {
        content
            .background(Palette.ground.ignoresSafeArea())
            .navigationTitle("Task \(ref.number)")
            .navigationBarTitleDisplayMode(.inline)
            .kosmosSolidTopBar()   // kosmos#7346 (Josh 10-27 20:21): no row shows behind the top bar
            .background(subLink)
            .sheet(isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) { editSheet }
            .sheet(isPresented: Binding(get: { undoOpen }, set: { if !$0 { undoOpen = false; model.leaveUndo() } }), onDismiss: {
                // Said once the list has gone: an announcement under a closing sheet is cut off by the screen change.
                if let done = model.undoDone { UIAccessibility.post(notification: .announcement, argument: done) }
            }) { undoSheet }
            // Undone, put back, or read again as something else: the list that was open is about nothing any more.
            .onChange(of: model.undoPlan) { _ in undoOpen = false }
            // An Add that could not be told was made after all: its words are not the next part's.
            .onChange(of: model.partAdded) { added in
                if added.contains(newPart.trimmingCharacters(in: .whitespacesAndNewlines)) { newPart = "" }
                model.tookAdded()
            }
            // Another account or Mac: the list is about nothing, and an undo still out would hold it open.
            .onChange(of: client.chatEpoch) { _ in undoOpen = false; newPart = ""; holdDraft = nil; holdBase = nil; adding = nil; subDraft = NewTask.Draft(); subHeld = nil; subAdded = nil }
            .onChange(of: subDraft) { _ in keepSub() }
            .onChange(of: subHeld) { _ in keepSub() }
            .sheet(item: $adding) { start in
                NewTaskView(client: client, tasks: client.tasksList, picked: start.picked, draft: $subDraft,
                            held: $subHeld, heldFound: subFound(in:), added: subLine,
                            under: model.page.map { NewTask.Under(project: ref.project, projectName: $0.projectName, number: ref.number, sentence: $0.sentence) })
            }
            // The Tasks list read that shows a subtask held after "could not tell", as the Tasks tab's does.
            .onChange(of: client.tasksList) { read in if let read { subFound(in: read) } }
            // Gone from the Mac, maybe for one read: a draft is not carried over to whatever hold it comes back with.
            .onChange(of: model.gone) { _ in holdDraft = nil; holdBase = nil }
            // The person in front of it (the board's tkPresent): on screen, the app in front, and a touch (or a key press
            // that reaches the window) in the last two minutes (PresenceProbe); opening the page or coming back counts.
            .background(PresenceProbe { model.touched() })
            .onAppear {
                visible = true
                // Come back to from a subtask, or opened again: the last line is old, and a draft left here is picked up.
                subAdded = nil
                if adding == nil {
                    let kept = Self.subKept.get(ref.project, ref.number, epoch: client.chatEpoch)
                    if kept.draft != subDraft { subDraft = kept.draft }
                    if kept.held != subHeld { subHeld = kept.held }
                    if let read = client.tasksList { subFound(in: read) }
                }
                model.onScreen = true
                model.appActive = scenePhase == .active
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
                model.touched()
                startReading(returning: true)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.voiceOverStatusDidChangeNotification)) { _ in
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
            }
            .onReceive(NotificationCenter.default.publisher(for: UIAccessibility.switchControlStatusDidChangeNotification)) { _ in
                model.assistive = UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
            }
            .onDisappear { visible = false; model.onScreen = false; loop?.cancel(); loop = nil; model.stopReceipt() }
            .onChange(of: scenePhase) { phase in
                model.appActive = phase == .active
                guard visible else { return }
                if phase == .active {
                    model.touched()
                    startReading(returning: true)
                } else { loop?.cancel(); loop = nil; model.stopReceipt() }
            }
            .onChange(of: model.activityKey) { _ in Task { await model.markSeen() } }
    }

    // Read now and every 5 seconds: the task while the page is on screen, its activity and the seen mark only while the
    // person is there (TaskPageModel.shouldReadTask / shouldReadActivity, the board's tick), so a state that landed while
    // they were idle is marked within one tick of their coming back. `returning` (the page appearing, the app coming
    // back) records the state once more, as the board's tkTabReturn does, but only the state just read and drawn: a
    // read that fails records nothing, so a nudge that arrived while they were away is never marked before it is shown.
    private func startReading(returning: Bool = false) {
        loop?.cancel()
        loop = Task {
            var first = true
            while !Task.isCancelled {
                await model.tick(first: first, returning: returning, names: names)
                first = false
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    @ViewBuilder private var content: some View {
        if let page = model.page, !model.gone {
            // Redrawn every 30 seconds, so "2 minutes ago" and "today" move on while nothing else changes.
            TimelineView(.periodic(from: .now, by: 30)) { _ in
                ScrollView { pageBody(page).padding(16) }
                    // A drag closes the keyboard, for every box on the page. The Repeats minutes box needs it most: a number pad
                    // has no return key.
                    .scrollDismissesKeyboard(.interactively)
            }
                .dotsRefresh { await model.read(); await model.readActivity(names: names) }
        } else if model.gone {
            message("This task is not on your computer any more", "It may have been deleted, or its project moved.")
        } else if model.readFailed {
            message("Kosmos could not read this task just now", "It tries again in a few seconds.")
        } else {
            SweepDots(label: "Loading", scales: false).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func message(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 8) {
            Text(title).font(.headline).foregroundColor(Palette.primary)
            Text(detail).font(.subheadline).foregroundColor(Palette.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func pageBody(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            header(p)
            doneBlock(p)
            if let hold = p.hold { holdBlock(p, hold) }
            if !p.checks.isEmpty || !p.movedHere.isEmpty { checksBlock(p) }
            dueBlock(p)
            if !p.closed { repeatBlock(p) }
            whoBlock(p)
            subtasksBlock(p)
            activityBlock
            if let receipt = model.receipt { receiptBlock(receipt, p) }
            sayBlock(p)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // A finished task has no Repeats section, and an unsaved choice does not come back if it is reopened.
        .onChange(of: p.closed) { closed in if closed { repeatDraft = nil; repeatDraftBase = nil; repeatBox = nil } }
        // The stored hold moved (another device, an agent, a Save): what was not changed here follows it. Taken off, or the task
        // finished: the next hold's form starts from what is stored.
        .onChange(of: p.hold.map { model.holdShown ?? $0.stored }) { stored in
            holdDraft = Board.holdFollow(holdDraft, base: holdBase, stored: stored)
            holdBase = holdDraft == nil ? nil : stored
        }
        // Another receipt starts with its files closed, as the board's does: which are open is kept by the agent's place in
        // the list, and another receipt can put another agent there. One read again and found the same keeps them.
        .onChange(of: model.receipt) { _ in if !receiptFilesOpen.isEmpty { receiptFilesOpen = [] } }
    }

    private func header(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(p.projectName).font(.subheadline).foregroundColor(Palette.secondary)
            Text(p.sentence).font(.title2.weight(.semibold)).foregroundColor(Palette.primary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let detail = p.detail {
                Text(Board.messageText(detail)).font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // kosmos#8958 slice B1: the board's "Edit title or detail", on every task (closed ones too, as the board).
            Button {
                model.touched()
                model.clearEditRefusal()
                editTitle = p.sentence
                editDetail = Board.boardLineEnds(p.detail ?? "")
                editing = (p.sentence, p.detail)
            } label: {
                Text(Board.taskEditOpen).font(.footnote).foregroundColor(Palette.link)
                    .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text(p.stateLine(roster: roster)).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                .padding(.top, 4)
            // The board's links inside that line.
            ForEach(p.stateTasks, id: \.self) { n in taskLink("Open task \(n)", n) }
            if let w = p.whoLeftLine(roster: roster) {
                Text(w).font(.subheadline).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
            }
            Group {
                Text(p.addedLine(now: Date()))
                if let parent = p.parentNumber, let sentence = p.parentSentence {
                    Button { openSub = parent } label: {
                        Text("Part of #\(parent) " + sentence).foregroundColor(Palette.link)
                            .frame(minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens task \(parent).")
                }
            }
            .font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    // kosmos#8958 slice B9: the board's tk-donewhen-row: each check with what an agent says about it, and the checks of other
    // tasks that moved here. Written by agents and only read here, as on the board.
    private func checksBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !p.checks.isEmpty {
                sectionTitle(Board.checksTitle)
                ForEach(Array(p.checks.enumerated()), id: \.offset) { i, c in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        // Hidden from VoiceOver: the check says its own number.
                        Text("\(i + 1).").font(.body).foregroundColor(Palette.secondary).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: c.words).font(.body).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
                                Text(verbatim: p.checkSays(c, roster: roster)).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(p.checkSpoken(i, c, roster: roster))
                            if let n = c.movedTo { taskLink("Moved to task \(n)", n) }
                        }
                    }
                }
            }
            if !p.movedHere.isEmpty {
                sectionTitle(Board.movedHereTitle)
                ForEach(Array(p.movedHere.enumerated()), id: \.offset) { _, m in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: m.words).font(.body).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
                        taskLink("Check \(m.check) of task \(m.from), reported not met there", m.from)
                    }
                }
            }
        }
    }
    private func taskLink(_ words: String, _ n: Int) -> some View {
        Button { openSub = n } label: {
            Text(words).font(.footnote).foregroundColor(Palette.link).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens task \(n).")
    }

    // The one act the person owns, with what it does not do said above it, and the Mac's refusal under it.
    private func doneBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let note = p.closeNote(roster: roster) {
                Text(note).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            // Neither this nor the lines under it while the form shows a hold that has not been read back (holdShown): they are of
            // the one before it.
            if let hold = p.holdLine, model.holdShown == nil || p.projectPaused {
                Text(hold).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array((model.holdShown == nil ? p.holdLines(now: Date()) : []).enumerated()), id: \.offset) { _, line in
                Text(line).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            // kosmos#8958 slice B2: the board's tk-hold, on an open task. What a hold waits for and why: holdBlock.
            if !p.closed {
                let was = p.onHold
                Button { model.touched(); Task { await model.toggleHold(wasOnHold: was, names: names) } } label: {
                    HStack(spacing: 8) {
                        if model.holding && !model.holdFormSaving { SweepDots(scales: false) }
                        Text(Board.holdTitle(onHold: was)).font(.body.weight(.semibold)).foregroundColor(Palette.link)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(Palette.secondary.opacity(0.4), lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.holding || model.pressing || model.partWriting != nil)
                .opacity(model.holding || model.pressing || model.partWriting != nil ? 0.6 : 1)
                .accessibilityValue(model.holding && !model.holdFormSaving ? "In progress" : "")
                // The form's own line is by its Save, while the form is there.
                if !model.holdSayAtForm || p.hold == nil { holdLine }
                if model.holdSay != nil, model.holdChoose { chooseWho(p) }
                if model.partAtHold { partLine }   // whoBlock draws it once the task is finished and this block is not
            }
            if p.allSubtasksDone {
                Text(Board.subtasksDoneLine(unrun: p.subtasksUnrun)).font(.footnote).foregroundColor(Palette.secondary)
            } else if p.allSubtasksBuilt {
                Text(Board.subtasksBuiltLine(unrun: p.subtasksUnrun)).font(.footnote).foregroundColor(Palette.secondary)
                // kosmos#8958 slice B6: the board's tk-subs-closeall.
                Button { model.touched(); Task {
                    // Said aloud: the button goes, and the one left reads Reopen. Not over another page.
                    if await model.closeWithSubtasks(names: names), visible { UIAccessibility.post(notification: .announcement, argument: Board.subtasksClosed) }
                } } label: {
                    HStack(spacing: 8) {
                        if model.closingSubtasks { SweepDots(scales: false) }
                        Text(Board.subtasksCloseAll).font(.footnote).foregroundColor(Palette.link)
                    }
                    .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .opacity(busy ? 0.6 : 1)
                .accessibilityValue(model.closingSubtasks ? "In progress" : "")
                .accessibilityIdentifier("taskpage.closeall")
            }
            let act = p.act
            // In progress on the one pressed, while it is there (a tick read mid-way can take Close them away).
            let acting = model.pressing && !(model.closingSubtasks && p.allSubtasksBuilt)
            Button { model.touched(); Task { await model.press(act, names: names) } } label: {
                HStack(spacing: 8) {
                    if acting { SweepDots(colour: Palette.card, scales: false) }
                    Text(act.title).font(.headline)
                }
                .foregroundColor(Palette.card)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 10).fill(Palette.primary))
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .opacity(busy ? 0.6 : 1)
            .accessibilityValue(acting ? "In progress" : "")
            if let refusal = model.refusal {
                Text(refusal).font(.footnote).foregroundColor(Palette.dangerWord).fixedSize(horizontal: false, vertical: true)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: refusal) }
            }
        }
    }

    // What the last press or Save said about the hold.
    @ViewBuilder private var holdLine: some View {
        if let say = model.holdSay {
            Text(say).font(.footnote).foregroundColor(model.holdRefused ? Palette.dangerWord : Palette.secondary).fixedSize(horizontal: false, vertical: true)
                .id("hold:" + say)
                .onAppear { UIAccessibility.post(notification: .announcement, argument: say) }
        }
    }

    // kosmos#8958 slice B8: the board's form on a held, open task (tk-hold-for, tk-hold-task, tk-hold-at, tk-hold-why-in): what
    // the hold waits for and why. It shows what is stored unless there is an unsaved change; Save sends only what was changed.
    private func holdBlock(_ p: Board.TaskPage, _ h: Board.TaskHold) -> some View {
        let stored = model.holdShown ?? h.stored
        let shown = holdDraft ?? stored
        let edit = { (change: (inout Board.HoldChoice) -> Void) in
            var c = holdDraft ?? stored
            if holdDraft == nil { holdBase = stored }
            model.touched()
            model.clearHoldFormSay()
            change(&c)
            // Kept even when it is now what is stored (Save is then off): dropped here, a space typed at the end of the reason
            // would be taken from under the person's fingers.
            holdDraft = c
        }
        let base = holdBase ?? stored
        let now = Date()
        let ready = Board.holdReady(shown, stored: base, now: now)
        let late = Board.holdLate(shown, stored: base, now: now)
        let off = !ready || model.holding || model.pressing || model.partWriting != nil
        return VStack(alignment: .leading, spacing: 6) {
            sectionTitle(Board.holdSection)
            holdRow(Board.holdForLabel) {
                Picker(Board.holdForSpoken, selection: Binding(get: { shown.kind }, set: { v in edit { c in
                    c.kind = v
                    if v == .at, c.at == nil { c.at = Board.holdFirstTime(now: Date()) }
                } })) {
                    ForEach(Board.HoldFor.allCases, id: \.self) { Text($0.words).tag($0) }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .accessibilityLabel(Board.holdForSpoken)
                .accessibilityInputLabels([Board.holdForLabel, shown.kind.words])
                .tint(Palette.link)
                .frame(minHeight: 44)
                .accessibilityIdentifier("taskpage.hold.for")
            }
            switch shown.kind {
            case .nothing: EmptyView()
            case .task:
                let options = Board.holdOptions(h, chosen: shown.task)
                holdRow(Board.holdUntilLabel) {
                    Picker(Board.holdTaskSpoken, selection: Binding(get: { shown.task }, set: { v in edit { $0.task = v } })) {
                        ForEach(options, id: \.self) { Text(verbatim: $0.words).tag($0.value) }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .accessibilityLabel(Board.holdTaskSpoken)
                    .accessibilityInputLabels([Board.holdUntilLabel] + [options.first { $0.value == shown.task }?.words].compactMap { $0 })
                    .tint(Palette.link)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("taskpage.hold.task")
                }
            case .at:
                // A time that has passed is shown as it is kept: a range that left it out would draw another one over it.
                let range = Board.holdRange(now: now)
                let at = shown.at ?? Board.holdFirstTime(now: now)
                holdRow(Board.holdUntilLabel) {
                    DatePicker(Board.holdAtSpoken, selection: Binding(get: { at }, set: { v in edit { $0.at = v } }),
                               in: min(range.lowerBound, at)...max(range.upperBound, at), displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden()
                        .frame(minHeight: 44)
                        .accessibilityInputLabels([Board.holdUntilLabel, Board.holdAtSpoken])
                        .accessibilityIdentifier("taskpage.hold.at")
                }
                // Not twice: a Save pressed as it passed says it too.
                if late && model.holdSay != Board.holdAhead {
                    Text(Board.holdAhead).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: Board.holdAhead) }
                }
            }
            holdRow(Board.holdWhyLabel) {
                // Capped after it is written, as the page's other boxes: capped in the setter, nothing changes at the limit, so
                // nothing is drawn again and the box keeps words that are not sent.
                TextField(Board.holdWhyPrompt, text: Binding(get: { shown.why }, set: { v in if v != (holdDraft ?? stored).why { edit { $0.why = v } } }))
                .onChange(of: shown.why) { v in
                    let kept = Board.capped(v, Board.holdWhyMax)
                    if kept != v, holdDraft != nil { holdDraft?.why = kept }
                }
                .submitLabel(.done)
                .frame(minHeight: 44)
                .padding(.horizontal, 8)
                .background(RoundedRectangle(cornerRadius: 8).stroke(Palette.secondary.opacity(0.4), lineWidth: 1))
                .accessibilityLabel(Board.holdWhySpoken)
                .accessibilityInputLabels([Board.holdWhyLabel, Board.holdWhySpoken])
                .accessibilityIdentifier("taskpage.hold.why")
            }
            if !p.onHoldByPerson && model.holdShown == nil {
                Text(Board.holdTakeover(forPerson: p.onHoldForPerson, paused: p.projectPaused)).font(.footnote).foregroundColor(Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 12) {
                Button {
                    model.touched()
                    // A correction the keyboard still holds is written as the box is left, before what is sent is read.
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                    Task {
                        // Read together: a read landing between the two would leave the choice against another hold.
                        let (choice, base) = (holdDraft ?? stored, holdBase ?? stored)
                        // Saved: the form shows what is stored, or what was saved while that has not been read (holdShown).
                        if await model.saveHold(choice, base: base, names: names), holdDraft == choice { holdDraft = nil; holdBase = nil }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if model.holdFormSaving { SweepDots(scales: false) }
                        Text("Save").font(.footnote.weight(.semibold)).foregroundColor(Palette.link)
                    }
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(off)
                .opacity(off ? 0.5 : 1)
                .accessibilityLabel(Board.holdSaveSpoken)
                .accessibilityInputLabels(["Save", Board.holdSaveSpoken])
                .accessibilityValue(model.holdFormSaving ? "In progress" : "")
                .accessibilityIdentifier("taskpage.hold.save")
                if !Board.holdSame(shown, stored) {
                    dueAction("Cancel", label: "Cancel the change to this hold", busy: model.holding) { model.clearHoldFormSay(); holdDraft = nil; holdBase = nil }
                }
            }
            if model.holdSayAtForm { holdLine }
        }
        .disabled(model.holdFormSaving)
    }
    // One under the other at the accessibility sizes, where a line has no room for both.
    private func holdRow<C: View>(_ label: String, @ViewBuilder _ control: () -> C) -> some View {
        let row = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        return row {
            // Hidden from VoiceOver: the control's own label says it, so it is not read twice.
            Text(label).font(.footnote).foregroundColor(Palette.secondary).accessibilityHidden(true)
            control()
        }
    }

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.footnote.weight(.semibold)).foregroundColor(Palette.secondary).textCase(.uppercase)
            .accessibilityAddTraits(.isHeader)
    }

    private func whoBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Who is on it")
            ForEach(p.partLines(roster: roster)) { part in
                partRow(p, part)
            }
            if let why = p.whyLine(roster: roster) {
                Text(why).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            addPart
            if !model.partAtHold || p.closed { partLine }
        }
    }

    // What the last part write said, by the control it was made with.
    @ViewBuilder private var partLine: some View {
        if let say = model.partSay {
            Text(say).font(.footnote).foregroundColor(model.partRefused ? Palette.dangerWord : Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .id("part:" + say)
                .onAppear { UIAccessibility.post(notification: .announcement, argument: say) }
        }
    }

    // Any press or save that another must not run beside.
    private var busy: Bool { model.pressing || model.holding || model.repeatSaving || model.reviewerSaving != nil || model.partWriting != nil }

    private func write(_ w: Board.PartWrite, atHold: Bool = false) async -> Bool {
        // The roster alone: the model keeps this while a write is unsettled, and must not keep the view (and so itself).
        let roster = self.roster
        return await model.writePart(w, atHold: atHold, name: { $0.name($1, roster: roster) }, names: names)
    }
    private func choosing(_ part: String) -> Bool {
        if case .who(let id, _, _) = model.partWriting { return id == part }
        return false
    }

    // kosmos#8958 slice B7: one part. On an open task an open part's name is the menu of who is on it (the board's
    // tkwho-pick); the Done or Put back beside it is the board's on any task.
    private func partRow(_ p: Board.TaskPage, _ part: Board.TaskPage.PartLine) -> some View {
        let what = part.line ?? part.who
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                if part.done || p.closed {
                    Text(part.who).font(.body.weight(.semibold)).strikethrough(part.done).foregroundColor(part.done ? Palette.secondary : Palette.primary)
                        .accessibilityLabel(part.who + (part.done ? ", done" : ""))
                } else if p.memberOrder.isEmpty {
                    // Nobody to pick, and where they come from (the board's line).
                    Button {
                        model.touched()
                        // The line already there is not drawn again, so it is said again.
                        if model.partSay == Board.partNoMembers { UIAccessibility.post(notification: .announcement, argument: Board.partNoMembers) }
                        model.sayNoMembers()
                    } label: { partName(part.who, busy: false) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Change who is on this part")
                        .accessibilityValue(part.who)
                        .accessibilityInputLabels([part.who, "Change who is on this part"])
                } else {
                    whoMenu(p, part: part.id, session: part.session) { partName(part.who, busy: choosing(part.id)) }
                        .accessibilityLabel("Change who is on this part")
                        // Which part, when its words are not the task's: two with nobody on them would sound alike.
                        .accessibilityValue(([part.who] + [part.line].compactMap { $0 } + (choosing(part.id) ? ["in progress"] : [])).joined(separator: ", "))
                        .accessibilityInputLabels([part.who, "Change who is on this part"])
                        .accessibilityIdentifier("taskpage.part.who")
                }
                if let line = part.line { Text(line).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true) }
                if let say = part.say { Text(say).font(.footnote.italic()).foregroundColor(Palette.secondary) }
            }
            // One thing to VoiceOver where there is nothing in it to press.
            .accessibilityElement(children: part.done || p.closed ? .combine : .contain)
            Spacer(minLength: 8)
            let act: Board.PartWrite = part.done ? .reopen(part: part.id) : .close(part: part.id)
            Button { model.touched(); Task { _ = await write(act) } } label: {
                HStack(spacing: 8) {
                    if model.partWriting == act { SweepDots(scales: false) }
                    Text(Board.partActTitle(done: part.done)).font(.footnote).foregroundColor(Palette.link)
                }
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .opacity(busy && model.partWriting != act ? 0.6 : 1)
            .accessibilityLabel(Board.partActTitle(done: part.done) + ", " + what)
            .accessibilityValue(model.partWriting == act ? "In progress" : "")
        }
    }

    private func partName(_ words: String, busy: Bool) -> some View {
        HStack(spacing: 4) {
            if busy { SweepDots(scales: false) }
            Text(words).font(.body.weight(.semibold)).foregroundColor(Palette.link)
            Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundColor(Palette.link).accessibilityHidden(true)
        }
        .frame(minHeight: 44).contentShape(Rectangle())
    }

    // Saved on choosing, as the board's; leaving without choosing sends nothing.
    private func whoMenu<L: View>(_ p: Board.TaskPage, part: String, session: String?, atHold: Bool = false, @ViewBuilder label: () -> L) -> some View {
        Menu {
            ForEach(Board.partOptions(p, session: session, roster: roster), id: \.self) { o in
                Button {
                    model.touched()
                    Task { _ = await write(.who(part: part, o.value, was: session), atHold: atHold) }
                } label: {
                    if o.value == session { Label(o.words, systemImage: "checkmark") } else { Text(o.words) }
                }
            }
        } label: { label() }
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }

    // The board's Choose who, under the line after Take off hold: for the first open part nobody is on.
    @ViewBuilder private func chooseWho(_ p: Board.TaskPage) -> some View {
        let free = p.parts.first { !$0.closed && $0.who == nil }
        let out = free.map { choosing($0.id) } ?? false
        let label = HStack(spacing: 8) {
            if out { SweepDots(scales: false) }
            Text(Board.holdChoose).font(.footnote.weight(.semibold)).foregroundColor(Palette.link)
        }
        .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
        if p.memberOrder.isEmpty {
            Button { model.touched(); model.sayNoMembersOnHold() } label: { label }.buttonStyle(.plain)
        } else if let free {
            whoMenu(p, part: free.id, session: nil, atHold: true) { label }
                .accessibilityValue(out ? "In progress" : "")
                .accessibilityIdentifier("taskpage.hold.choose")
        }
    }

    private var addPart: some View {
        let adding = model.partWriting.map { if case .add = $0 { return true } else { return false } } ?? false
        let empty = newPart.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(spacing: 8) {
            TextField(Board.partAdd, text: $newPart)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Palette.card))
                .accessibilityLabel(Board.partAddLabel)
                .submitLabel(.done)
                .onSubmit { add() }
                .onChange(of: newPart) { t in let c = Board.capped(t, Board.partAddMax); if c != t { newPart = c } }
            Button { add() } label: {
                HStack(spacing: 8) {
                    if adding { SweepDots(scales: false) }
                    Text("Add").font(.body.weight(.semibold)).foregroundColor(Palette.link)
                }
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy || empty)
            .opacity((busy && !adding) || empty ? 0.6 : 1)
            .accessibilityLabel("Add this part")
            .accessibilityInputLabels(["Add", "Add this part"])
            .accessibilityValue(adding ? "In progress" : "")
        }
    }

    // Words typed while it was on its way are the next part's.
    private func add() {
        model.touched()
        let words = newPart
        Task { if await write(.add(words)), newPart == words { newPart = "" } }
    }

    private func subtasksBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionTitle("Subtasks")
            if p.subtasks.isEmpty {
                Text(Board.subtasksNone).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(p.subtasks) { s in
                Button { openSub = s.number } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("#\(s.number)").font(.footnote.monospacedDigit()).foregroundColor(Palette.secondary)
                        Text(s.sentence).font(.body).foregroundColor(Palette.primary).multilineTextAlignment(.leading)
                        Spacer(minLength: 8)
                        Text(s.status).font(.footnote).foregroundColor(s.status == "Built" ? Palette.built : Palette.secondary)
                        Image(systemName: "chevron.right").font(.footnote).foregroundColor(Palette.tertiary)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Task \(s.number), \(s.sentence), \(s.status)")
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Opens task \(s.number).")
            }
            // kosmos#8958 slice B6: the board's tk-subadd, on a finished task too.
            Button {
                model.touched()
                subAdded = nil
                adding = NewTaskStart(picked: ref.project)
                // What was there before a create is read from this list, which the Projects tab does not keep fresh.
                Task { await client.refreshTasks() }
            } label: {
                Text(Board.subtaskAdd).font(.footnote).foregroundColor(Palette.link)
                    .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // A subtask made while they are being closed would be left open under this task.
            .disabled(model.closingSubtasks)
            .opacity(model.closingSubtasks ? 0.6 : 1)
            .accessibilityLabel("Add subtask")
            if let line = subAdded { Text(line).font(.footnote).foregroundColor(Palette.secondary) }
        }
    }

    private func keepSub() {
        Self.subKept.set(ref.project, ref.number, epoch: client.chatEpoch, NewTask.Kept(draft: subDraft, held: subHeld))
    }

    // The line after a create, and the task read again so its list has the new one (the sheet says the line aloud).
    private func subLine(_ line: String) {
        subAdded = line
        Task { await model.read(); await model.readActivity(names: names); await client.refreshTasks() }
    }

    // A subtask that got "could not tell" is in a Tasks read: it was made (TasksTab.heldFound).
    private func subFound(in read: Board.TasksRead) {
        guard let h = subHeld, let number = NewTask.found(h.sent, in: read, before: h.before) else { return }
        if NewTask.heldBack(subDraft, by: h) {
            adding = nil
            subDraft = NewTask.Draft()
        }
        subHeld = nil
        let line = Board.subtaskAddedLine(number: number)
        subLine(line)
        // The same task can be open under another tab: the page in front says it.
        guard visible else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { UIAccessibility.post(notification: .announcement, argument: line) }
    }

    // kosmos#8958 slice B1: the board's tk-editform. Save sends only what changed from the words the form opened with;
    // a refusal keeps the form open with the Mac's words.
    private var editSheet: some View {
        NavigationView {
            Form {
                Section(Board.taskEditTitle) {
                    // One line, as the board's text input (Return does not add a line break to a title).
                    TextField(Board.taskEditTitle, text: $editTitle)
                        .onChange(of: editTitle) { t in let c = Board.capped(t, Board.taskEditTitleMax); if c != t { editTitle = c } }
                }
                Section(Board.taskEditDetail) {
                    TextField(Board.taskEditDetail, text: $editDetail, axis: .vertical)
                        .lineLimit(3...12)
                        .onChange(of: editDetail) { t in let c = Board.capped(t, Board.taskEditDetailMax); if c != t { editDetail = c } }
                }
                if let why = model.editRefusal {
                    Text(why).font(.footnote).foregroundColor(Palette.dangerWord)
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: why) }
                }
            }
            .navigationTitle("Task \(ref.number)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Off while a save is out, so a late answer can never close a form opened after it (the board's data-gen).
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.clearEditRefusal(); editing = nil }.disabled(model.editSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let opened = editing else { return }
                        let (t, d) = (editTitle, editDetail)
                        let before = model.editRefusal
                        Task {
                            if await model.saveText(title: t, detail: d, openedTitle: opened.title, openedDetail: opened.detail, names: names) { editing = nil }
                            // An empty title refused while a line already shows never leaves the line (it is set in the
                            // same turn), so it would not be heard: say it. A refusal from the Mac clears the line first
                            // and is heard anyway.
                            else if let why = model.editRefusal, why == Board.taskEditNeedsTitle, before != nil {
                                UIAccessibility.post(notification: .announcement, argument: why)
                            }
                        }
                    }
                    .disabled(model.editSaving)
                    .accessibilityLabel("Save title and detail")
                }
            }
        }
        .interactiveDismissDisabled(model.editSaving)
    }

    // kosmos#8958 slice B1: the board's Due row (saveTaskDue). The picker chooses a date; Set saves it, Cancel puts it
    // back; Clear clears a stored date. With no date, Set a due date opens the picker on a week from today, unsaved.
    // Which of these shows is Board.dueControls (tested in LogicTests/taskpage). The picker is one view in one place for
    // every state, so choosing a day (which turns Clear into Set and Cancel) does not rebuild it and close its calendar.
    private func dueBlock(_ p: Board.TaskPage) -> some View {
        let controls = Board.dueControls(stored: p.dueDate, draft: dueDraft)
        let shown: String? = { switch controls { case .choosing(let d), .stored(let d): return d; default: return nil } }()
        return VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Due")
            if let shown {
                DatePicker("Due date", selection: Binding(get: { Board.dueDay(shown) ?? Date() }, set: { d in
                    model.touched()
                    dueDraft = Board.keptDraft(Board.dueString(d), stored: p.dueDate)
                }), displayedComponents: .date)
                    .labelsHidden()
                    .disabled(model.dueSaving)
            }
            HStack(spacing: 12) {
                switch controls {
                case .choosing(let d):
                    dueAction("Set", label: "Set the due date", strong: true) {
                        Task { if await model.setDue(d, names: names) { dueDraft = nil } }
                    }
                    dueAction("Cancel", label: "Cancel the new due date") { model.clearDueRefusal(); dueDraft = nil }
                case .stored:
                    dueAction("Clear", label: "Clear the due date") { dueDraft = nil; Task { await model.setDue(nil, names: names) } }
                case .unreadable(let raw):
                    // A stored date this phone cannot read as a day: said as the Mac keeps it, and it can still be cleared.
                    Text("Due " + raw).font(.footnote).foregroundColor(Palette.primary)
                    dueAction("Clear", label: "Clear the due date") { Task { await model.setDue(nil, names: names) } }
                case .none:
                    Button {
                        model.touched()
                        dueDraft = Board.dueString(Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date())
                    } label: {
                        Text("Set a due date").font(.footnote).foregroundColor(Palette.link)
                            .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let why = model.dueRefusal {
                Text(why).font(.footnote).foregroundColor(Palette.dangerWord).fixedSize(horizontal: false, vertical: true)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: why) }
            }
        }
        // The stored day moved (another device): a draft it now equals is dropped.
        .onChange(of: p.dueDate) { stored in dueDraft = Board.keptDraft(dueDraft, stored: stored) }
    }

    // kosmos#8958 slice B3: the board's Repeats controls (tk-repeat-*) on an open task: how often, and when (a time, a
    // day and a time, or a number of minutes); Save sends the choice when it differs from the stored rule. The line
    // under them is the board's own sentence (Tasks.repeatSentence), red while a run is missed, and under that who is
    // told when one is (reviewerRow, slice B3b).
    private func repeatBlock(_ p: Board.TaskPage) -> some View {
        let stored = p.repeatStored
        let storedShown = Board.repeatShown(stored, box: repeatBox)
        let shown = repeatDraft ?? storedShown
        let wire = shown.map(Board.repeatWire)
        let unchanged = wire == stored.map(Board.repeatWire)
        let edit = { (change: (inout Board.RepeatChoice) -> Void) in
            guard var c = repeatDraft ?? storedShown else { return }
            if repeatDraft == nil { repeatDraftBase = stored }
            model.touched()
            model.clearRepeatSay()
            change(&c)
            // Kept as the person set it, even when it is now the stored rule (Save then turns off): dropping it here would
            // put the stored rule back under their fingers, so typing 60 minutes would become Every hour mid-edit.
            repeatDraft = c
        }
        return VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Repeats")
            if let shown {
                Picker("How often this task repeats", selection: Binding(get: { shown.every }, set: { v in edit { $0.every = v } })) {
                    ForEach(Board.RepeatEvery.allCases, id: \.self) { Text($0.words).tag($0) }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .accessibilityLabel("How often this task repeats")
                .tint(Palette.link)
                .frame(minHeight: 44)
                .disabled(model.repeatSaving)
                .accessibilityIdentifier("taskpage.repeat.every")
                switch shown.every {
                case .minutes:
                    HStack(spacing: 8) {
                        // Read back live, never the value caught when this was last drawn (`shown`): on a slow phone that one is a key
                        // behind, and the box is put back to it, losing what was typed since.
                        TextField("30", text: Binding(get: { (repeatDraft ?? Board.repeatShown(p.repeatStored, box: repeatBox))?.minutes ?? "" }, set: { v in edit { $0.minutes = v } }))
                            .keyboardType(.numberPad)
                            .frame(minWidth: 80, minHeight: 44)
                            .fixedSize()
                            .padding(.horizontal, 8)
                            .background(RoundedRectangle(cornerRadius: 8).stroke(Palette.secondary.opacity(0.4), lineWidth: 1))
                            .accessibilityLabel("When: every how many minutes")
                            .accessibilityIdentifier("taskpage.repeat.minutes")
                        Text("minutes").font(.footnote).foregroundColor(Palette.secondary)
                    }
                    .disabled(model.repeatSaving)
                case .day, .week:
                    HStack(spacing: 12) {
                        if shown.every == .week {
                            Picker("When: day of the week", selection: Binding(get: { shown.on }, set: { v in edit { $0.on = v } })) {
                                ForEach(Board.repeatDays, id: \.key) { Text($0.words).tag($0.key) }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                            .accessibilityLabel("When: day of the week")
                            .tint(Palette.link)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("taskpage.repeat.day")
                        }
                        DatePicker("When: time of day", selection: Binding(get: { Board.repeatTime(shown.at) }, set: { d in
                            edit { $0.at = Board.repeatTimeString(d) }
                        }), displayedComponents: .hourAndMinute)
                            .labelsHidden()
                            .frame(minHeight: 44)
                            .environment(\.timeZone, Board.repeatClock.timeZone)
                            .accessibilityIdentifier("taskpage.repeat.time")
                    }
                    .frame(minHeight: 44)
                    .disabled(model.repeatSaving)
                default:
                    EmptyView()
                }
                HStack(spacing: 12) {
                    let ready = wire.flatMap { Board.repeatBody($0) } != nil && !unchanged
                    Button {
                        model.touched()
                        guard let wire else { return }
                        Task {
                            // Saved: the draft goes once the page reads the saved rule; if that read failed, the controls
                            // keep showing what was saved rather than the rule from before it.
                            // The box's time is kept before the save's reads, which change the stored rule mid-save, so the
                            // box never shows the sorted first time in between (the board's tkRepeatSaved runs before its
                            // reload). A save that was not recorded forgets it again.
                            repeatBox = shown.every == .day ? shown.at : nil
                            if await model.saveRepeat(wire, names: names) {
                                repeatDraft = Board.keptRepeatDraft(repeatDraft, stored: model.page?.repeatStored)
                            } else {
                                repeatBox = nil
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if model.repeatSaving { SweepDots(scales: false) }
                            Text("Save").font(.footnote.weight(.semibold)).foregroundColor(Palette.link)
                        }
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!ready || model.repeatSaving || model.reviewerSaving != nil || model.pressing || model.partWriting != nil)
                    .opacity(!ready || model.repeatSaving || model.reviewerSaving != nil || model.pressing || model.partWriting != nil ? 0.5 : 1)
                    .accessibilityLabel("Save how this task repeats")
                    .accessibilityIdentifier("taskpage.repeat.save")
                    if repeatDraft != nil && !unchanged {
                        dueAction("Cancel", label: "Cancel the change to how this task repeats", busy: model.repeatSaving) { model.clearRepeatSay(); repeatDraft = nil }
                    }
                }
                if let need = wire.flatMap(Board.repeatNeeds) {
                    // .id: a changed line is a new view, so it is announced even when no line was gone in between.
                    Text(need).font(.footnote).foregroundColor(Palette.secondary)
                        .id("need:" + need)
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: need) }
                } else if let say = model.repeatSay {
                    Text(say).font(.footnote).foregroundColor(model.repeatRefused ? Palette.dangerWord : Palette.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .id("say:" + say)
                        .onAppear { UIAccessibility.post(notification: .announcement, argument: say) }
                }
            } else {
                Text(Board.repeatOnBoard).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let row = p.repeatRow {
                Text(Tasks.repeatSentence(row, now: Date()) { p.name($0, roster: roster) })
                    .font(.footnote)
                    .foregroundColor(Tasks.repeatMissed(row).isEmpty ? Palette.secondary : Palette.dangerWord)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("taskpage.repeat.line")
            }
            // kosmos#8958 slice B9: the board's tk-wake-line, here as there.
            if let wake = p.wakeLine {
                Text(wake).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("taskpage.wake")
            }
            if p.repeatRow != nil { reviewerRow(p) }
        }
        // The stored rule moved (another device, an agent): a draft it now equals is dropped, and a daily edit's other
        // times follow it.
        .onChange(of: p.repeatStored) { s in
            // A rule changed by anything but this phone's own save shows as the board shows it, box on its first time.
            if !model.repeatSaving { repeatBox = nil }
            repeatDraft = Board.followStored(repeatDraft, old: repeatDraftBase, new: s)
            repeatDraftBase = s
        }
    }

    // kosmos#8958 slice B3b: the board's "If missed, tell" (tk-review-who), under the repeat line of a task whose rule is
    // stored: Nobody (nothing is said), Me (the task waits in Needs Your Decision), or an agent on the project (one line
    // in its session), once per missed run. Saved on change, as the board's; while it is out, the choice sent shows, and
    // after a save whose read failed, the choice saved (model.reviewerShown).
    private func reviewerRow(_ p: Board.TaskPage) -> some View {
        let options = Board.reviewerOptions(p, roster: roster)
        let shown = model.reviewerSaving ?? model.reviewerShown ?? p.repeatReviewer
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                // Hidden from VoiceOver: the menu's own label says it, so it is not read twice.
                Text("If missed, tell").font(.footnote).foregroundColor(Palette.secondary).accessibilityHidden(true)
                Picker("Who is told if a run is missed", selection: Binding(get: { shown }, set: { want in
                    model.touched()
                    Task { _ = await model.saveReviewer(want, names: names) }
                })) {
                    ForEach(options, id: \.self) { Text($0.words).tag($0.value) }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .accessibilityLabel("Who is told if a run is missed")
                // Voice Control: the words on screen work as well as the spoken label.
                .accessibilityInputLabels(["If missed, tell", "Who is told if a run is missed"]
                    + [options.first { $0.value == shown }?.words].compactMap { $0 })   // and the choice the menu shows
                .tint(Palette.link)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                .disabled(model.reviewerSaving != nil || model.repeatSaving || model.pressing || model.partWriting != nil)
                .accessibilityIdentifier("taskpage.repeat.reviewer")
                // The choice itself, said as the value (an empty value would hide it), and that it is saving while it is.
                .accessibilityValue([options.first { $0.value == shown }?.words ?? shown, model.reviewerSaving != nil ? "in progress" : nil]
                    .compactMap { $0 }.joined(separator: ", "))
                if model.reviewerSaving != nil { SweepDots(scales: false) }
            }
            if let say = model.reviewerSay {
                Text(say).font(.footnote).foregroundColor(model.reviewerRefused ? Palette.dangerWord : Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .id("reviewer:" + say)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: say) }
            }
        }
    }

    // `busy` is the section's own save in flight (the due date's, unless another section names its own).
    private func dueAction(_ words: String, label: String, strong: Bool = false, busy: Bool? = nil, _ run: @escaping () -> Void) -> some View {
        Button { model.touched(); run() } label: {
            Text(words).font(strong ? .footnote.weight(.semibold) : .footnote).foregroundColor(Palette.link)
                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy ?? model.dueSaving)
        .accessibilityLabel(label)
    }

    // kosmos#8958 slice B1: the board's message box under the activity (tk-say): recorded on the task and sent to its
    // assignees; the line under it says who it did not reach, or why it was not recorded.
    private func sayBlock(_ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(Board.taskSayPlaceholder, text: $sayText, axis: .vertical)
                    .lineLimit(1...5)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Palette.card))
                    .accessibilityLabel(Board.taskSayLabel)
                    .onChange(of: sayText) { t in let c = Board.capped(t, Board.taskSayMax); if c != t { sayText = c } }
                Button {
                    model.touched()
                    let words = sayText
                    Task { if await model.say(words, name: { p.name($0, roster: roster) }, names: names), sayText == words { sayText = "" } }
                } label: {
                    Text("Send").font(.body.weight(.semibold)).foregroundColor(Palette.link)
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Send this message on the task")
                .disabled(model.saying || sayText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            Text(Board.taskSayNote).font(.caption).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            if let line = model.sayLine {
                Text(line).font(.footnote).foregroundColor(model.sayRefused ? Palette.dangerWord : Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .onAppear { UIAccessibility.post(notification: .announcement, argument: line) }
            }
        }
    }

    @ViewBuilder private var activityBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("Activity")
            if let rows = model.activity {
                if rows.isEmpty {
                    Text(Board.activityEmpty).font(.footnote).foregroundColor(Palette.secondary)
                }
                // Lazily: a repeating task's history can run long, and only what is on screen is laid out.
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            if row.folded.isEmpty {
                                activityRow(row)
                            } else {
                                // kosmos#8958 slice B9: the runs a row folds (the board's tkact-roll), opened and closed here.
                                let open = runsOpen.contains(row.id)
                                Button { if open { runsOpen.remove(row.id) } else { runsOpen.insert(row.id) } } label: {
                                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                                        activityRow(row)
                                        Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption).foregroundColor(Palette.secondary).accessibilityHidden(true)
                                    }
                                    .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityValue(open ? "expanded" : "collapsed")
                                .accessibilityInputLabels([row.text])
                            }
                            if let n = row.task { taskLink("Open task \(n)", n) }
                        }
                        // Beside the row, not inside it: inside, every run of a long fold would be laid out at once.
                        if runsOpen.contains(row.id) {
                            ForEach(row.folded) { activityRow($0).padding(.leading, 16) }
                        }
                    }
                }
            } else if model.activityFailed {
                Text(Board.activityUnread).font(.footnote).foregroundColor(Palette.secondary)
            }
        }
    }

    private func activityRow(_ row: Board.ActivityRow) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let at = row.at {
                // Secondary, not tertiary: small text needs AA contrast in dark mode too.
                Text(Tasks.agoWords(Date().timeIntervalSince(at) * 1000)).font(.caption).foregroundColor(Palette.secondary)
            }
            Text(row.text).font(.subheadline).foregroundColor(Palette.primary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    // kosmos#8958 slice B4: the board's tk-receipt, under a closed task's activity. The put-back line ends the history
    // above it, then the receipt, then its undo (slice B5).
    private func receiptBlock(_ r: Board.Receipt, _ p: Board.TaskPage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let again = r.again {
                Text(again).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
            sectionTitle("Receipt")
            Text(Board.receiptIntro).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            if r.agents.isEmpty {
                Text(Board.receiptNobody).font(.footnote).foregroundColor(Palette.secondary)
            }
            ForEach(r.agents) { receiptAgent($0, name: p.name($0.who, roster: roster)) }
            if let done = model.undoDone {
                Text(done).font(.footnote).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
            } else if let plan = model.undoPlan {
                Button {
                    model.touched()
                    model.openUndo()
                    undoChosen = Set(plan.files.filter(\.chosen).map(\.path))
                    undoList = plan
                    undoOpen = true
                } label: {
                    Text(Board.undoOpen).font(.footnote).foregroundColor(Palette.link)
                        .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(model.pressing || model.partWriting != nil)
            }
        }
    }

    // kosmos#8958 slice B5: the board's tk-undo list: each file with what will happen to it or why it is left, chosen as the
    // board chooses them; "Undo the chosen files" does it, and Cancel or a swipe down leaves everything as it is.
    private var undoSheet: some View {
        NavigationView {
            Form {
                Section {
                    ForEach(undoList.files) { f in
                        Toggle(isOn: Binding(get: { undoChosen.contains(f.path) }, set: { on in
                            model.touched()
                            model.clearUndoSay()
                            if on { undoChosen.insert(f.path) } else { undoChosen.remove(f.path) }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.shown).font(.body).foregroundColor(f.choosable ? Palette.primary : Palette.secondary)
                                Text(f.why).font(.footnote).foregroundColor(Palette.secondary)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(minHeight: 44)
                        .disabled(!f.choosable || model.undoing)
                    }
                } header: {
                    Text(Board.undoIntro).font(.footnote).foregroundColor(Palette.secondary).textCase(nil)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Section {
                    Button {
                        model.touched()
                        let list = undoList
                        let paths = list.files.filter { $0.choosable && undoChosen.contains($0.path) }.map(\.path)
                        let before = model.undoSay
                        Task {
                            await model.undo(paths, of: list, names: names)
                            // A line this phone says itself, said twice running, is set in one turn, so it would not be heard
                            // again. The Mac's answers clear the line first and are heard anyway.
                            if let say = model.undoSay, say == before, say == Board.undoChoose || say == Board.undoClosedAgain {
                                UIAccessibility.post(notification: .announcement, argument: say)
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if model.undoing { SweepDots(scales: false) }
                            Text(Board.undoGo).font(.body.weight(.semibold)).foregroundColor(Palette.link)
                        }
                        .frame(minHeight: 44)
                    }
                    .disabled(model.undoing)
                    .accessibilityValue(model.undoing ? "In progress" : "")
                    if let say = model.undoSay {
                        Text(say).font(.footnote).foregroundColor(model.undoRefused ? Palette.dangerWord : Palette.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .id("undo:" + say)
                            .onAppear { UIAccessibility.post(notification: .announcement, argument: say) }
                    }
                }
            }
            .navigationTitle(Board.undoTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { undoOpen = false; model.leaveUndo() }.disabled(model.undoing) }
            }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(model.undoing)
    }

    private func receiptAgent(_ a: Board.ReceiptAgent, name: String) -> some View {
        let open = receiptFilesOpen.contains(a.id)
        return VStack(alignment: .leading, spacing: 4) {
            Text(name).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
            Text(a.line).font(.footnote).foregroundColor(a.muted ? Palette.secondary : Palette.primary).fixedSize(horizontal: false, vertical: true)
            if !a.prs.isEmpty {
                Text(Self.receiptPRWords(a)).font(.footnote).foregroundColor(Palette.primary).tint(Palette.link)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let title = a.filesTitle {
                Button {
                    model.touched()
                    if open { receiptFilesOpen.remove(a.id) } else { receiptFilesOpen.insert(a.id) }
                } label: {
                    HStack(spacing: 4) {
                        Text(title).font(.footnote).foregroundColor(Palette.link)
                        Image(systemName: open ? "chevron.down" : "chevron.right").font(.caption2).foregroundColor(Palette.link)
                    }
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(title + ", " + name)
                .accessibilityInputLabels([title, title + ", " + name])
                .accessibilityValue(open ? "expanded" : "collapsed")
                if open {
                    ForEach(Array(a.files.enumerated()), id: \.offset) { _, f in
                        Text(f).font(.footnote).foregroundColor(Palette.primary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            // As the board: the folder is the open list's foot, or the line itself when there is no list.
            if let folder = a.folder, a.filesTitle == nil || open {
                Text("In " + folder).font(.footnote).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private static func receiptPRWords(_ a: Board.ReceiptAgent) -> AttributedString {
        var words = AttributedString(a.prsBefore)
        for (i, pr) in a.prs.enumerated() {
            if i > 0 { words += AttributedString(", ") }
            var label = AttributedString(pr.label)
            label.link = pr.url
            words += label
        }
        return words + AttributedString(a.prsAfter)
    }

    #if DEBUG
    // The sample Mac (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), matching Today's and Tasks' sample tasks, so a
    // screenshot never shows a real account. A press closes or reopens the sample task for real (in memory).
    // Locked: the sample Mac is called off the main actor, by the loop, a press and a seen mark at once.
    private static let sampleLock = NSLock()
    private static var sampleClosed: [Int: String] = [:]   // when, so its receipt is asked for once
    // kosmos#8958 slice B1: messages said on the sample tasks, shown in their activity as the Mac records them.
    private static var sampleSaid: [Int: [String]] = [:]
    // A title edited on a sample task (POST .../text), served back by the next read.
    private static var sampleTitle: [Int: String] = [:]
    // A due date set or cleared on a sample task (POST .../due), served back by the next read ("" for cleared).
    private static var sampleDue: [Int: String] = [:]
    // kosmos#8958 slice B5: the files undone on a sample task (POST .../undo), said in its activity; nothing is undone before.
    private static var sampleUndone: [Int: Int] = [:]
    // kosmos#8958 slice B3: a sample task's repeat rule and words for it in the board's shape (POST .../repeat; only the
    // hourly words and task 4's starting words are written as the board's describe says them), served back by
    // the next read. Task 4 starts on twice a day, the case where the controls keep a second time.
    private static var sampleRepeat: [Int: (rule: String, words: String)] = [4: (#"{"every":"day","at":["09:00","17:00"]}"#, "every day at 9am and 5pm")]
    private static func sampleRule(_ body: [String: Any]) -> (rule: String, words: String)? {
        let at = body["at"] as? String ?? ""
        switch body["every"] as? String {
        case "hour": return (#"{"every":"hour"}"#, "every hour")
        case "minutes": return (#"{"every":"minutes","n":"# + (Int(at).map(String.init) ?? "30") + "}", "every " + at + " minutes")
        case "day":
            let list = at.split(separator: ",").map { "\"" + $0 + "\"" }.joined(separator: ",")
            return (#"{"every":"day","at":["# + list + "]}", "every day at " + at)
        case "week":
            let on = body["on"] as? String ?? "mon"
            let day = Board.repeatDayOfNumber.firstIndex(of: on) ?? 1
            return (#"{"every":"week","day":"# + String(day) + #","at":""# + at + #""}"#, "every week on " + on + " at " + at)
        default: return nil
        }
    }
    // kosmos#8958 slice B7: the sample task 4's parts (POST .../parts and .../part/<id>/...), served back by the next read.
    private static var sampleParts: [(id: Int, who: String?, sentence: String, closed: Bool)] = [(1, "dana", "Pages 1 to 8", false)]
    private static func samplePart(_ path: String, _ body: [String: Any]) {
        if path.hasSuffix("/task/4/parts") { sampleParts.append((sampleParts.count + 1, nil, body["sentence"] as? String ?? "", false)) }
        guard path.contains("/task/4/part/"), let id = Int(URL(fileURLWithPath: path).deletingLastPathComponent().lastPathComponent),
              let i = sampleParts.firstIndex(where: { $0.id == id }) else { return }
        if path.hasSuffix("/who") { sampleParts[i].who = body["who"] as? String }
        else { sampleParts[i].closed = path.hasSuffix("/close") }
    }
    // kosmos#8958 slice B8: the sample task 4's hold (POST .../hold), served back by the next read.
    private static var sampleHold: [String: Any]?
    private static func sampleHolding(_ body: [String: Any]) {
        guard body["onHold"] as? Bool == true else { sampleHold = nil; return }
        var h: [String: Any] = ["onHold": true, "onHoldByPerson": true]
        h["onHoldBecause"] = body["because"] ?? sampleHold?["onHoldBecause"]
        if let until = body["until"] as? [String: Any] {
            h["onHoldUntil"] = until
            h["holdUntil"] = ["words": (until["at"] as? String) ?? "task #\(until["task"] ?? 0) is closed", "met": false]
        }
        sampleHold = h
    }
    private static func sampleSend(_ build: (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)? {
        guard let r = build(URL(string: "https://sample.invalid")!), let url = r.url else { return nil }
        let path = url.path
        if path.hasSuffix("/message"), let n = Int(url.deletingLastPathComponent().lastPathComponent),
           let words = (r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["text"] as? String {
            sampleLock.withLock { sampleSaid[n, default: []].append(words) }
        }
        if path.hasSuffix("/text"), let n = Int(url.deletingLastPathComponent().lastPathComponent),
           let title = (r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["sentence"] as? String {
            sampleLock.withLock { sampleTitle[n] = title }
        }
        if path.hasSuffix("/due"), let n = Int(url.deletingLastPathComponent().lastPathComponent),
           let body = r.httpBody.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) {
            sampleLock.withLock { sampleDue[n] = body["dueDate"] as? String ?? "" }
        }
        if path.hasSuffix("/repeat"), let n = Int(url.deletingLastPathComponent().lastPathComponent),
           let body = r.httpBody.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) {
            sampleLock.withLock { sampleRepeat[n] = body["clear"] as? Bool == true ? nil : sampleRule(body) }
        }
        if path.hasSuffix("/undo"), r.httpMethod == "POST", let n = Int(url.deletingLastPathComponent().lastPathComponent),
           let body = r.httpBody.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) {
            sampleLock.withLock { sampleUndone[n] = (body["paths"] as? [String] ?? []).count }
        }
        let partsNow: String = sampleLock.withLock {
            if r.httpMethod == "POST", path.contains("/part") {
                samplePart(path, r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
            }
            return sampleParts.map { p in
                #"{"id":\#(p.id),"who":\#(p.who.map(Self.jsonString) ?? "null"),"sentence":\#(Self.jsonString(p.sentence)),"closedAt":\#(p.closed ? #""2026-11-24T16:00:00.000Z""# : "null")}"#
            }.joined(separator: ",")
        }
        let holdNow: String = sampleLock.withLock {
            if r.httpMethod == "POST", path.hasSuffix("/task/4/hold") {
                sampleHolding(r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
            }
            guard let h = sampleHold, let d = try? JSONSerialization.data(withJSONObject: h) else { return "" }
            return String(String(decoding: d, as: UTF8.self).dropFirst().dropLast()) + ","
        }
        let undoneNow: [Int: Int] = sampleLock.withLock { sampleUndone }
        let repeatNow: [Int: (rule: String, words: String)] = sampleLock.withLock { sampleRepeat }
        let dueNow: [Int: String] = sampleLock.withLock { sampleDue }
        let saidNow: [Int: [String]] = sampleLock.withLock { sampleSaid }
        let titleNow: [Int: String] = sampleLock.withLock { sampleTitle }
        let closedNow: [Int: String] = sampleLock.withLock {
            if !path.contains("/part/"), path.hasSuffix("/close") || path.hasSuffix("/reopen") {
                if let n = Int(url.deletingLastPathComponent().lastPathComponent) {
                    // Closing clears its repeat rule and its hold, as the engine does.
                    if path.hasSuffix("/close") { sampleClosed[n] = ISO8601DateFormatter().string(from: Date()); sampleRepeat[n] = nil; if n == 4 { sampleHold = nil } } else { sampleClosed[n] = nil }
                }
            }
            return sampleClosed
        }
        let iso = { (m: Double) in ISO8601DateFormatter().string(from: Date().addingTimeInterval(-m * 60)) }
        func closed(_ n: Int, _ open: String) -> String { closedNow[n] != nil ? #""closedAt":""# + closedNow[n]! + #"","progress":{"done":1,"total":1,"closed":true}"# : open }
        let body: String
        if path.hasSuffix("/projects") {
            body = #"{"projects":[{"id":"springcatalogue","name":"Spring catalogue","paused":false,"agents":[{"sessionName":"dana","name":"Dana"},{"sessionName":"eli","name":"Eli"}],"tasks":["#
                + #"{"number":3,"sentence":"Print-ready catalogue","addedBy":"operator","addedVia":"screen","createdAt":""# + iso(4000) + #"",\#(closed(3, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":[{"id":1,"who":null,"sentence":"Print-ready catalogue"}]},"#
                + #"{"number":4,"sentence":"# + Self.jsonString(titleNow[4] ?? "Pages 1 to 8") + #","detail":"Copy for pages 1 to 8, checked against the **price sheet**. Captions follow the March style guide.","parent":3,"addedBy":"operator","addedVia":"screen","createdAt":""# + iso(2900) + #"","# + (dueNow[4].map { $0.isEmpty ? "" : #""dueDate":"# + Self.jsonString($0) + "," } ?? #""dueDate":"2026-10-30","#) + (repeatNow[4].map { #""repeat":"# + $0.rule + #","repeatWords":"# + Self.jsonString($0.words) + "," } ?? "") + #""builtAt":""# + iso(40) + #"","builtBy":"dana","builtNote":"captions need a check","doneWhen":["Every caption matches the price sheet","The proofs are signed off"],"doneWhenResults":[{"met":true,"how":"checked all eight pages","by":"dana"},{"met":false,"how":"eli has the proofs","by":"dana","movedTo":8}],"wakeWords":"waits for PR #12 in acme/catalogue to merge",\#(holdNow)\#(closed(4, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":["# + partsNow + #"],"claim":{"claimed":true,"about":"dana"}},"#
                + #"{"number":8,"sentence":"Pages 9 to 12","parent":3,"addedBy":"operator","addedVia":"screen","createdAt":""# + iso(2800) + #"",\#(closed(8, #""progress":{"done":0,"total":1,"closed":false}"#)),"parts":[{"id":1,"who":"dana","sentence":"Pages 9 to 12"}]},"#
                + #"{"number":9,"sentence":"Old pages 9 to 12","createdAt":""# + iso(5000) + #"","closedAt":""# + iso(2800) + #"","replacedBy":8,"progress":{"done":1,"total":1,"closed":true},"parts":[{"id":1,"who":null,"sentence":"Old pages 9 to 12"}]}"#
                + #"]}]}"#
        } else if path.contains("/part"), path.hasSuffix("/who"),
                  let who = (r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["who"] as? String {
            body = #"{"heard":{"who":\#(Self.jsonString(who)),"state":"placed"}}"#
        } else if path.hasSuffix("/receipt") {
            // Task 4's, in the shape server.js sends (the price the Mac worked out included); any other task's says nobody held it.
            body = path.contains("/task/4/")
                ? #"{"version":3,"closedAt":""# + iso(0) + #"","retries":{"reopened":1,"handoffs":0},"agents":[{"who":"dana","available":true,"provider":"claude","folder":"/Users/sam/Kosmos/Dana","models":{"claude-opus-5":{"input_tokens":200000,"output_tokens":40000,"cache_creation_input_tokens":0,"cache_read_input_tokens":1000000,"rows":9}},"files":["captions.md","pages-1-8.md"],"filesMore":0,"commands":12,"prs":[{"repo":"acme/catalogue","number":12,"url":"https://github.com/acme/catalogue/pull/12"}],"prsMore":0,"transcriptsWithWork":1,"cost":{"usd":2.5,"unpriced":[]}},{"who":"eli","available":false,"because":"provider","provider":"grok"}]}"#
                : #"{"version":3,"retries":{"reopened":0,"handoffs":0},"agents":[]}"#
        } else if path.hasSuffix("/undo"), path.contains("/task/4/"), r.httpMethod == "POST" {
            let n = undoneNow[4] ?? 0
            body = #"{"done":["# + Array(repeating: #""/Users/sam/Kosmos/Dana/file""#, count: n).joined(separator: ",") + #"],"skipped":[],"savedIn":"/Users/sam/Kosmos/undo-saved/2026-11-24"}"#
        } else if path.hasSuffix("/undo"), path.contains("/task/4/") {
            // Task 4's: one file that goes back, one the agent made, one another agent also edited, and one left as it is.
            let f = { (name: String, rest: String) in #"{"path":"/Users/sam/Kosmos/Dana/"# + name + #"","shown":""# + name + #"",\#(rest)}"# }
            body = #"{"on":true,"ready":true,"savedRoot":"/Users/sam/Kosmos/undo-saved","files":["#
                + [f("captions.md", #""action":"restore","ok":true"#), f("pages-1-8.md", #""action":"move-aside","ok":true"#),
                   f("prices.md", #""action":"restore","ok":false,"why":"shared""#), f("style.md", #""action":"restore","ok":false,"why":"changed-since""#)].joined(separator: ",") + "]}"
        } else if path.hasSuffix("/activity"), path.contains("/task/8/") {
            body = #"{"events":[{"at":""# + iso(4000) + #"","kind":"created"},{"at":""# + iso(300) + #"","kind":"run","by":"dana","unchanged":true,"note":"no new prices"},{"at":""# + iso(200) + #"","kind":"run","by":"eli","unchanged":true}]}"#
        } else if path.hasSuffix("/activity"), path.contains("/task/9/") {
            body = #"{"events":[{"at":""# + iso(2800) + #"","kind":"closed","replacedBy":8}]}"#
        } else if path.hasSuffix("/activity") && !path.contains("/task/4/") {
            body = #"{"events":[{"at":""# + iso(4000) + #"","kind":"created"}]}"#
        } else if path.hasSuffix("/activity") {
            body = #"{"events":[{"at":""# + iso(2900) + #"","kind":"created","who":"dana","parent":3},{"at":""# + iso(300) + #"","kind":"said","text":"Use the March photos for the captions."},{"at":""# + iso(40) + #"","kind":"built","by":"dana","note":"captions need a check"}"#
                + (saidNow[4] ?? []).map { #",{"at":""# + iso(0) + #"","kind":"said","text":"# + Self.jsonString($0) + "}" }.joined()
                + (closedNow[4] != nil ? #",{"at":""# + iso(0) + #"","kind":"closed"}"# : "")
                + (undoneNow[4].map { #",{"at":""# + iso(0) + #"","kind":"undone","files":"# + String($0) + "}" } ?? "") + "]}"
        } else {
            body = "{}"
        }
        return (Data(body.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    private static func jsonString(_ s: String) -> String {
        (try? JSONSerialization.data(withJSONObject: [s])).flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
    #endif

    // A subtask, or the task this one is part of, pushed as its own page.
    private var subOpen: Binding<Bool> { Binding(get: { openSub != nil }, set: { if !$0 { openSub = nil } }) }
    private var subLink: some View {
        NavigationLink(isActive: subOpen, destination: subDestination, label: { EmptyView() }).hidden()
    }
    @ViewBuilder private func subDestination() -> some View {
        if let n = openSub { TaskPageView(client: client, ref: TaskPageRef(project: ref.project, number: n)) }
    }
}
