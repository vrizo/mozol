import Foundation
import MozolCore

enum APIError: Error, Equatable {
    /// The server answered with a status other than 2xx. `code` is the `error` field of the body, when there is one.
    case http(status: Int, code: String?)
    /// The request did not reach the server or got no answer.
    case unreachable
    /// The server answered, but the body is not what the contract says.
    case unreadable
}

/// HTTP to the worker. Every request carries X-Request-Id and is logged on the way out and back.
final class APIClient {
    private let baseURL: URL
    private let urlSession: URLSession
    private let token: () -> String?

    init(baseURL: URL, urlSession: URLSession, token: @escaping () -> String?) {
        self.baseURL = baseURL
        self.urlSession = urlSession
        self.token = token
    }

    func get(_ path: String, query: [URLQueryItem] = []) async throws(APIError) -> Data {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        return try await send(URLRequest(url: url), path: path)
    }

    func post(_ path: String, json body: some Encodable) async throws(APIError) -> Data {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            fatalError("request body for \(path) does not encode: \(error)")
        }
        return try await send(request, path: path)
    }

    private func send(_ request: URLRequest, path: String) async throws(APIError) -> Data {
        var request = request
        let rid = RequestID.make()
        let method = request.httpMethod ?? "GET"
        request.setValue(rid, forHTTPHeaderField: RequestID.header)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = token() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 20

        Log.api.info("-> \(method, privacy: .public) \(path, privacy: .public) rid=\(rid, privacy: .public)")
        let started = ContinuousClock.now
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            let code = (error as? URLError)?.code.rawValue ?? 0
            Log.api.error("<- \(method, privacy: .public) \(path, privacy: .public) rid=\(rid, privacy: .public) unreachable urlError=\(code)")
            throw .unreachable
        }
        let ms = Int((ContinuousClock.now - started) / .milliseconds(1))
        guard let http = response as? HTTPURLResponse else {
            Log.api.error("<- \(method, privacy: .public) \(path, privacy: .public) rid=\(rid, privacy: .public) not HTTP")
            throw .unreadable
        }
        Log.api.info("<- \(http.statusCode) \(method, privacy: .public) \(path, privacy: .public) rid=\(rid, privacy: .public) ms=\(ms) bytes=\(data.count)")
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw .http(status: http.statusCode, code: code)
        }
        return data
    }
}
