import Foundation
import MozolCore
import SwiftData

/// What the app did with one delivery, for the Placed screen. Stays until sign-out.
@Model
final class DeliveryRecord {
    @Attribute(.unique) var deliveryID: String
    var recommendationID: String
    var kindRaw: String
    var title: String
    /// A DeliveryOutcome raw value, or "failed".
    var outcomeRaw: String
    var errorCode: String?
    var at: Date

    init(deliveryID: String, recommendationID: String, kind: RecommendationKind, title: String, outcome: String, errorCode: String?, at: Date) {
        self.deliveryID = deliveryID
        self.recommendationID = recommendationID
        self.kindRaw = kind.rawValue
        self.title = title
        self.outcomeRaw = outcome
        self.errorCode = errorCode
        self.at = at
    }

    var kind: RecommendationKind {
        guard let kind = RecommendationKind(rawValue: kindRaw) else { fatalError("unknown kind \(kindRaw)") }
        return kind
    }

    /// nil for a failed delivery.
    var outcome: DeliveryOutcome? { DeliveryOutcome(rawValue: outcomeRaw) }
}
