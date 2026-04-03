import Foundation

@MainActor
final class RemoteCommandClient: ObservableObject {
    @Published private(set) var statusText = ""
    @Published private(set) var isError = false

    let serverInput: String

    private let session: URLSession
    private let encoder = JSONEncoder()

    init(serverInput: String = RemoteConfiguration.serverInput) {
        self.serverInput = serverInput.trimmingCharacters(in: .whitespacesAndNewlines)

        let configuration = URLSessionConfiguration.default
        configuration.httpMaximumConnectionsPerHost = 1
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)
    }

    var serverLabel: String {
        guard let url = Self.normalizedBaseURL(from: serverInput) else {
            return serverInput
        }

        if let host = url.host {
            if let port = url.port {
                return "\(host):\(port)"
            }

            return host
        }

        return url.absoluteString
    }

    func sendCommand(_ command: String, state: Int) async {
        guard let url = commandURL else {
            statusText = "Invalid server URL"
            isError = true
            return
        }

        do {
            try await postCommand(OSCCommandRequest(cmd: command, state: state), to: url)
            statusText = ""
            isError = false
        } catch {
            statusText = description(for: error)
            isError = true
        }
    }

    private var commandURL: URL? {
        guard let baseURL = Self.normalizedBaseURL(from: serverInput),
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.path = "/api/osc"
        return components.url
    }

    private func postCommand(_ payload: OSCCommandRequest, to url: URL) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(payload)

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw RemoteCommandError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw RemoteCommandError.serverStatus(httpResponse.statusCode)
        }
    }
    private func description(for error: Error) -> String {
        if let remoteError = error as? RemoteCommandError,
           let description = remoteError.errorDescription {
            return description
        }

        return error.localizedDescription
    }

    static func normalizedBaseURL(from input: String) -> URL? {
        var trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmed.isEmpty else {
            return nil
        }

        if !trimmed.contains("://") {
            trimmed = "http://\(trimmed)"
        }

        guard let rawURL = URL(string: trimmed),
              var components = URLComponents(url: rawURL, resolvingAgainstBaseURL: false),
              components.host != nil else {
            return nil
        }

        components.user = nil
        components.password = nil
        components.path = ""
        components.query = nil
        components.fragment = nil

        return components.url
    }
}

private extension RemoteCommandClient {
    struct OSCCommandRequest: Encodable {
        let cmd: String
        let state: Int
    }

    enum RemoteCommandError: LocalizedError {
        case invalidResponse
        case serverStatus(Int)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                return "No HTTP response"
            case .serverStatus(let statusCode):
                return "Server error \(statusCode)"
            }
        }
    }
}
