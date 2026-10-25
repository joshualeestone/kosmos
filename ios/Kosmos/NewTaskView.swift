import SwiftUI

// The native New task sheet (kosmos#7078, gap 2 of #7074), opened from the Tasks tab's toolbar. It draws what
// NewTaskLogic decides, which is the board's New task dialog: the same fields, Create held down until what needs doing,
// how you will know it is done and a project exist, and the Mac's own words when it refuses.
struct NewTaskView: View {
    @ObservedObject var client: BoardClient
    let tasks: Board.TasksRead?        // the Tasks tab's read, for Part of
    let picked: String?                // the Tasks tab's picked project, if any
    let added: (String) -> Void        // the line the Tasks tab shows after a create
    @Environment(\.dismiss) private var dismiss

    @State private var list: Board.ProjectList?
    @State private var readFailed = false
    @State private var draft = NewTask.Draft()
    @State private var sending = false
    @State private var message: String?

    var body: some View {
        NavigationView {
            content
                .navigationTitle("New task")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") { Task { await create() } }
                            .disabled(!NewTask.canCreate(draft) || sending)
                    }
                }
        }
        .navigationViewStyle(.stack)
        .task { await readProjects() }
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
        return Form {
            if offered.isEmpty {
                Section { Text("Make a project on your computer first, then add tasks to it here.").foregroundColor(Palette.secondary) }
            } else {
                Section {
                    Picker("Project", selection: projectBinding) {
                        ForEach(offered) { row in Text(NewTask.projectWords(row, in: list)).tag(Optional(row.project.id)) }
                    }
                }
            }
            Section {
                TextField("What needs doing?", text: $draft.what, axis: .vertical)
                    .lineLimit(1...4)
                TextField("How will you know it is done?", text: $draft.done, axis: .vertical)
                    .lineLimit(1...3)
            } footer: {
                Text("Both are needed. The second is how you or an agent will check it is finished.")
            }
            Section("Details") {
                TextField("Anything else it needs (optional)", text: $draft.detail, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section {
                Picker("Who is on it", selection: $draft.who) {
                    Text("Nobody yet").tag(String?.none)
                    ForEach(NewTask.members(of: draft.project, in: list), id: \.session) { m in Text(m.name).tag(Optional(m.session)) }
                }
                Picker("Part of", selection: $draft.parent) {
                    Text("None").tag(Int?.none)
                    ForEach(NewTask.parents(of: draft.project, in: tasks)) { t in
                        Text("#\(t.number) \(t.sentence)").lineLimit(1).tag(Optional(t.number))
                    }
                }
            }
            if let message {
                Section { Text(message).font(.footnote).foregroundColor(Palette.secondary).accessibilityAddTraits(.updatesFrequently) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .disabled(sending)
    }

    // A different project: the words stay, who and Part of do not (NewTask.aimed).
    private var projectBinding: Binding<String?> {
        Binding(get: { draft.project }, set: { new in if let new { draft = NewTask.aimed(draft, at: new) } })
    }

    private func readProjects() async {
        readFailed = false
        // The sample Projects (KOSMOS_SAMPLE_AGENTS=1), as the Projects tab shows them, for screenshots.
        if RoomStore.sample, let parsed = Board.parseProjects(Data(RoomStore.sampleProjects.utf8)) {
            list = parsed
            if draft.project == nil, let first = NewTask.firstProject(picked: picked, offered: NewTask.projects(parsed)) {
                draft = NewTask.aimed(draft, at: first)
            }
            return
        }
        let got = await client.throughMac { Board.projectsRequest(mac: $0) }
        guard let got, (200...299).contains(got.1.statusCode), let parsed = Board.parseProjects(got.0) else {
            if list == nil { readFailed = true }
            return
        }
        list = parsed
        if draft.project == nil, let first = NewTask.firstProject(picked: picked, offered: NewTask.projects(parsed)) {
            draft = NewTask.aimed(draft, at: first)
        }
    }

    private func create() async {
        guard NewTask.canCreate(draft), !sending else { return }
        sending = true
        message = nil
        let sent = draft
        let got = await client.throughMac { NewTask.request(mac: $0, draft: sent) }
        sending = false
        switch NewTask.result(status: got?.1.statusCode ?? 0, body: got?.0) {
        case .made(let number, let note):
            let name = list?.projects.first { $0.id == sent.project }?.name ?? "the project"
            added(NewTask.addedLine(number: number, projectName: name) + (note.map { " " + $0 } ?? ""))
            dismiss()
        case .refused(let why):
            message = why
        }
    }
}
