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
        context.insert(InboxEntry(key: "push:1", source: .push, receivedAt: .now.addingTimeInterval(-60), body: pushBody))
        context.insert(InboxEntry(key: "message:m1", source: .server, receivedAt: .now.addingTimeInterval(-600), body: messageBody))
        return environment
    }()

    static let pushBody = """
    {
      "aps" : {
        "content-available" : 1
      },
      "word" : "мозоль"
    }
    """

    static let messageBody = """
    {
      "id" : "m1",
      "text" : "Hola"
    }
    """
}
#endif
