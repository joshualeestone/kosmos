import SwiftUI
import UIKit

// The native New task sheet (kosmos#7078, gap 2 of #7074), opened from the Tasks tab's toolbar. It draws what
// NewTaskLogic decides, which is the board's New task dialog: the same fields, Create held down until what needs doing,
// how you will know it is done and a project exist, and the Mac's own words when it refuses.
struct NewTaskView: View {
    @ObservedObject var client: BoardClient
    let tasks: Board.TasksRead?        // the Tasks tab's read, for Part of
    let picked: String?                // the Tasks tab's picked project, if any
    // The draft is the Tasks tab's, so closing the sheet keeps it, as the board's Cancel keeps its draft; a
    // create clears it.
    @Binding var draft: NewTask.Draft
    // The words that got "could not tell", kept by the Tasks tab with the draft so closing the sheet does not lift it.
    @Binding var held: NewTask.Held?
    let added: (String) -> Void        // the line the Tasks tab shows after a create
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize

    @State private var list: Board.ProjectList?
    @State private var readFailed = false
    @State private var sending = false
    @State private var message: String?
    @State private var lastTasks: Board.TasksRead?
    @State private var checking = false   // the read after "could not tell" is in the air

    var body: some View {
        NavigationView {
            content
                .navigationTitle("New task")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sending || checking) }
                    ToolbarItem(placement: .confirmationAction) {
                        if sending {
                            ProgressView().accessibilityLabel("Creating the task")
                        } else {
                            // Latched here, before the Task starts: a second tap in between would send a second create.
                            Button("Create") { guard !sending else { return }; sending = true; Task { await create() } }
                                // Held until the projects are read: a kept draft's project is checked against them first.
                                .disabled(list == nil || !NewTask.canCreate(draft) || NewTask.heldBack(draft, by: held) || checking)
                        }
                    }
                }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(sending || checking)   // a create, or its follow-up read, is not walked away from
        .task { lastTasks = tasks; await readProjects() }
        // A pick no longer offered (the Tasks list re-read under the sheet) falls back, never sent unseen.
        .onChange(of: tasks) { new in
            if let new { lastTasks = new }
            dropUnoffered()
        }
        // The board's limits and one-line questions, applied after the field has stored what was typed: a binding that
        // refused the change itself left the field showing characters that were not in the draft.
        // An answer is about the draft that was sent: once the draft changes it no longer applies. (Held words keep their
        // own line, drawn from the hold, not from this message.)
        .onChange(of: draft) { _ in message = nil }
        .onChange(of: draft.what) { v in let c = NewTask.capped(NewTask.oneLine(v), at: NewTask.whatMax); if c != v { draft.what = c } }
        .onChange(of: draft.done) { v in let c = NewTask.capped(NewTask.oneLine(v), at: NewTask.doneMax); if c != v { draft.done = c } }
        .onChange(of: draft.detail) { v in let c = NewTask.capped(v, at: NewTask.detailMax); if c != v { draft.detail = c } }
    }

    @ViewBuilder private var content: some View {
        if let list {
            form(list)
        } else if readFailed {
            VStack(spacing: 10) {
                Text("Kosmos could not read your projects just now.").font(.headline).foregroundColor(Palette.primary)
                    .multilineTextAlignment(.center)
                Button("Try again") { Task { await readProjects() } }
            }
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.ground.ignoresSafeArea())
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Palette.ground.ignoresSafeArea())
        }
    }

    private func form(_ list: Board.ProjectList) -> some View {
        let offered = NewTask.projects(list)
        return ScrollViewReader { scroller in Form {
            if offered.isEmpty {
                // Every project archived is not "no project": say which.
                Section { Text(list.projects.isEmpty ? "Make a project on your computer first, then add tasks to it here."
                               : "Your projects are all archived. Bring one back on your computer to add tasks to it.")
                    .foregroundColor(Palette.secondary) }
            } else {
                Section {
                    // Opened from a project picked in Tasks, the sheet is for that project and says so, as the board's
                    // dialog hides its picker there; a draft is never moved off it to be cleared on the next opening.
                    if let fixed = offered.first(where: { $0.project.id == picked }) {
                        LabeledContent("Project") { Text(NewTask.projectWords(fixed, in: list)) }
                    } else {
                        Picker("Project", selection: projectBinding) {
                            ForEach(offered) { row in Text(NewTask.projectWords(row, in: list)).tag(Optional(row.project.id)) }
                        }
                        .large(typeSize)
                    }
                }
            }
            Section {
                field(NewTask.Words.what, example: NewTask.Words.whatExample, text: $draft.what, lines: 1...4)
                field(NewTask.Words.done, example: NewTask.Words.doneExample, text: $draft.done, lines: 1...3)
            } footer: {
                Text(NewTask.Words.doneHint)
            }
            Section {
                field(NewTask.Words.detail, example: NewTask.Words.detailExample, text: $draft.detail, lines: 2...6)
            }
            Section {
                Picker("Part of", selection: $draft.parent) {
                    Text("None").tag(Int?.none)
                    ForEach(NewTask.parents(of: draft.project, in: shownTasks)) { t in
                        Text("#\(t.number) \(t.sentence)").lineLimit(typeSize.isAccessibilitySize ? nil : 1).tag(Optional(t.number))
                    }
                }
                .large(typeSize)
                Picker("Who is on it", selection: $draft.who) {
                    Text("Nobody yet").tag(String?.none)
                    ForEach(NewTask.members(of: draft.project, in: list), id: \.session) { m in Text(m.name).tag(Optional(m.session)) }
                }
                .large(typeSize)
            } footer: {
                VStack(alignment: .leading, spacing: 10) {
                    Text(NewTask.Words.whoHint)
                    // The Mac's answer, plain text under the last section as the hints are (in a box it read as a field).
                    // VoiceOver hears it from create()'s announcement, as the board's #nt-msg alert.
                    // Words held after "could not tell" say why Create is off, on any opening of the sheet, and the person
                    // who has looked in Tasks can send them again.
                    if let line = message ?? (NewTask.heldBack(draft, by: held) ? NewTask.unsureWords : nil) {
                        Text(line).foregroundColor(Palette.primary)
                    }
                    if NewTask.heldBack(draft, by: held) && !checking && !sending {
                        Button(NewTask.anyway) { held = nil }.textCase(nil)
                    }
                }
            }
            .id("nt-who")
        }
        // A moment after appearing, as the Tasks list's sample scroll: at appear the rows are not drawn yet.
        .onAppear {
            guard Self.sampleScrollToEnd else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                scroller.scrollTo("nt-who", anchor: .bottom)
                // scrollTo stops at the row, short of a section's footer: then the sheet's own list to its true end.
                // Twice: a footer laid out after the first pass leaves it short of the end.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { Self.sampleScrollSheetToEnd() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Self.sampleScrollSheetToEnd() }
            }
        }
        // The Mac's answer is drawn at the end of the form, below the fold on a small phone: bring it into view.
        .onChange(of: message) { m in
            guard m != nil else { return }
            DispatchQueue.main.async { withAnimation { scroller.scrollTo("nt-who", anchor: .top) } }
        }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .disabled(sending || checking)
    }

    // The board's layout: the question stays above its field while it is answered, and the board's example shows in
    // the empty field. The example is drawn as text of its own because a placeholder keeps to one line and cut the
    // board's longer examples short. VoiceOver reads the question as the field's label and the example as its hint.
    private func field(_ question: String, example: String, text: Binding<String>, lines: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(question).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).accessibilityHidden(true)
            ZStack(alignment: .topLeading) {
                if text.wrappedValue.isEmpty {
                    Text(example).foregroundColor(Color(UIColor.placeholderText)).accessibilityHidden(true).allowsHitTesting(false)
                }
                TextField(question, text: text, prompt: Text(""), axis: .vertical).lineLimit(lines)
                    .accessibilityHint(example)
            }
        }
        .padding(.vertical, 2)
    }

    private func made(number: Int?, sent: NewTask.Draft) {
        let name = list?.projects.first { $0.id == sent.project }?.name ?? "the project"
        let line = NewTask.addedLine(number: number, projectName: name)
        held = nil
        if draft == sent { draft = NewTask.Draft() }   // words typed since are someone's next task, not this one's
        added(line)
        dismiss()
        // After the sheet has gone: an announcement posted as it closes is lost under the screen change.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { UIAccessibility.post(notification: .announcement, argument: line) }
    }

    // The last Tasks read that came back: a read that fails keeps the Part of pick (keepingOffered), so the picker
    // keeps the row that shows it rather than drawing a pick it no longer lists.
    private var shownTasks: Board.TasksRead? { tasks ?? lastTasks }

    // A different project: the words stay, who and Part of do not (NewTask.aimed).
    private var projectBinding: Binding<String?> {
        Binding(get: { draft.project }, set: { new in if let new { draft = NewTask.aimed(draft, at: new) } })
    }

    private func readProjects() async {
        readFailed = false
        // The sample Projects (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), as the Projects tab shows them, for screenshots.
        // RoomStore.sampleProjects exists only in Debug, so the whole branch is compiled out of Release.
        #if DEBUG
        if Self.sample, let parsed = Board.parseProjects(Data(RoomStore.sampleProjects.utf8)) {
            took(parsed)
            // As after a real "could not tell": the words are held, so the line and Create it anyway show.
            if Self.sampleUnsure { held = NewTask.Held(sent: draft, before: nil) }
            return
        }
        #endif
        let got = await client.throughMac { Board.projectsRequest(mac: $0) }
        guard let got, (200...299).contains(got.1.statusCode), let parsed = Board.parseProjects(got.0) else {
            if list == nil { readFailed = true }
            return
        }
        took(parsed)
    }

    private func took(_ parsed: Board.ProjectList) {
        list = parsed
        draft = NewTask.settled(draft, picked: picked, offered: NewTask.projects(parsed))
        dropUnoffered()
    }

    #if DEBUG
    private static let sample = RoomStore.sample
    // Screenshots only: KOSMOS_SAMPLE_NEWTASK_SHOWS=unsure opens the sheet with its no-answer line showing, and
    // KOSMOS_SAMPLE_SCROLL=end scrolls it to its last section.
    private static let sampleUnsure = sample && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWTASK_SHOWS"] == "unsure"
    private static let sampleScrollToEnd = sample && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLL"] == "end"
    // The presented sheet's list, never the Tasks list underneath it.
    private static func sampleScrollSheetToEnd() {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        func top(_ c: UIViewController) -> UIViewController { c.presentedViewController.map(top) ?? c }
        func find(_ v: UIView) -> UIScrollView? {
            if let s = v as? UICollectionView, s.window != nil, !s.isHidden, s.bounds.height > 0 { return s }
            for c in v.subviews { if let s = find(c) { return s } }
            return nil
        }
        guard let sheet = windows.lazy.compactMap({ $0.rootViewController }).map(top).first,
              let s = find(sheet.view) else { return }
        let end = s.contentSize.height - s.bounds.height + s.adjustedContentInset.bottom
        s.setContentOffset(CGPoint(x: 0, y: max(-s.adjustedContentInset.top, end)), animated: false)
    }
    #else
    private static let sample = false
    private static let sampleUnsure = false
    private static let sampleScrollToEnd = false
    private static func sampleScrollSheetToEnd() {}
    #endif

    private func dropUnoffered() {
        guard let list else { return }
        draft = NewTask.keepingOffered(draft, members: NewTask.members(of: draft.project, in: list),
                                       parents: tasks.map { NewTask.parents(of: draft.project, in: $0) })
    }

    private func create() async {
        // sending is already set by Create's tap.
        guard list != nil, NewTask.canCreate(draft) else { sending = false; return }
        message = nil
        let sent = draft
        // Another account or Mac while this is in the air closes the sheet; its answer is then not this one's to show.
        let epoch = client.chatEpoch
        let before = shownTasks.map { Set($0.tasks.filter { $0.projectId == sent.project }.map(\.number)) }
        // throughMac answers nil both when nothing was sent and when a send got no answer; only the second may have made
        // the task, so note whether a request was built and handed over.
        var built = false
        let got = await client.throughMac { mac in
            let r = NewTask.request(mac: mac, draft: sent)
            built = r != nil
            return r
        }
        sending = false
        guard epoch == client.chatEpoch else { return }
        switch NewTask.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let number, _):
            made(number: number, sent: sent)
        case .refused(let why):
            message = why
            UIAccessibility.post(notification: .announcement, argument: why)
        case .unknown:
            held = NewTask.Held(sent: sent, before: before)
            message = NewTask.unsureWords
            UIAccessibility.post(notification: .announcement, argument: NewTask.unsureWords)
            // The sheet's own read, judged on what it returns: the Tasks tab's list can be left as it was by a refresh
            // that was cancelled or overtaken, and an old list would release the hold unseen. Then the tab is read too.
            checking = true
            let fresh = await client.throughMac { Board.readyTasksRequest(mac: $0) }
            checking = false
            Task { await client.refreshTasks() }
            guard epoch == client.chatEpoch, let fresh, (200...299).contains(fresh.1.statusCode),
                  let read = Board.parseTasks(fresh.0) else { return }   // no read came back: the hold stays
            // Found: it was made. Not found proves nothing (the Mac may still be filing it), so the hold stays until the
            // person changes the words.
            // held is nil when the Tasks tab's own read found it first and has already said so (and closed the sheet).
            if held != nil, let number = NewTask.found(sent, in: read, before: before) {
                message = nil
                made(number: number, sent: sent)
            }
        }
    }
}

private extension View {
    // The menu style draws its choice on one line, which cut "Spring catalogue" to "Sprin...logue" at the largest text
    // sizes; there the choices open as a list whose rows wrap.
    @ViewBuilder func large(_ size: DynamicTypeSize) -> some View {
        if size.isAccessibilitySize { pickerStyle(.navigationLink) } else { self }
    }
}
