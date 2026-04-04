import SwiftUI
import WatchKit

struct HoldCommandButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let command: String

    @ObservedObject var client: RemoteCommandClient

    @State private var isPressed = false
    @State private var pressTask: Task<Void, Never>?

    var body: some View {
        let isBlockedByAnotherCommand = client.activeCommand != nil && client.activeCommand != command

        VStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .bold))

            Text(title)
                .font(.system(.headline, design: .rounded).weight(.bold))
        }
        .frame(maxWidth: .infinity, minHeight: 50)
        .padding(.vertical, 8)
        .foregroundStyle(.white)
        .background(buttonBackground)
        .overlay(buttonOutline)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .scaleEffect(isPressed ? 0.97 : 1.0)
        .opacity(isBlockedByAnotherCommand ? 0.55 : 1.0)
        .shadow(color: tint.opacity(isPressed ? 0.15 : 0.32), radius: 8, y: 5)
        .animation(.easeOut(duration: 0.12), value: isPressed)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    beginPress()
                }
                .onEnded { _ in
                    endPress()
                }
        )
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Press and hold to send \(title)")
        .onDisappear {
            endPress()
        }
    }

    private var buttonBackground: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        tint.opacity(isPressed ? 1.0 : 0.82),
                        Color.black.opacity(0.88)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
    }

    private var buttonOutline: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .strokeBorder(.white.opacity(isPressed ? 0.38 : 0.16), lineWidth: 1)
    }

    private func beginPress() {
        guard !isPressed, client.beginExclusiveCommand(command) else {
            return
        }

        isPressed = true
        WKInterfaceDevice.current().play(.click)
        pressTask = Task {
            await client.sendCommand(command, state: 1)
        }
    }

    private func endPress() {
        guard isPressed else {
            return
        }

        isPressed = false
        WKInterfaceDevice.current().play(.click)

        let currentPressTask = pressTask
        pressTask = nil

        Task {
            if let currentPressTask {
                _ = await currentPressTask.value
            }
            await client.finishExclusiveCommand(command)
        }
    }
}
