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
    let added: (String) -> Void        // the line the Tasks tab shows after a create
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize

    @State private var list: Board.ProjectList?
    @State private var readFailed = false
    @State private var sending = false
    @State private var message: String?

    var body: some View {
        NavigationView {
            content
                .navigationTitle("New task")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sending) }
                    ToolbarItem(placement: .confirmationAction) {
                        if sending {
                            ProgressView().accessibilityLabel("Creating the task")
                        } else {
                            Button("Create") { Task { await create() } }
                                // Held until the projects are read: a kept draft's project is checked against them first.
                                .disabled(list == nil || !NewTask.canCreate(draft))
                        }
                    }
                }
        }
        .navigationViewStyle(.stack)
        .interactiveDismissDisabled(sending)   // a create in the air is not walked away from
        .task { await readProjects() }
        // A pick no longer offered (the Tasks list re-read under the sheet) falls back, never sent unseen.
        .onChange(of: tasks) { _ in dropUnoffered() }
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
                    Picker("Project", selection: projectBinding) {
                        ForEach(offered) { row in Text(NewTask.projectWords(row, in: list)).tag(Optional(row.project.id)) }
                    }
                    .large(typeSize)
                }
            }
            Section {
                field(NewTask.Words.what, example: NewTask.Words.whatExample, text: oneLine($draft.what, max: NewTask.whatMax), lines: 1...4)
                field(NewTask.Words.done, example: NewTask.Words.doneExample, text: oneLine($draft.done, max: NewTask.doneMax), lines: 1...3)
            } footer: {
                Text(NewTask.Words.doneHint)
            }
            Section {
                field(NewTask.Words.detail, example: NewTask.Words.detailExample, text: capped($draft.detail, max: NewTask.detailMax), lines: 2...6)
            }
            Section {
                Picker("Part of", selection: $draft.parent) {
                    Text("None").tag(Int?.none)
                    ForEach(NewTask.parents(of: draft.project, in: tasks)) { t in
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
                    if let message { Text(message).foregroundColor(Palette.primary) }
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
        .disabled(sending)
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

    private func oneLine(_ b: Binding<String>, max: Int) -> Binding<String> {
        Binding(get: { b.wrappedValue }, set: { b.wrappedValue = NewTask.capped(NewTask.oneLine($0), at: max) })
    }

    private func capped(_ b: Binding<String>, max: Int) -> Binding<String> {
        Binding(get: { b.wrappedValue }, set: { b.wrappedValue = NewTask.capped($0, at: max) })
    }

    // A different project: the words stay, who and Part of do not (NewTask.aimed).
    private var projectBinding: Binding<String?> {
        Binding(get: { draft.project }, set: { new in if let new { draft = NewTask.aimed(draft, at: new) } })
    }

    private func readProjects() async {
        readFailed = false
        // The sample Projects (KOSMOS_SAMPLE_AGENTS=1, a Debug build only), as the Projects tab shows them, for screenshots.
        if Self.sample, let parsed = Board.parseProjects(Data(RoomStore.sampleProjects.utf8)) {
            took(parsed)
            if Self.sampleUnsure { message = NewTask.unsureWords }
            return
        }
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
        guard list != nil, NewTask.canCreate(draft), !sending else { return }
        sending = true
        message = nil
        let sent = draft
        // throughMac answers nil both when nothing was sent and when a send got no answer; only the second may have made
        // the task, so note whether a request was built and handed over.
        var built = false
        let got = await client.throughMac { mac in
            let r = NewTask.request(mac: mac, draft: sent)
            built = r != nil
            return r
        }
        sending = false
        switch NewTask.result(sent: built, status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let number, _):
            let name = list?.projects.first { $0.id == sent.project }?.name ?? "the project"
            let line = NewTask.addedLine(number: number, projectName: name)
            draft = NewTask.Draft()
            added(line)
            dismiss()
            // After the sheet has gone: an announcement posted as it closes is lost under the screen change.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { UIAccessibility.post(notification: .announcement, argument: line) }
        case .refused(let why):
            message = why
            UIAccessibility.post(notification: .announcement, argument: why)
        case .unknown:
            message = NewTask.unsureWords
            UIAccessibility.post(notification: .announcement, argument: NewTask.unsureWords)
            Task { await client.refreshTasks() }
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
