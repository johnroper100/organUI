import SwiftUI

struct ContentView: View {
    @StateObject private var client = RemoteCommandClient()

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 3) {
                serverStatusView
                    .lineLimit(2)
                    .minimumScaleFactor(0.65)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.72))

                if client.isError, !client.statusText.isEmpty {
                    Text(client.statusText)
                        .font(.system(.caption, design: .rounded).weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.red)
                }
            }
            .padding(.bottom, 2)

            HoldCommandButton(
                title: "Back",
                systemImage: "backward.fill",
                tint: .red,
                command: RemoteConfiguration.backCommand,
                client: client
            )

            HoldCommandButton(
                title: "Next",
                systemImage: "forward.fill",
                tint: .green,
                size: .prominent,
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

    @ViewBuilder
    private var serverStatusView: some View {
        if let connectedServer = client.connectedServer {
            VStack(spacing: 1) {
                Text(connectedServer.host)
                    .font(.system(size: 9, weight: .medium, design: .rounded))

                Text(connectedServer.siteName)
                    .font(.system(.caption2, design: .rounded).weight(.medium))
            }
        } else {
            Text(client.serverLabel)
                .font(.system(.caption2, design: .rounded).weight(.medium))
        }
    }
}

#Preview {
    ContentView()
}
