import Foundation
import Combine
import Network

final class RemoteCommandClient: ObservableObject {
    @Published private(set) var statusText = ""
    @Published private(set) var isError = false
    @Published private(set) var serverLabel = "Searching network..."

    private let serverInput: String
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let browser: NWBrowser

    private var discoveredServices: [String: DiscoveredService] = [:]
    private var activeServiceKey: String?

    init(serverInput: String = RemoteConfiguration.serverInput) {
        self.serverInput = serverInput.trimmingCharacters(in: .whitespacesAndNewlines)

        let configuration = URLSessionConfiguration.default
        configuration.httpMaximumConnectionsPerHost = 1
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)

        let descriptor = NWBrowser.Descriptor.bonjour(
            type: RemoteConfiguration.bonjourServiceType,
            domain: RemoteConfiguration.bonjourDomain
        )
        self.browser = NWBrowser(for: descriptor, using: .tcp)

        refreshServerLabel()
        configureBrowser()
        browser.start(queue: .main)
    }

    deinit {
        browser.cancel()
    }

    func sendCommand(_ command: String, state: Int) async {
        do {
            if let service = activeDiscoveredService {
                try await postCommand(OSCCommandRequest(cmd: command, state: state), to: service)
            } else if let url = commandURL {
                try await postCommand(OSCCommandRequest(cmd: command, state: state), to: url)
            } else {
                throw RemoteCommandError.noServerAvailable
            }

            await MainActor.run {
                statusText = ""
                isError = false
            }
        } catch {
            await MainActor.run {
                statusText = description(for: error)
                isError = true
            }
        }
    }

    private var activeDiscoveredService: DiscoveredService? {
        guard let activeServiceKey = activeServiceKey else {
            return nil
        }

        return discoveredServices[activeServiceKey]
    }

    private var commandURL: URL? {
        guard let baseURL = fallbackBaseURL,
              var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.path = "/api/osc"
        return components.url
    }

    private var fallbackBaseURL: URL? {
        Self.normalizedBaseURL(from: serverInput)
    }

    private var fallbackHostLabel: String? {
        guard let fallbackBaseURL = fallbackBaseURL else {
            return nil
        }

        return Self.hostLabel(for: fallbackBaseURL)
    }

    private func configureBrowser() {
        browser.stateUpdateHandler = { [weak self] state in
            guard let self = self else {
                return
            }

            DispatchQueue.main.async {
                self.handleBrowserStateUpdate(state)
            }
        }

        browser.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self = self else {
                return
            }

            DispatchQueue.main.async {
                self.handleBrowseResultsChanged(results)
            }
        }
    }

    private func handleBrowserStateUpdate(_ state: NWBrowser.State) {
        switch state {
        case .failed(_):
            statusText = "Local network discovery failed"
            isError = true
        case .waiting(_):
            statusText = "Local network access is required"
            isError = true
        default:
            break
        }
    }

    private func handleBrowseResultsChanged(_ results: Set<NWBrowser.Result>) {
        var updatedServices: [String: DiscoveredService] = [:]

        for result in results {
            guard let service = Self.discoveredService(from: result.endpoint) else {
                continue
            }

            updatedServices[service.id] = service
        }

        discoveredServices = updatedServices

        if let activeServiceKey = activeServiceKey, updatedServices[activeServiceKey] != nil {
            refreshServerLabel()
            return
        }

        activeServiceKey = updatedServices.values.sorted { lhs, rhs in
            lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }.first?.id

        refreshServerLabel()
    }

    private func refreshServerLabel() {
        if let activeDiscoveredService = activeDiscoveredService {
            serverLabel = activeDiscoveredService.name
            return
        }

        if fallbackBaseURL != nil {
            serverLabel = RemoteConfiguration.serverDisplayName
            return
        }

        serverLabel = "Searching network..."
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

    private func postCommand(_ payload: OSCCommandRequest, to service: DiscoveredService) async throws {
        let body = try encoder.encode(payload)
        let request = try Self.httpRequestData(body: body, hostHeader: service.httpHostHeader)

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let connection = NWConnection(to: service.endpoint, using: .tcp)
            var didResume = false
            var timeoutWorkItem: DispatchWorkItem?

            func finish(_ result: Result<Void, Error>) {
                guard !didResume else {
                    return
                }

                didResume = true
                timeoutWorkItem?.cancel()
                connection.cancel()

                switch result {
                case .success:
                    continuation.resume()
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }

            timeoutWorkItem = DispatchWorkItem {
                finish(.failure(RemoteCommandError.connectionTimeout))
            }

            func receiveResponse(buffer: Data) {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isComplete, error in
                    if let error = error {
                        finish(.failure(error))
                        return
                    }

                    var nextBuffer = buffer
                    if let data = data {
                        nextBuffer.append(data)
                    }

                    if let statusCode = Self.statusCode(fromHTTPResponseData: nextBuffer) {
                        if (200..<300).contains(statusCode) {
                            finish(.success(()))
                        } else {
                            finish(.failure(RemoteCommandError.serverStatus(statusCode)))
                        }
                        return
                    }

                    if isComplete {
                        finish(.failure(RemoteCommandError.invalidResponse))
                        return
                    }

                    receiveResponse(buffer: nextBuffer)
                }
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.send(content: request, completion: .contentProcessed { error in
                        if let error = error {
                            finish(.failure(error))
                            return
                        }

                        receiveResponse(buffer: Data())
                    })
                case .failed(let error):
                    finish(.failure(error))
                default:
                    break
                }
            }

            if let timeoutWorkItem = timeoutWorkItem {
                DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeoutWorkItem)
            }
            connection.start(queue: .main)
        }
    }

    private func description(for error: Error) -> String {
        let diagnosticLabel = activeDiscoveredService?.diagnosticLabel ?? fallbackHostLabel

        if let remoteError = error as? RemoteCommandError,
           let description = remoteError.errorDescription {
            switch remoteError {
            case .connectionTimeout:
                return Self.decorate(description, hostLabel: diagnosticLabel)
            default:
                return description
            }
        }

        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
                return Self.decorate("Can't reach server", hostLabel: diagnosticLabel)
            default:
                return urlError.localizedDescription
            }
        }

        if error is NWError {
            return Self.decorate("Can't reach server", hostLabel: diagnosticLabel)
        }

        return error.localizedDescription
    }

    private static func discoveredService(from endpoint: NWEndpoint) -> DiscoveredService? {
        switch endpoint {
        case .service(let name, let type, let domain, _):
            let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let serviceName = trimmedName.isEmpty ? RemoteConfiguration.serverDisplayName : trimmedName

            return DiscoveredService(
                id: "\(serviceName)|\(type)|\(domain)",
                name: serviceName,
                endpoint: endpoint,
                diagnosticLabel: serviceName,
                httpHostHeader: "organremote.local"
            )
        case .hostPort(let host, let port):
            let hostLabel = "\(host):\(port)"

            return DiscoveredService(
                id: hostLabel,
                name: RemoteConfiguration.serverDisplayName,
                endpoint: endpoint,
                diagnosticLabel: hostLabel,
                httpHostHeader: String(describing: host)
            )
        default:
            return nil
        }
    }

    private static func httpRequestData(body: Data, hostHeader: String) throws -> Data {
        var requestString = "POST /api/osc HTTP/1.1\r\n"
        requestString += "Host: \(hostHeader)\r\n"
        requestString += "Content-Type: application/json\r\n"
        requestString += "Content-Length: \(body.count)\r\n"
        requestString += "Connection: close\r\n\r\n"

        guard var requestData = requestString.data(using: .utf8) else {
            throw RemoteCommandError.invalidRequest
        }

        requestData.append(body)
        return requestData
    }

    private static func statusCode(fromHTTPResponseData data: Data) -> Int? {
        guard let headerRange = data.range(of: Data("\r\n".utf8)),
              let statusLine = String(data: Data(data[..<headerRange.lowerBound]), encoding: .utf8) else {
            return nil
        }

        let parts = statusLine.split(separator: " ")
        guard parts.count >= 2 else {
            return nil
        }

        return Int(parts[1])
    }

    private static func decorate(_ message: String, hostLabel: String?) -> String {
        guard let hostLabel = hostLabel, !hostLabel.isEmpty else {
            return message
        }

        return "\(message) (\(hostLabel))"
    }

    private static func hostLabel(for url: URL) -> String {
        guard let host = url.host else {
            return url.absoluteString
        }

        if let port = url.port {
            return "\(host):\(port)"
        }

        return host
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
    struct DiscoveredService {
        let id: String
        let name: String
        let endpoint: NWEndpoint
        let diagnosticLabel: String
        let httpHostHeader: String
    }

    struct OSCCommandRequest: Encodable {
        let cmd: String
        let state: Int
    }

    enum RemoteCommandError: LocalizedError {
        case invalidRequest
        case invalidResponse
        case noServerAvailable
        case connectionTimeout
        case serverStatus(Int)

        var errorDescription: String? {
            switch self {
            case .invalidRequest:
                return "Couldn't build request"
            case .invalidResponse:
                return "No HTTP response"
            case .noServerAvailable:
                return "No server discovered yet"
            case .connectionTimeout:
                return "Can't reach server"
            case .serverStatus(let statusCode):
                return "Server error \(statusCode)"
            }
        }
    }
}
