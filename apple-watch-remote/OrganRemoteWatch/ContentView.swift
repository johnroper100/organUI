import SwiftUI

struct ContentView: View {
    @StateObject private var client = RemoteCommandClient()

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 3) {
                Text(client.serverLabel)
                    .font(.system(.caption2, design: .rounded).weight(.medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .foregroundStyle(.white.opacity(0.72))

                Text(client.statusText)
                    .font(.system(.caption, design: .rounded).weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(client.isError ? Color.red : Color.green)
            }
            .padding(.bottom, 2)

            HoldCommandButton(
                title: "Back",
                systemImage: "backward.fill",
                tint: .indigo,
                command: RemoteConfiguration.backCommand,
                client: client
            )

            HoldCommandButton(
                title: "Next",
                systemImage: "forward.fill",
                tint: .teal,
                command: RemoteConfiguration.nextCommand,
                client: client
            )
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.11, blue: 0.17),
                    Color.black
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
    }
}

#Preview {
    ContentView()
}
