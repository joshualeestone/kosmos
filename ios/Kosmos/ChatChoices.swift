import SwiftUI

// kosmos#7016 (slice 3b, part 1): a question's buttons and a permission card inside the agent's bubble, built to Mona
// Lisa's slice 3b spec (~/work/workers/monalisa/ios-design-2026-10-19/slice3b/SPEC.md, sections 1 and 2) and the
// board's own dmChoicesHtml and dmPermissionHtml. What to draw and what a press means are decided in BoardLogic.swift
// (tested) and BoardClient.press; this file only draws them.

// What the buttons show now (Board.choicesState, under ios/LogicTests).
typealias ChoicesState = Board.ChoicesState

// A question: its words, then its options, all in one agent bubble.
struct QuestionBubble: View {
    let text: String
    let options: [Board.ChoiceOption]
    let state: ChoicesState
    let widthShare: CGFloat
    let press: (Board.ChoiceOption) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(BubbleText.formatted(text)).font(.body).foregroundColor(Palette.primary).tint(Palette.link)
            ChoiceButtons(options: options, state: state, groupLabel: "Choices", press: press)
            ChoiceNote(state: state)
        }
        .modifier(AgentBubbleBackground(widthShare: widthShare))
    }
}

// A permission prompt: what it wants to do, Allow and Deny at equal weight, and Show details.
struct PermissionCard: View {
    let permission: Board.Permission
    let allow: Board.ChoiceOption
    let deny: Board.ChoiceOption
    let more: [Board.ChoiceOption]
    // The line under Allow and Deny (Sending…, Allowed., Denied., not sure, refused), and the one in Show details
    // (the arm note, when the armed choice lives there).
    let mainState: ChoicesState
    let moreState: ChoicesState
    let widthShare: CGFloat
    let press: (Board.ChoiceOption) -> Void
    #if DEBUG
    // Screenshots only: KOSMOS_SAMPLE_DETAILS=1 opens Show details.
    @State private var showDetails = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_DETAILS"] == "1"
    #else
    @State private var showDetails = false
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ask
            if let says = permission.says {
                Text("It says: " + says).font(.body).foregroundColor(Palette.secondary)
            }
            if !mainState.settled { allowDeny }
            ChoiceNote(state: mainState)
            details
        }
        .modifier(AgentBubbleBackground(widthShare: widthShare))
        // The arm note can sit in Show details, so it opens when a choice there is armed.
        .onChange(of: moreState.armedN) { n in if n != nil { showDetails = true } }
    }

    // "Wants to <what>: <target>." with the what-words in the danger colour for a command that deletes files.
    private var ask: some View {
        let does = Board.permissionDoes(permission.kind)
        let target = permission.target.map { ": " + $0 } ?? ""
        let verb = Text(does).foregroundColor(permission.kind == "delete" ? Palette.dangerWord : Palette.primary)
        return (Text("Wants to ") + verb + Text(target + "."))
            .font(.body.weight(.semibold)).foregroundColor(Palette.primary)
            .accessibilityLabel(Board.permissionAsk(permission))
    }

    private var allowDeny: some View {
        HStack(spacing: 6) {
            ChoiceButton(option: allow, caption: "Allow", state: mainState, fill: true,
                         spoken: "Allow, " + Board.permissionDoes(permission.kind), press: press)
            ChoiceButton(option: deny, caption: "Deny", state: mainState, fill: true, spoken: "Deny", press: press)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Allow or deny")
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button { withAnimation { showDetails.toggle() } } label: {
                HStack(spacing: 4) {
                    Text("Show details").font(.footnote).foregroundColor(Palette.secondary)
                    Image(systemName: showDetails ? "chevron.up" : "chevron.down").font(.caption2).foregroundColor(Palette.secondary)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(showDetails ? "Open" : "Closed")
            if showDetails { detailBody }
        }
    }

    @ViewBuilder private var detailBody: some View {
        if let reason = permission.reason {
            Text(reason).font(.footnote).foregroundColor(Palette.secondary)
        }
        if let detail = permission.detail {
            ScrollView {
                Text(detail).font(.footnote.monospaced()).foregroundColor(Palette.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8).padding(.horizontal, 10)
            }
            // At most 14 lines, then it scrolls (the spec).
            .frame(maxHeight: UIFont.preferredFont(forTextStyle: .footnote).lineHeight * 14 + 16)
            .fixedSize(horizontal: false, vertical: true)
            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.sunk))
        }
        if !more.isEmpty {
            ChoiceButtons(options: more, state: moreState, groupLabel: "Other choices", press: press)
            ChoiceNote(state: moreState)
        }
    }
}

// The options, wrapping like words; one per line, full width, at the accessibility text sizes.
struct ChoiceButtons: View {
    let options: [Board.ChoiceOption]
    let state: ChoicesState
    let groupLabel: String
    let press: (Board.ChoiceOption) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) { buttons(fill: true) }
            } else {
                FlowLayout(spacing: 6) { buttons(fill: false) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(groupLabel)
    }

    @ViewBuilder private func buttons(fill: Bool) -> some View {
        ForEach(options, id: \.n) { o in
            ChoiceButton(option: o, caption: nil, state: state, fill: fill, spoken: o.label, press: press)
        }
    }
}

// One capsule: the option's number in secondary text, then its words (or the card's Allow / Deny).
struct ChoiceButton: View {
    let option: Board.ChoiceOption
    // The card's caption in place of the option's number and words.
    let caption: String?
    let state: ChoicesState
    let fill: Bool
    let spoken: String
    let press: (Board.ChoiceOption) -> Void

    private var armed: Bool { state.armedN == option.n }

    var body: some View {
        Button { press(option) } label: { label }
            .buttonStyle(.plain)
            .disabled(state.off)
            .opacity(state.off ? 0.5 : 1)
            .accessibilityLabel(spoken)
            .accessibilityValue(armed ? "Armed" : "")
            .accessibilityHint(option.lasting ? "Changes what the agent may do from now on. Double-tap twice to choose." : "")
    }

    private var label: some View {
        words
            .font(.subheadline.weight(.semibold))
            .foregroundColor(Palette.primary)
            .multilineTextAlignment(.leading)
            .padding(.vertical, 7).padding(.horizontal, 14)
            .frame(minHeight: 44)
            .frame(maxWidth: fill ? .infinity : nil)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.card))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(armed ? Palette.primary : Palette.optionStroke, lineWidth: armed ? 2 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 10))
    }

    private var words: Text {
        if let caption { return Text(caption) }
        return Text("\(option.n) ").foregroundColor(Palette.secondary).monospacedDigit() + Text(option.label)
    }
}

// The line under the buttons: Sending…, Sent., Allowed., the arm note, or (danger) not sure or refused.
struct ChoiceNote: View {
    let state: ChoicesState
    var body: some View {
        if let note = state.note {
            Text(note).font(.footnote).foregroundColor(state.danger ? Palette.dangerWord : Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
                // Said aloud as it changes (the board's role="status"): VoiceOver hears the arm note, Sending… and Sent.
                .onAppear { UIAccessibility.post(notification: .announcement, argument: note) }
                .onChange(of: note) { now in UIAccessibility.post(notification: .announcement, argument: now) }
        }
    }
}

// The agent bubble's look (BubbleText's), for a bubble that holds more than text. No tail: a question stands alone.
struct AgentBubbleBackground: ViewModifier {
    let widthShare: CGFloat
    func body(content: Content) -> some View {
        content
            .padding(.vertical, 10).padding(.horizontal, 14)   // kosmos#7347
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.agentBubble))
            .frame(maxWidth: UIScreen.main.bounds.width * max(widthShare, 0.85), alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// Buttons placed left to right, wrapping to the next line when a row is full (iOS 16's Layout).
struct FlowLayout: Layout {
    var spacing: CGFloat
    // kosmos#7420 review 1: each row flush right (the person's own reactions, under a right-hand bubble), as the one
    // HStack row it replaces sat; false keeps the left-to-right rows the answer buttons use.
    var trailing = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: min(width, proposal.width ?? width), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            for item in row.items {
                let shift = trailing ? max(0, bounds.width - row.width) : 0
                subviews[item.index].place(at: CGPoint(x: bounds.minX + shift + item.x, y: bounds.minY + row.y),
                                           proposal: ProposedViewSize(width: item.width, height: nil))
            }
        }
    }

    private struct Item { let index: Int; let x: CGFloat; let width: CGFloat }
    private struct Row { var items: [Item] = []; var y: CGFloat = 0; var width: CGFloat = 0; var height: CGFloat = 0 }

    // A label wider than the row wraps inside its capsule rather than truncating (it is given the row's width).
    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for (i, view) in subviews.enumerated() {
            let ideal = view.sizeThatFits(.unspecified)
            let w = min(ideal.width, width)
            let h = view.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            var row = rows[rows.count - 1]
            let x = row.items.isEmpty ? 0 : row.width + spacing
            if !row.items.isEmpty && x + w > width {
                let y = row.y + row.height + spacing
                rows.append(Row(y: y))
                row = rows[rows.count - 1]
                row.items.append(Item(index: i, x: 0, width: w))
                row.width = w
                row.height = h
            } else {
                row.items.append(Item(index: i, x: x, width: w))
                row.width = x + w
                row.height = max(row.height, h)
            }
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.items.isEmpty }
    }
}

extension Palette {
    // Mona Lisa's slice 3b colours: a control's edge (3:1 measured, so not lightened), and the detail box's sunk fill.
    static let optionStroke = pair(0x82878f, 0x6e7278)
    static let sunk = pair(0x14161a, 0xf5f5f4, lightAlpha: 0.05, darkAlpha: 0.06)
}
