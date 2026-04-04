import Combine
import Darwin
import Foundation
import dnssd

final class RemoteCommandClient: ObservableObject {
    @Published private(set) var statusText = ""
    @Published private(set) var isError = false
    @Published private(set) var serverLabel = "Searching network..."
    @Published private(set) var activeCommand: String?

    private let serverInput: String
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let networkQueue = DispatchQueue(label: "OrganRemoteWatch.discovery")

    private var browseRef: DNSServiceRef?
    private var discoveredServices: [String: DiscoveredService] = [:]
    private var activeServiceKey: String?
    private var resolveOperations: [String: ResolveOperation] = [:]
    private var addressOperations: [String: AddressLookupOperation] = [:]

    init(serverInput: String = RemoteConfiguration.serverInput) {
        self.serverInput = serverInput.trimmingCharacters(in: .whitespacesAndNewlines)

        let configuration = URLSessionConfiguration.default
        configuration.httpMaximumConnectionsPerHost = 1
        configuration.waitsForConnectivity = false
        self.session = URLSession(configuration: configuration)

        if let fallbackBaseURL = Self.normalizedBaseURL(from: self.serverInput) {
            serverLabel = Self.hostLabel(for: fallbackBaseURL)
        }

        startDiscovery()
    }

    deinit {
        networkQueue.sync {
            stopDiscovery_locked()
        }
    }

    @MainActor
    @discardableResult
    func beginExclusiveCommand(_ command: String) -> Bool {
        guard activeCommand == nil else {
            return false
        }

        activeCommand = command
        return true
    }

    func finishExclusiveCommand(_ command: String) async {
        await sendCommand(command, state: 0)

        await MainActor.run {
            if activeCommand == command {
                activeCommand = nil
            }
        }
    }

    func sendCommand(_ command: String, state: Int) async {
        do {
            let payload = OSCCommandRequest(cmd: command, state: state)

            if let url = activeDiscoveredCommandURL() ?? commandURL {
                try await postCommand(payload, to: url)
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

    private var commandURL: URL? {
        guard let baseURL = fallbackBaseURL else {
            return nil
        }

        return Self.commandURL(from: baseURL)
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

    private func startDiscovery() {
        networkQueue.async { [weak self] in
            self?.startDiscovery_locked()
        }
    }

    private func startDiscovery_locked() {
        guard browseRef == nil else {
            return
        }

        var newBrowseRef: DNSServiceRef?
        let result = RemoteConfiguration.bonjourServiceType.withCString { regtypePointer in
            RemoteConfiguration.bonjourDomain.withCString { domainPointer in
                DNSServiceBrowse(
                    &newBrowseRef,
                    0,
                    0,
                    regtypePointer,
                    domainPointer,
                    Self.browseReply,
                    Unmanaged.passUnretained(self).toOpaque()
                )
            }
        }

        guard result == kDNSServiceErr_NoError, let newBrowseRef else {
            publishDiscoveryError_locked(result)
            return
        }

        let queueResult = DNSServiceSetDispatchQueue(newBrowseRef, networkQueue)
        guard queueResult == kDNSServiceErr_NoError else {
            DNSServiceRefDeallocate(newBrowseRef)
            publishDiscoveryError_locked(queueResult)
            return
        }

        browseRef = newBrowseRef
    }

    private func stopDiscovery_locked() {
        if let browseRef {
            DNSServiceRefDeallocate(browseRef)
            self.browseRef = nil
        }

        for operation in resolveOperations.values {
            if let ref = operation.ref {
                DNSServiceRefDeallocate(ref)
            }
        }
        resolveOperations.removeAll()

        for operation in addressOperations.values {
            if let ref = operation.ref {
                DNSServiceRefDeallocate(ref)
            }
        }
        addressOperations.removeAll()
    }

    private func activeDiscoveredCommandURL() -> URL? {
        networkQueue.sync {
            activeDiscoveredService_locked?.commandURL
        }
    }

    private func activeDiscoveredDiagnosticLabel() -> String? {
        networkQueue.sync {
            activeDiscoveredService_locked?.diagnosticLabel
        }
    }

    private func handleBrowseReply(
        flags: DNSServiceFlags,
        interfaceIndex: UInt32,
        errorCode: DNSServiceErrorType,
        serviceName: UnsafePointer<CChar>?,
        regtype: UnsafePointer<CChar>?,
        domain: UnsafePointer<CChar>?
    ) {
        guard errorCode == kDNSServiceErr_NoError else {
            publishDiscoveryError_locked(errorCode)
            return
        }

        guard let serviceName,
              let regtype,
              let domain else {
            return
        }

        let instanceName = String(cString: serviceName)
        let regtypeString = String(cString: regtype)
        let domainString = String(cString: domain)
        let serviceID = Self.serviceID(
            instanceName: instanceName,
            regtype: regtypeString,
            domain: domainString,
            interfaceIndex: interfaceIndex
        )

        if flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0 {
            handleAddedService_locked(
                serviceID: serviceID,
                instanceName: instanceName,
                regtype: regtypeString,
                domain: domainString,
                interfaceIndex: interfaceIndex
            )
        } else {
            handleRemovedService_locked(serviceID: serviceID)
        }
    }

    private func handleAddedService_locked(
        serviceID: String,
        instanceName: String,
        regtype: String,
        domain: String,
        interfaceIndex: UInt32
    ) {
        var service = discoveredServices[serviceID] ?? DiscoveredService(
            id: serviceID,
            instanceName: instanceName,
            regtype: regtype,
            domain: domain,
            interfaceIndex: interfaceIndex,
            resolvedHost: nil,
            port: nil
        )

        service.instanceName = instanceName
        service.regtype = regtype
        service.domain = domain
        service.interfaceIndex = interfaceIndex

        discoveredServices[serviceID] = service

        startResolve_locked(for: service)
        updateActiveServiceSelection_locked()
        publishServerLabel_locked()
    }

    private func handleRemovedService_locked(serviceID: String) {
        cancelResolve_locked(for: serviceID)
        cancelAddressLookup_locked(for: serviceID)
        discoveredServices.removeValue(forKey: serviceID)
        updateActiveServiceSelection_locked()
        publishServerLabel_locked()
    }

    private func startResolve_locked(for service: DiscoveredService) {
        cancelResolve_locked(for: service.id)
        cancelAddressLookup_locked(for: service.id)

        let operation = ResolveOperation(client: self, serviceID: service.id)
        var resolveRef: DNSServiceRef?
        let result = service.instanceName.withCString { namePointer in
            service.regtype.withCString { regtypePointer in
                service.domain.withCString { domainPointer in
                    DNSServiceResolve(
                        &resolveRef,
                        0,
                        service.interfaceIndex,
                        namePointer,
                        regtypePointer,
                        domainPointer,
                        Self.resolveReply,
                        Unmanaged.passUnretained(operation).toOpaque()
                    )
                }
            }
        }

        guard result == kDNSServiceErr_NoError, let resolveRef else {
            return
        }

        operation.ref = resolveRef
        resolveOperations[service.id] = operation

        let queueResult = DNSServiceSetDispatchQueue(resolveRef, networkQueue)
        guard queueResult == kDNSServiceErr_NoError else {
            resolveOperations.removeValue(forKey: service.id)
            DNSServiceRefDeallocate(resolveRef)
            return
        }
    }

    private func cancelResolve_locked(for serviceID: String) {
        guard let operation = resolveOperations.removeValue(forKey: serviceID),
              let ref = operation.ref else {
            return
        }

        DNSServiceRefDeallocate(ref)
    }

    private func handleResolveReply(
        operation: ResolveOperation,
        interfaceIndex: UInt32,
        errorCode: DNSServiceErrorType,
        hostTarget: UnsafePointer<CChar>?,
        port: UInt16
    ) {
        guard resolveOperations[operation.serviceID] === operation else {
            return
        }

        cancelResolve_locked(for: operation.serviceID)

        guard errorCode == kDNSServiceErr_NoError,
              let hostTarget else {
            return
        }

        let hostTargetString = Self.sanitizedHost(String(cString: hostTarget))
        let resolvedPort = Int(UInt16(bigEndian: port))

        guard !hostTargetString.isEmpty, resolvedPort > 0 else {
            return
        }

        if Self.isNumericHost(hostTargetString) {
            completeResolution_locked(serviceID: operation.serviceID, host: hostTargetString, port: resolvedPort)
            return
        }

        startAddressLookup_locked(
            serviceID: operation.serviceID,
            hostTarget: hostTargetString,
            port: resolvedPort,
            interfaceIndex: interfaceIndex
        )
    }

    private func startAddressLookup_locked(
        serviceID: String,
        hostTarget: String,
        port: Int,
        interfaceIndex: UInt32
    ) {
        cancelAddressLookup_locked(for: serviceID)

        let operation = AddressLookupOperation(
            client: self,
            serviceID: serviceID,
            hostTarget: hostTarget,
            port: port
        )

        var addressRef: DNSServiceRef?
        let protocols = DNSServiceProtocol(kDNSServiceProtocol_IPv4 | kDNSServiceProtocol_IPv6)
        let result = hostTarget.withCString { hostPointer in
            DNSServiceGetAddrInfo(
                &addressRef,
                0,
                interfaceIndex,
                protocols,
                hostPointer,
                Self.addressInfoReply,
                Unmanaged.passUnretained(operation).toOpaque()
            )
        }

        guard result == kDNSServiceErr_NoError, let addressRef else {
            completeResolution_locked(serviceID: serviceID, host: hostTarget, port: port)
            return
        }

        operation.ref = addressRef
        addressOperations[serviceID] = operation

        let queueResult = DNSServiceSetDispatchQueue(addressRef, networkQueue)
        guard queueResult == kDNSServiceErr_NoError else {
            addressOperations.removeValue(forKey: serviceID)
            DNSServiceRefDeallocate(addressRef)
            completeResolution_locked(serviceID: serviceID, host: hostTarget, port: port)
            return
        }
    }

    private func cancelAddressLookup_locked(for serviceID: String) {
        guard let operation = addressOperations.removeValue(forKey: serviceID),
              let ref = operation.ref else {
            return
        }

        DNSServiceRefDeallocate(ref)
    }

    private func handleAddressInfoReply(
        operation: AddressLookupOperation,
        flags: DNSServiceFlags,
        errorCode: DNSServiceErrorType,
        address: UnsafePointer<sockaddr>?
    ) {
        guard addressOperations[operation.serviceID] === operation else {
            return
        }

        if errorCode != kDNSServiceErr_NoError {
            completeResolution_locked(serviceID: operation.serviceID, host: operation.hostTarget, port: operation.port)
            cancelAddressLookup_locked(for: operation.serviceID)
            return
        }

        if flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0,
           let address,
           let candidate = Self.addressCandidate(from: address) {
            operation.candidates.append(candidate)
        }

        let hasPreferredIPv4 = operation.candidates.contains { $0.priority == 0 }
        let moreComing = flags & DNSServiceFlags(kDNSServiceFlagsMoreComing) != 0

        if hasPreferredIPv4 || !moreComing {
            let resolvedHost = operation.bestHost ?? operation.hostTarget
            completeResolution_locked(serviceID: operation.serviceID, host: resolvedHost, port: operation.port)
            cancelAddressLookup_locked(for: operation.serviceID)
        }
    }

    private func completeResolution_locked(serviceID: String, host: String, port: Int) {
        guard var service = discoveredServices[serviceID] else {
            return
        }

        service.resolvedHost = host
        service.port = port
        discoveredServices[serviceID] = service

        updateActiveServiceSelection_locked()
        publishServerLabel_locked()
        publishStatus("", isError: false)
    }

    private var activeDiscoveredService_locked: DiscoveredService? {
        guard let activeServiceKey = activeServiceKey else {
            return nil
        }

        return discoveredServices[activeServiceKey]
    }

    private func updateActiveServiceSelection_locked() {
        activeServiceKey = discoveredServices.values.sorted { lhs, rhs in
            if lhs.isResolved != rhs.isResolved {
                return lhs.isResolved && !rhs.isResolved
            }

            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }.first?.id
    }

    private func publishServerLabel_locked() {
        let label: String

        if let activeDiscoveredService = activeDiscoveredService_locked {
            label = activeDiscoveredService.displayLabel
        } else if let fallbackBaseURL = fallbackBaseURL {
            label = Self.hostLabel(for: fallbackBaseURL)
        } else {
            label = "Searching network..."
        }

        DispatchQueue.main.async { [weak self] in
            self?.serverLabel = label
        }
    }

    private func publishStatus(_ message: String, isError: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.statusText = message
            self?.isError = isError
        }
    }

    private func publishDiscoveryError_locked(_ errorCode: DNSServiceErrorType) {
        let message: String
        if errorCode == DNSServiceErrorType(kDNSServiceErr_PolicyDenied) {
            message = "Local network access is required"
        } else {
            message = "Local network discovery failed"
        }

        publishStatus(message, isError: true)
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
        let diagnosticLabel = activeDiscoveredDiagnosticLabel() ?? fallbackHostLabel

        if let remoteError = error as? RemoteCommandError,
           let description = remoteError.errorDescription {
            switch remoteError {
            case .noServerAvailable:
                if let activeService = networkQueue.sync(execute: { activeDiscoveredService_locked }),
                   !activeService.isResolved {
                    return "Resolving server address"
                }

                return description
            default:
                return Self.decorate(description, hostLabel: diagnosticLabel)
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

        return error.localizedDescription
    }

    private static let browseReply: DNSServiceBrowseReply = { _, flags, interfaceIndex, errorCode, serviceName, regtype, replyDomain, context in
        guard let context else {
            return
        }

        let client = Unmanaged<RemoteCommandClient>.fromOpaque(context).takeUnretainedValue()
        client.handleBrowseReply(
            flags: flags,
            interfaceIndex: interfaceIndex,
            errorCode: errorCode,
            serviceName: serviceName,
            regtype: regtype,
            domain: replyDomain
        )
    }

    private static let resolveReply: DNSServiceResolveReply = { _, _, interfaceIndex, errorCode, _, hostTarget, port, _, _, context in
        guard let context else {
            return
        }

        let operation = Unmanaged<ResolveOperation>.fromOpaque(context).takeUnretainedValue()
        operation.client?.handleResolveReply(
            operation: operation,
            interfaceIndex: interfaceIndex,
            errorCode: errorCode,
            hostTarget: hostTarget,
            port: port
        )
    }

    private static let addressInfoReply: DNSServiceGetAddrInfoReply = { _, flags, _, errorCode, _, address, _, context in
        guard let context else {
            return
        }

        let operation = Unmanaged<AddressLookupOperation>.fromOpaque(context).takeUnretainedValue()
        operation.client?.handleAddressInfoReply(
            operation: operation,
            flags: flags,
            errorCode: errorCode,
            address: address
        )
    }

    private static func serviceID(
        instanceName: String,
        regtype: String,
        domain: String,
        interfaceIndex: UInt32
    ) -> String {
        "\(instanceName)|\(regtype)|\(domain)|\(interfaceIndex)"
    }

    private static func sanitizedHost(_ host: String) -> String {
        host.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    private static func isNumericHost(_ host: String) -> Bool {
        var ipv4Address = in_addr()
        if host.withCString({ inet_pton(AF_INET, $0, &ipv4Address) }) == 1 {
            return true
        }

        let baseHost = host.split(separator: "%", maxSplits: 1).first.map(String.init) ?? host
        var ipv6Address = in6_addr()
        return baseHost.withCString({ inet_pton(AF_INET6, $0, &ipv6Address) }) == 1
    }

    private static func addressCandidate(from address: UnsafePointer<sockaddr>) -> AddressCandidate? {
        let family = Int32(address.pointee.sa_family)
        let addressLength: socklen_t

        switch family {
        case AF_INET:
            addressLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        case AF_INET6:
            addressLength = socklen_t(MemoryLayout<sockaddr_in6>.size)
        default:
            return nil
        }

        var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(
            address,
            addressLength,
            &hostBuffer,
            socklen_t(hostBuffer.count),
            nil,
            0,
            NI_NUMERICHOST
        ) == 0 else {
            return nil
        }

        let host = String(cString: hostBuffer)
        guard !host.isEmpty else {
            return nil
        }

        let priority: Int
        switch family {
        case AF_INET:
            priority = 0
        case AF_INET6:
            priority = host.lowercased().hasPrefix("fe80:") ? 2 : 1
        default:
            priority = 3
        }

        return AddressCandidate(host: host, priority: priority)
    }

    private static func displayName(for rawName: String) -> String {
        let trimmedName = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedName.isEmpty ? RemoteConfiguration.serverDisplayName : trimmedName
    }

    private static func commandURL(from baseURL: URL) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.path = "/api/osc"
        components.query = nil
        components.fragment = nil
        return components.url
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

    private static func decorate(_ message: String, hostLabel: String?) -> String {
        guard let hostLabel = hostLabel, !hostLabel.isEmpty else {
            return message
        }

        return "\(message) (\(hostLabel))"
    }
}

private extension RemoteCommandClient {
    struct DiscoveredService {
        let id: String
        var instanceName: String
        var regtype: String
        var domain: String
        var interfaceIndex: UInt32
        var resolvedHost: String?
        var port: Int?

        var name: String {
            RemoteCommandClient.displayName(for: instanceName)
        }

        var isResolved: Bool {
            commandURL != nil
        }

        var baseURL: URL? {
            guard let resolvedHost, let port else {
                return nil
            }

            var components = URLComponents()
            components.scheme = "http"
            components.host = resolvedHost
            components.port = port
            return components.url
        }

        var commandURL: URL? {
            guard let baseURL else {
                return nil
            }

            return RemoteCommandClient.commandURL(from: baseURL)
        }

        var displayLabel: String {
            resolvedHost ?? name
        }

        var diagnosticLabel: String {
            guard let resolvedHost, let port else {
                return name
            }

            return "\(resolvedHost):\(port)"
        }
    }

    final class ResolveOperation {
        weak var client: RemoteCommandClient?
        let serviceID: String
        var ref: DNSServiceRef?

        init(client: RemoteCommandClient, serviceID: String) {
            self.client = client
            self.serviceID = serviceID
        }
    }

    final class AddressLookupOperation {
        weak var client: RemoteCommandClient?
        let serviceID: String
        let hostTarget: String
        let port: Int
        var ref: DNSServiceRef?
        var candidates: [AddressCandidate] = []

        init(client: RemoteCommandClient, serviceID: String, hostTarget: String, port: Int) {
            self.client = client
            self.serviceID = serviceID
            self.hostTarget = hostTarget
            self.port = port
        }

        var bestHost: String? {
            candidates.sorted { lhs, rhs in
                if lhs.priority != rhs.priority {
                    return lhs.priority < rhs.priority
                }

                return lhs.host.localizedStandardCompare(rhs.host) == .orderedAscending
            }.first?.host
        }
    }

    struct AddressCandidate {
        let host: String
        let priority: Int
    }

    struct OSCCommandRequest: Encodable {
        let cmd: String
        let state: Int
    }

    enum RemoteCommandError: LocalizedError {
        case invalidResponse
        case noServerAvailable
        case serverStatus(Int)

        var errorDescription: String? {
            switch self {
            case .invalidResponse:
                return "No HTTP response"
            case .noServerAvailable:
                return "No server discovered yet"
            case .serverStatus(let statusCode):
                return "Server error \(statusCode)"
            }
        }
    }
}
