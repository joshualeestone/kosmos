import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass

// kosmos#7074: whether the person is doing anything on the page (the board's tkPresent counts pointer and key input),
// noted where the window receives events rather than through a SwiftUI gesture, which laid over a ScrollView can stop
// the scroll. The recognizer on the window notes each touch as it begins (a scroll or a tap is a new touch; one touch
// held for two minutes counts once, at its start) and fails at once, so it never claims, delays or cancels anything.
// It may also note key presses, if they reach the window; whether a hardware keyboard with nothing focused does is
// unproven here and is on the device check.
struct PresenceProbe: UIViewRepresentable {
    let onInput: () -> Void

    func makeUIView(context: Context) -> ProbeView {
        let v = ProbeView()
        v.onInput = onInput
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: ProbeView, context: Context) { v.onInput = onInput }

    static func dismantleUIView(_ v: ProbeView, coordinator: ()) { v.detach() }

    final class ProbeView: UIView {
        var onInput: (() -> Void)?
        private var recognizer: InputRecognizer?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            detach()
            guard let window else { return }
            let r = InputRecognizer(target: nil, action: nil)
            r.onInput = { [weak self] in self?.onInput?() }
            window.addGestureRecognizer(r)
            recognizer = r
        }

        func detach() {
            if let r = recognizer { r.view?.removeGestureRecognizer(r) }
            recognizer = nil
        }
    }

    final class InputRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
        var onInput: (() -> Void)?

        override init(target: Any?, action: Selector?) {
            super.init(target: target, action: action)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            onInput?()
            state = .failed
        }

        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent) {
            onInput?()
            state = .failed
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
