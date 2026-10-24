import Foundation
import Testing
@testable import MozolCore

struct RequestIDTests {
    @Test func hasTwelveLowercaseHexCharacters() {
        for _ in 0..<200 {
            let id = RequestID.make()
            #expect(id.count == 12)
            #expect(id.allSatisfy { "0123456789abcdef".contains($0) })
        }
    }
}

struct RawJSONTests {
    @Test func prettyPrintsJSONWithSortedKeys() throws {
        let text = try RawJSON.display(Data(#"{"b":1,"a":"x/y"}"#.utf8))
        #expect(text == "{\n  \"a\" : \"x/y\",\n  \"b\" : 1\n}")
    }

    @Test func keepsNonJSONText() throws {
        #expect(try RawJSON.display(Data("plain text".utf8)) == "plain text")
    }

    @Test func rejectsBytesThatAreNotUTF8() {
        #expect(throws: RawJSON.Failure.notUTF8) { try RawJSON.display(Data([0xff, 0xfe, 0xfd])) }
    }

    @Test func previewSkipsTheOpeningBrace() throws {
        let text = try RawJSON.text(from: ["aps": ["content-available": 1]])
        #expect(RawJSON.preview(text) == "\"aps\" : {")
    }

    @Test func previewCutsLongLines() {
        #expect(RawJSON.preview(String(repeating: "a", count: 100), limit: 10) == "aaaaaaaaaa…")
    }
}

struct MessagesPageTests {
    @Test func decodesMessagesAndCursor() throws {
        let data = Data(#"{"messages":[{"id":"m1","text":"hi"},{"id":"m2"}],"cursor":"m2"}"#.utf8)
        let page = try MessagesPage.decode(data)
        #expect(page.messages.map(\.id) == ["m1", "m2"])
        #expect(page.messages[0].raw.contains("\"text\" : \"hi\""))
        #expect(page.cursor == "m2")
    }

    @Test func nullCursorIsNil() throws {
        let page = try MessagesPage.decode(Data(#"{"messages":[],"cursor":null}"#.utf8))
        #expect(page.messages.isEmpty)
        #expect(page.cursor == nil)
    }

    @Test func messageWithoutIDFails() {
        #expect(throws: MessagesPage.Failure.messageWithoutID(index: 1)) {
            try MessagesPage.decode(Data(#"{"messages":[{"id":"a"},{"text":"x"}]}"#.utf8))
        }
    }

    @Test func missingMessagesFails() {
        #expect(throws: MessagesPage.Failure.missingMessages) { try MessagesPage.decode(Data(#"{"cursor":"x"}"#.utf8)) }
    }

    @Test func numericCursorFails() {
        #expect(throws: MessagesPage.Failure.invalidCursor) {
            try MessagesPage.decode(Data(#"{"messages":[],"cursor":5}"#.utf8))
        }
    }
}

struct CredentialsTests {
    @Test(arguments: ["a@b.co", "  name@example.com ", "x.y@mail.example.org"])
    func validEmails(_ email: String) {
        #expect(Credentials(email: email, password: "p").isComplete)
    }

    @Test(arguments: ["", "name", "name@", "@example.com", "name@example", "na me@example.com", "a@b@c.com", "a@b..com"])
    func invalidEmails(_ email: String) {
        #expect(!Credentials(email: email, password: "p").isEmailValid)
    }

    @Test func emptyPasswordIsIncomplete() {
        #expect(!Credentials(email: "a@b.co", password: "").isComplete)
    }
}

struct ReminderDraftTests {
    @Test func needsTitleAndList() {
        #expect(!ReminderDraft(title: "  ", listID: "l").canSave)
        #expect(!ReminderDraft(title: "Buy", listID: nil).canSave)
        #expect(ReminderDraft(title: " Buy ", listID: "l").canSave)
    }

    @Test func emptyNotesAreStoredAsNil() {
        #expect(ReminderDraft(notes: " \n").storedNotes == nil)
        #expect(ReminderDraft(notes: " x ").storedNotes == "x")
    }
}

struct SmallTypesTests {
    @Test func deviceTokenHex() {
        #expect(DeviceToken.hex(Data([0x00, 0xab, 0x10])) == "00ab10")
    }

    @Test func eventTriggersCarryNoPayload() {
        #expect(AppEvent.silentPush(raw: "secret").trigger == "push")
        #expect(AppEvent.shortcut(name: "x").trigger == "shortcut")
    }
}
