/// X-Request-Id values: 12 lowercase hex characters, one per request.
public enum RequestID {
    public static let header = "X-Request-Id"

    public static func make() -> String {
        var generator = SystemRandomNumberGenerator()
        return make(using: &generator)
    }

    public static func make<G: RandomNumberGenerator>(using generator: inout G) -> String {
        let value = UInt64.random(in: 0..<(1 << 48), using: &generator)
        let hex = String(value, radix: 16)
        return String(repeating: "0", count: 12 - hex.count) + hex
    }
}
