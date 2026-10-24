import Foundation

/// The shapes of shared/CONTRACT.md that the app sends and reads. Field names follow the contract exactly.
public enum Contract {
    public static let decoder = JSONDecoder()

    public static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()
}

public struct ErrorBody: Codable, Equatable, Sendable {
    public let error: String
}

// MARK: Accounts

public struct ReminderSettings: Codable, Equatable, Sendable {
    public let embedInMyReminders: Bool
}

public struct User: Codable, Equatable, Sendable {
    public let id: String
    public let email: String
    public let displayName: String
    public let nativeLanguage: String
    public let speakerNames: [String]
    public let reminderSettings: ReminderSettings
    public let createdAt: String
}

public struct AppTokenBody: Codable, Equatable, Sendable {
    public let code: String
    public let installationId: String

    public init(code: String, installationId: String) {
        self.code = code
        self.installationId = installationId
    }
}

public struct AppTokenResponse: Codable, Equatable, Sendable {
    public let token: String
    public let user: User
}

public struct UserResponse: Codable, Equatable, Sendable {
    public let user: User
}

// MARK: Devices

public enum RemindersAccess: String, Codable, Sendable {
    case full, writeOnly = "write_only", denied, restricted, notDetermined = "not_determined"
}

public enum APNsEnvironment: String, Codable, Sendable { case sandbox, production }

public struct PutDeviceBody: Codable, Equatable, Sendable {
    public let platform: String
    public let bundleId: String
    public let appVersion: String?
    public let osVersion: String?
    public let apnsToken: String?
    public let apnsEnvironment: APNsEnvironment?
    public let remindersAccess: RemindersAccess

    /// apnsEnvironment is sent only together with a token, as the contract requires.
    public init(
        bundleId: String,
        appVersion: String?,
        osVersion: String?,
        apnsToken: String?,
        environment: APNsEnvironment,
        remindersAccess: RemindersAccess
    ) {
        platform = "ios"
        self.bundleId = bundleId
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.apnsToken = apnsToken
        apnsEnvironment = apnsToken == nil ? nil : environment
        self.remindersAccess = remindersAccess
    }

    /// Nulls are written out: a `T | null` field is always present.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(platform, forKey: .platform)
        try container.encode(bundleId, forKey: .bundleId)
        try container.encode(appVersion, forKey: .appVersion)
        try container.encode(osVersion, forKey: .osVersion)
        try container.encode(apnsToken, forKey: .apnsToken)
        try container.encode(apnsEnvironment, forKey: .apnsEnvironment)
        try container.encode(remindersAccess, forKey: .remindersAccess)
    }
}

public struct Device: Codable, Equatable, Sendable {
    public let id: String
    public let installationId: String
    public let pushEnabled: Bool
    public let lastSeenAt: String
}

public struct DeviceResponse: Codable, Equatable, Sendable {
    public let device: Device
}

/// installationId: 8..64 letters, digits, "-" and "_", made once per install.
public enum InstallationID {
    public static func make() -> String { UUID().uuidString.lowercased() }

    public static func isValid(_ value: String) -> Bool {
        (8...64).contains(value.count) && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }
}

// MARK: Deliveries

public struct MatchTerm: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable { case word, prefix, phrase, substring }

    public let text: String
    public let lang: String
    public let mode: Mode

    public init(text: String, lang: String, mode: Mode) {
        self.text = text
        self.lang = lang
        self.mode = mode
    }
}

public enum RecommendationKind: String, Codable, Sendable { case mistake, word, phrase, rewrite }

public struct DeliveryRecommendation: Codable, Equatable, Sendable {
    public let id: String
    public let language: String
    public let kind: RecommendationKind
    public let itemKey: String
    public let marker: String
    public let title: String
    public let notes: String
    public let embedLine: String
    public let matchTerms: [MatchTerm]
    public let url: String
}

public struct DeliveryItem: Codable, Equatable, Sendable {
    public let deliveryId: String
    public let recommendation: DeliveryRecommendation
}

public struct ClaimBody: Codable, Equatable, Sendable {
    public let installationId: String
    public let limit: Int

    public init(installationId: String, limit: Int) {
        self.installationId = installationId
        self.limit = limit
    }
}

public struct ClaimResponse: Codable, Equatable, Sendable {
    public let deliveries: [DeliveryItem]
    public let leaseSeconds: Int
    public let embedInMyReminders: Bool
}

public enum DeliveryOutcome: String, Codable, Sendable {
    case embedUpdated = "embed_updated"
    case reminderUpdated = "reminder_updated"
    case embedded
    case created
}

public struct DeliveryResult: Codable, Equatable, Sendable {
    /// A DeliveryOutcome raw value or "failed".
    public let deliveryId: String
    public let outcome: String
    public let errorCode: String?

    public static func applied(_ deliveryId: String, _ outcome: DeliveryOutcome) -> DeliveryResult {
        DeliveryResult(deliveryId: deliveryId, outcome: outcome.rawValue, errorCode: nil)
    }

    public static func failed(_ deliveryId: String, code: String) -> DeliveryResult {
        DeliveryResult(deliveryId: deliveryId, outcome: "failed", errorCode: code)
    }
}

public struct ResultsBody: Codable, Equatable, Sendable {
    public let installationId: String
    public let results: [DeliveryResult]

    public init(installationId: String, results: [DeliveryResult]) {
        self.installationId = installationId
        self.results = results
    }
}

public struct ResultsResponse: Codable, Equatable, Sendable {
    public let accepted: Int
}

// MARK: Push

/// The `mozol` key of a silent push.
public struct PushMessage: Equatable, Sendable {
    public enum Kind: String, Sendable { case deliveries, test }

    public enum Failure: Error, Equatable {
        case missingMozolKey
        case unsupportedVersion
        case unknownType(String)
    }

    public let kind: Kind
    public let pending: Int?

    public static func parse(_ userInfo: [String: Any]) throws -> PushMessage {
        guard let mozol = userInfo["mozol"] as? [String: Any] else { throw Failure.missingMozolKey }
        guard (mozol["v"] as? NSNumber)?.intValue == 1 else { throw Failure.unsupportedVersion }
        let type = mozol["type"] as? String ?? ""
        guard let kind = Kind(rawValue: type) else { throw Failure.unknownType(type) }
        return PushMessage(kind: kind, pending: (mozol["pending"] as? NSNumber)?.intValue)
    }
}
