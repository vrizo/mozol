#if DEBUG
import Foundation
import MozolCore
import SwiftData

/// Sample data for SwiftUI previews. Previews never touch the network.
enum PreviewData {
    static let environment: AppEnvironment = {
        let defaults = UserDefaults(suiteName: "mozol.preview")!
        let environment = AppEnvironment(
            config: Config(baseURL: URL(string: "http://preview.invalid")!),
            defaults: defaults,
            keychainService: "net.vrizo.mozol.preview",
            inMemory: true
        )
        let context = environment.modelContainer.mainContext
        for record in records { context.insert(record) }
        return environment
    }()

    static var records: [DeliveryRecord] {
        [
            DeliveryRecord(deliveryID: "dlv_1", recommendationID: "rec_1", kind: .word, title: "make a decision — принять решение",
                           outcome: "embedded", errorCode: nil, at: .now.addingTimeInterval(-60)),
            DeliveryRecord(deliveryID: "dlv_2", recommendationID: "rec_2", kind: .mistake, title: "I saw it yesterday",
                           outcome: "created", errorCode: nil, at: .now.addingTimeInterval(-600)),
            DeliveryRecord(deliveryID: "dlv_3", recommendationID: "rec_3", kind: .phrase, title: "Let me think about it",
                           outcome: "failed", errorCode: "no_default_list", at: .now.addingTimeInterval(-900)),
        ]
    }
}
#endif
