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
                        Button("Create") { Task { await create() } }
                            .disabled(!NewTask.canCreate(draft) || sending)
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
                Text(NewTask.Words.whoHint)
            }
            .id(message == nil ? "nt-end" : "nt-who")
            if let message {
                Section { Text(message).font(.footnote).foregroundColor(Palette.secondary) }.id("nt-end")
            }
        }
        // A moment after appearing, as the Tasks list's sample scroll: at appear the rows are not drawn yet.
        .onAppear {
            guard Self.sampleScrollToEnd else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { scroller.scrollTo("nt-end", anchor: .bottom) }
        }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .disabled(sending)
    }

    // The board's layout: the question stays above its field while it is answered, and the board's example is the
    // placeholder. VoiceOver reads the question once, as the field's label.
    private func field(_ question: String, example: String, text: Binding<String>, lines: ClosedRange<Int>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(question).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).accessibilityHidden(true)
            TextField(question, text: text, prompt: Text(example), axis: .vertical).lineLimit(lines)
        }
        .padding(.vertical, 2)
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
            if Self.sampleRefusal { message = NewTask.unsureWords }
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
    // Screenshots only: KOSMOS_SAMPLE_NEWTASK_SHOWS=refusal opens the sheet with its no-answer line showing, and
    // KOSMOS_SAMPLE_SCROLL=end scrolls it to its last section.
    private static let sampleRefusal = sample && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWTASK_SHOWS"] == "refusal"
    private static let sampleScrollToEnd = sample && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLL"] == "end"
    #else
    private static let sample = false
    private static let sampleRefusal = false
    private static let sampleScrollToEnd = false
    #endif

    private func dropUnoffered() {
        guard let list else { return }
        draft = NewTask.keepingOffered(draft, members: NewTask.members(of: draft.project, in: list),
                                       parents: NewTask.parents(of: draft.project, in: tasks))
    }

    private func create() async {
        guard NewTask.canCreate(draft), !sending else { return }
        sending = true
        message = nil
        let sent = draft
        let got = await client.throughMac { NewTask.request(mac: $0, draft: sent) }
        sending = false
        switch NewTask.result(status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let number, _):
            let name = list?.projects.first { $0.id == sent.project }?.name ?? "the project"
            let line = NewTask.addedLine(number: number, projectName: name)
            draft = NewTask.Draft()
            added(line)
            dismiss()
            UIAccessibility.post(notification: .announcement, argument: line)   // VoiceOver hears it
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
