import MozolCore
import SwiftUI
import UIKit

/// The full raw body of one Inbox entry.
struct InboxEntryView: View {
    let entry: InboxEntry

    @State private var didCopy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                VStack(spacing: 0) {
                    CardRow(label: "Source") { Text(entry.source.label) }
                    CardDivider()
                    CardRow(label: "Received") {
                        Text(entry.receivedAt, format: .dateTime.year().month().day().hour().minute().second())
                            .font(.mono(.footnote))
                    }
                }
                .card()

                VStack(alignment: .leading, spacing: Space.s3) {
                    SectionLabel(text: "Body")
                    Text(entry.body)
                        .font(.mono(.footnote))
                        .foregroundStyle(Color.ink)
                        .textSelection(.enabled)
                        .padding(Space.s4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .card()
                        .accessibilityIdentifier("inboxEntry.body")
                }
            }
            .padding(Space.s4)
        }
        .paperBackground()
        .navigationTitle("Message")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: copy) {
                    if didCopy {
                        Text("Copied")
                    } else {
                        Text("Copy")
                    }
                }
                .tint(Color.ink)
            }
        }
        .sensoryFeedback(.success, trigger: didCopy) { _, new in new }
    }

    private func copy() {
        UIPasteboard.general.string = entry.body
        Log.ui.info("inbox entry copied bytes=\(entry.body.utf8.count)")
        didCopy = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            didCopy = false
        }
    }
}
