import Foundation
import Network

/// In-process HTTP server for UI tests: canned answers by "METHOD /path", no real worker.
nonisolated final class StubServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "mozol.uitest.stub")
    private let lock = NSLock()
    private var routes: [String: (status: Int, body: String)] = [:]
    private var hits: [String] = []

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
    }

    var baseURL: String { "http://127.0.0.1:\(listener.port!.rawValue)" }

    var requestLines: [String] { lock.withLock { hits } }

    func route(_ key: String, status: Int = 200, body: String) {
        lock.withLock { routes[key] = (status, body) }
    }

    func start() throws {
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.serve(connection)
        }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 5) == .success else {
            throw URLError(.cannotConnectToHost)
        }
    }

    func stop() {
        listener.cancel()
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self, let data, let text = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }
            let requestLine = text.split(separator: "\r\n").first.map(String.init) ?? ""
            let parts = requestLine.split(separator: " ")
            let method = parts.first.map(String.init) ?? ""
            let target = parts.count > 1 ? String(parts[1]) : ""
            let path = target.split(separator: "?").first.map(String.init) ?? target
            let answer = lock.withLock { () -> (Int, String) in
                hits.append("\(method) \(target)")
                return routes["\(method) \(path)"].map { ($0.status, $0.body) } ?? (404, #"{"error":"not_found"}"#)
            }
            let body = Data(answer.1.utf8)
            let head = "HTTP/1.1 \(answer.0) Stub\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
        }
    }
}
