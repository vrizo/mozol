import Foundation
import Testing
@testable import MozolCore

/// shared/fixtures/ in the repository.
enum Fixture {
    static let root = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "shared/fixtures")

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: root.appending(path: path))
    }
}

struct RequestIDTests {
    @Test func hasTwelveLowercaseHexCharacters() {
        for _ in 0..<200 {
            let id = RequestID.make()
            #expect(id.count == 12)
            #expect(id.allSatisfy { "0123456789abcdef".contains($0) })
        }
    }
}

struct SmallTypesTests {
    @Test func deviceTokenHex() {
        #expect(DeviceToken.hex(Data([0x00, 0xab, 0x10])) == "00ab10")
    }

    @Test func eventTriggers() {
        #expect(AppEvent.silentPush.trigger == "push")
        #expect(AppEvent.shortcut(name: "x").trigger == "shortcut")
    }

    @Test func installationIDFitsTheContract() {
        let id = InstallationID.make()
        #expect(InstallationID.isValid(id))
        #expect(!InstallationID.isValid("short"))
        #expect(!InstallationID.isValid("has space in it"))
    }
}

struct MatchingCasesTests {
    struct Case: Decodable {
        let text: String
        let terms: [MatchTerm]
        let expectedScore: Int
        let note: String
    }

    static let cases: [Case] = {
        do {
            return try Contract.decoder.decode([Case].self, from: Fixture.data("matching/cases.json"))
        } catch {
            fatalError("matching/cases.json: \(error)")
        }
    }()

    @Test func fixtureHasCases() {
        #expect(Self.cases.count >= 25)
    }

    @Test(arguments: cases.indices)
    func sharedCase(_ index: Int) throws {
        let item = Self.cases[index]
        #expect(try TextMatching.score(item.terms, text: item.text) == item.expectedScore, "\(item.note)")
    }

    @Test func normalizationSteps() {
        #expect(TextMatching.normalize("  Straße, Müller!  ") == "straße muller")
        #expect(TextMatching.normalize("Ёлка — ﬁne") == "елка fine")
        #expect(TextMatching.normalize("...") == "")
    }

    @Test func termRulesAreChecked() {
        #expect(throws: TextMatching.TermProblem.prefixTooShort) {
            try TextMatching.normalizeTerm(MatchTerm(text: "abc", lang: "en", mode: .prefix))
        }
        #expect(throws: TextMatching.TermProblem.hasSpace) {
            try TextMatching.normalizeTerm(MatchTerm(text: "two words", lang: "en", mode: .word))
        }
        #expect(throws: TextMatching.TermProblem.phraseTooShort) {
            try TextMatching.normalizeTerm(MatchTerm(text: "one", lang: "en", mode: .phrase))
        }
        #expect(throws: TextMatching.TermProblem.empty) {
            try TextMatching.normalizeTerm(MatchTerm(text: "!!", lang: "en", mode: .substring))
        }
    }
}

struct ContractTests {
    @Test func claimResponseFixtureDecodes() throws {
        let claim = try Contract.decoder.decode(ClaimResponse.self, from: Fixture.data("deliveries/claim-response.json"))
        #expect(claim.deliveries.map(\.recommendation.marker) == ["01bf5320", "fd2dd8e3"])
        #expect(claim.deliveries[1].recommendation.matchTerms.map(\.mode) == [.phrase, .word, .prefix])
        #expect(claim.leaseSeconds == 120)
        #expect(claim.embedInMyReminders)
    }

    @Test func pushFixturesParse() throws {
        let deliveries = try JSONSerialization.jsonObject(with: Fixture.data("push/deliveries.json")) as! [String: Any]
        #expect(try PushMessage.parse(deliveries) == PushMessage(kind: .deliveries, pending: 2))
        let test = try JSONSerialization.jsonObject(with: Fixture.data("push/test.json")) as! [String: Any]
        #expect(try PushMessage.parse(test) == PushMessage(kind: .test, pending: nil))
    }

    @Test func unknownPushIsRefused() {
        #expect(throws: PushMessage.Failure.missingMozolKey) { try PushMessage.parse(["aps": [:]]) }
        #expect(throws: PushMessage.Failure.unsupportedVersion) { try PushMessage.parse(["mozol": ["v": 2, "type": "test"]]) }
        #expect(throws: PushMessage.Failure.unknownType("tip")) { try PushMessage.parse(["mozol": ["v": 1, "type": "tip"]]) }
    }

    @Test func deviceBodyWritesNullsAndDropsTheEnvironmentWithoutAToken() throws {
        let body = PutDeviceBody(
            bundleId: "net.vrizo.mozol", appVersion: "0.1.0 (1)", osVersion: nil,
            apnsToken: nil, environment: .sandbox, remindersAccess: .full
        )
        let json = try JSONSerialization.jsonObject(with: Contract.encoder.encode(body)) as! [String: Any]
        #expect(json["apnsToken"] is NSNull)
        #expect(json["apnsEnvironment"] is NSNull)
        #expect(json["osVersion"] is NSNull)
        #expect(json["platform"] as? String == "ios")
        #expect(json["remindersAccess"] as? String == "full")
        #expect(json.count == 7)
    }

    @Test func failedResultCarriesItsCode() throws {
        let json = String(decoding: try Contract.encoder.encode(DeliveryResult.failed("dlv_1", code: "eventkit_save")), as: UTF8.self)
        #expect(json == #"{"deliveryId":"dlv_1","errorCode":"eventkit_save","outcome":"failed"}"#)
        let applied = String(decoding: try Contract.encoder.encode(DeliveryResult.applied("dlv_1", .embedUpdated)), as: UTF8.self)
        #expect(applied == #"{"deliveryId":"dlv_1","outcome":"embed_updated"}"#)
    }
}

struct HiddenTagTests {
    @Test func roundTripsEveryHexDigit() throws {
        for marker in ["01234567", "89abcdef", "01bf5320", "fd2dd8e3", "00000000", "ffffffff"] {
            let tag = try HiddenTag.make(marker: marker)
            #expect(tag.unicodeScalars.count == 19)
            #expect(tag.unicodeScalars.allSatisfy { $0.properties.generalCategory == .format })
            #expect(HiddenTag.parse(line: "Buy milk" + tag).marker == marker)
        }
    }

    @Test func refusesABadMarker() {
        #expect(throws: HiddenTag.Failure.invalidMarker("ABCDEF12")) { try HiddenTag.make(marker: "ABCDEF12") }
        #expect(throws: HiddenTag.Failure.invalidMarker("abc")) { try HiddenTag.make(marker: "abc") }
    }

    @Test func tellsAnAddedLineFromAnOwnTag() throws {
        let tag = try HiddenTag.make(marker: "fd2dd8e3")
        let added = HiddenTag.parse(line: "MOZOL: make a decision" + tag)
        #expect(added.isAddedLine && !added.isOwnTag)
        #expect(added.text == "MOZOL: make a decision")
        let own = HiddenTag.parse(line: " " + tag)
        #expect(own.isOwnTag && !own.isAddedLine)
        let plain = HiddenTag.parse(line: "Call mom")
        #expect(plain.marker == nil && !plain.hasBrokenTag)
    }

    @Test func aCutTagIsBroken() throws {
        let tag = try HiddenTag.make(marker: "fd2dd8e3")
        let cut = String(String.UnicodeScalarView(tag.unicodeScalars.prefix(10)))
        let line = HiddenTag.parse(line: "x" + cut)
        #expect(line.marker == nil)
        #expect(line.hasBrokenTag)
    }
}

struct DeliveryPlannerTests {
    let claim: ClaimResponse
    /// The word delivery: marker fd2dd8e3, terms "make a decision", "decision", "решени".
    var word: DeliveryItem { claim.deliveries[1] }
    var mistake: DeliveryItem { claim.deliveries[0] }

    init() throws {
        claim = try Contract.decoder.decode(ClaimResponse.self, from: Fixture.data("deliveries/claim-response.json"))
    }

    private func tag(_ marker: String) -> String { try! HiddenTag.make(marker: marker) }

    private func reminder(_ id: String, _ title: String, notes: String = "", completed: Bool = false, modified: TimeInterval = 0) -> ReminderSnapshot {
        ReminderSnapshot(id: id, title: title, notes: notes, isCompleted: completed, lastModified: Date(timeIntervalSince1970: modified))
    }

    @Test func createsWhenNothingMatches() throws {
        let plan = try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: [reminder("a", "Buy milk")])
        guard case let .create(content) = plan else { Issue.record("\(plan)"); return }
        #expect(content.title == word.recommendation.title)
        #expect(content.notes == word.recommendation.notes + "\n" + tag("fd2dd8e3"))
        #expect(content.url?.absoluteString == word.recommendation.url)
        #expect(content.priority == 5)
        #expect(plan.outcome == .created)
    }

    @Test func embedsIntoTheBestMatchingReminder() throws {
        let reminders = [
            reminder("a", "Decision on pricing", modified: 10),
            reminder("b", "Make a decision about the decision memo", notes: "Принять решение\n\n", modified: 5),
            reminder("c", "Buy milk", modified: 99),
        ]
        let plan = try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders)
        #expect(plan == .embed(NotesChange(reminderID: "b", notes: "Принять решение\n" + word.recommendation.embedLine + tag("fd2dd8e3"))))
    }

    @Test func tiesGoToTheNewestThenTheSmallerID() throws {
        let reminders = [reminder("b", "decision", modified: 5), reminder("a", "decision", modified: 5), reminder("c", "decision", modified: 1)]
        let plan = try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders)
        guard case let .embed(change) = plan else { Issue.record("\(plan)"); return }
        #expect(change.reminderID == "a")
        #expect(change.notes == word.recommendation.embedLine + tag("fd2dd8e3"))
    }

    @Test func updatesTheLineItAddedEarlier() throws {
        let old = "Prepare slides\nMOZOL: old text" + tag("fd2dd8e3") + "\nlast line"
        let reminders = [reminder("a", "Slides", notes: old), reminder("b", "decision")]
        let plan = try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders)
        let expected = "Prepare slides\n" + word.recommendation.embedLine + tag("fd2dd8e3") + "\nlast line"
        #expect(plan == .embedUpdate([NotesChange(reminderID: "a", notes: expected)]))
    }

    @Test func updatesItsOwnReminderEvenWhenCompleted() throws {
        let reminders = [
            reminder("own1", "old title", notes: "old\n" + tag("fd2dd8e3"), completed: true, modified: 1),
            reminder("own2", "old title", notes: tag("fd2dd8e3"), completed: true, modified: 7),
            reminder("b", "decision"),
        ]
        let plan = try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders)
        guard case let .reminderUpdate(id, content) = plan else { Issue.record("\(plan)"); return }
        #expect(id == "own2")
        #expect(content.title == word.recommendation.title)
    }

    @Test func neverEmbedsIntoItsOwnReminderOrACompletedOne() throws {
        let reminders = [
            reminder("own", "decision", notes: tag("01bf5320")),
            reminder("done", "decision", completed: true),
        ]
        #expect(try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders).outcome == .created)
    }

    @Test func linesItAddedDoNotCountForTheScore() throws {
        let reminders = [reminder("a", "Shopping", notes: "MOZOL: decision" + tag("01bf5320"))]
        #expect(try DeliveryPlanner.plan(word, embedInMyReminders: true, reminders: reminders).outcome == .created)
    }

    @Test func embedOffSkipsTheUserReminders() throws {
        let reminders = [reminder("a", "Slides", notes: "x" + tag("fd2dd8e3")), reminder("b", "decision")]
        #expect(try DeliveryPlanner.plan(word, embedInMyReminders: false, reminders: reminders).outcome == .created)
    }

    @Test func noMatchTermsMeansCreate() throws {
        #expect(mistake.recommendation.matchTerms.isEmpty)
        let plan = try DeliveryPlanner.plan(mistake, embedInMyReminders: true, reminders: [reminder("a", "I saw it yesterday")])
        #expect(plan.outcome == .created)
    }
}
