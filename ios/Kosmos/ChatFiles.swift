import SwiftUI

// kosmos#7016 (slice 3b, part 2): a file an agent sent, as a card inside its bubble that opens in Quick Look, built to
// Mona Lisa's slice 3b spec, section 3, and the board's pjAttachmentCard. What a row's files are and how they are named
// is decided in BoardLogic.swift (tested); fetching is BoardClient.fetchFile.

// Where one card is: ready to open, fetching, or the last fetch failed (the tap tries again).
enum FileCardState: Equatable { case ready, loading, failed }

// The agent's words (when there are any beyond the file names) and one card per file, in one agent bubble.
struct FilesBubble: View {
    let text: String
    let files: [Board.Attachment]
    let thumbnails: [String: Data]
    let states: [String: FileCardState]
    let widthShare: CGFloat
    let open: (Board.Attachment) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !text.isEmpty {
                Text(BubbleText.formatted(text)).font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .padding(.bottom, 4)
            }
            ForEach(files, id: \.id) { f in
                FileCard(file: f, thumbnail: thumbnails[f.id], state: states[f.id] ?? .ready, open: { open(f) })
            }
        }
        .modifier(AgentBubbleBackground(widthShare: widthShare))
    }
}

struct FileCard: View {
    let file: Board.Attachment
    let thumbnail: Data?
    let state: FileCardState
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                picture
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                        .lineLimit(1).truncationMode(.middle)
                    meta
                }
                Spacer(minLength: 0)
            }
            .padding(.trailing, 12)
            // 64 pt at the default text size; taller when the text is, so nothing is cut off.
            .frame(minHeight: 64)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(state == .loading)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(file.name + ", " + Board.attachmentMeta(file))
        .accessibilityValue(state == .loading ? "Opening" : state == .failed ? "Could not open it" : "")
        .accessibilityHint(state == .failed ? "Tries again." : "Opens the file.")
    }

    // A 64 pt picture for an image or a PDF with a preview; otherwise a symbol in a 40 pt rounded square.
    @ViewBuilder private var picture: some View {
        if let thumbnail, let image = UIImage(data: thumbnail) {
            Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                .frame(width: 64, height: 64).clipped()
        } else {
            Image(systemName: Board.fileSymbol(file)).font(.system(size: 18)).foregroundColor(Palette.avatarLetter)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 9).fill(Palette.avatarFill))
                .padding(.leading, 12)
        }
    }

    @ViewBuilder private var meta: some View {
        switch state {
        case .loading:
            ProgressView().controlSize(.small)
        case .failed:
            Text("Could not open it. Try again.").font(.caption).foregroundColor(Palette.dangerWord).lineLimit(1)
        case .ready:
            Text(Board.attachmentMeta(file)).font(.caption).foregroundColor(Palette.secondary).lineLimit(1)
        }
    }
}
