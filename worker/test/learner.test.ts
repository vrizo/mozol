import { describe, expect, it } from "vitest";
import { jamieAdapter } from "../src/sources/jamie";
import { jsonAdapter } from "../src/sources/json";
import { countWords, findLearner, nameMatches } from "../src/sources/learner";
import type { NormalizedTranscript, Participant } from "../src/sources/types";

type Input = Pick<NormalizedTranscript, "participants" | "segments" | "learnerSpeakerHint">;

const USER = { email: "petr@example.com", speakerNames: ["Petr"] };

// A transcript with one turn per speaker; participants carry the emails and the recorder flag.
function transcript(
  speakers: { id: string; name: string; text?: string }[],
  participants: Partial<Participant>[] = [],
  hint: string | null = null,
): Input {
  return {
    segments: speakers.map((s) => ({
      speakerId: s.id,
      speakerName: s.name,
      text: s.text ?? "one two three",
    })),
    participants: participants.map((p) => ({
      id: p.id ?? "",
      name: p.name ?? "",
      email: p.email ?? null,
      isRecorder: p.isRecorder ?? false,
    })),
    learnerSpeakerHint: hint,
  };
}

const LAURA = { id: "s1", name: "Laura Bennett" };
const PETR = { id: "s2", name: "Petr Ivanov" };

describe("findLearner", () => {
  it("takes the speaker the source names as the user first", () => {
    const t = transcript([LAURA, PETR], [], "s1");
    expect(findLearner(t, USER, jsonAdapter)).toEqual({ speakerId: "s1", wordCount: 3 });
  });

  it("skips a hint that is no speaker of the transcript", () => {
    const t = transcript([LAURA, PETR], [], "Nobody");
    expect(findLearner(t, USER, jsonAdapter)?.speakerId).toBe("s2");
  });

  it("takes the recorder", () => {
    const t = transcript([LAURA, PETR], [{ id: "s1", isRecorder: true }]);
    expect(findLearner(t, USER, jamieAdapter)?.speakerId).toBe("s1");
  });

  it("skips a recorder without turns", () => {
    const t = transcript([LAURA, PETR], [{ id: "s9", isRecorder: true }]);
    expect(findLearner(t, USER, jamieAdapter)?.speakerId).toBe("s2");
  });

  it("takes the speaker with the account email, ignoring case", () => {
    const t = transcript([LAURA, PETR], [{ id: "s1", email: "Petr@Example.com" }]);
    expect(findLearner(t, { ...USER, speakerNames: [] }, jamieAdapter)?.speakerId).toBe("s1");
  });

  it("matches a speaker name ignoring case, accents and extra spaces", () => {
    const user = { ...USER, speakerNames: ["  pétr   IVANOV "] };
    expect(findLearner(transcript([LAURA, PETR]), user, jamieAdapter)?.speakerId).toBe("s2");
    const accented = transcript([LAURA, { id: "s2", name: "Pëtr Ivánov" }]);
    expect(findLearner(accented, { ...USER, speakerNames: ["Petr Ivanov"] }, jamieAdapter)?.speakerId).toBe(
      "s2",
    );
  });

  it("matches a speaker name to the first word of a longer name only", () => {
    expect(nameMatches("Petr", "Petr Shardakov")).toBe(true);
    expect(nameMatches("Petr Shardakov", "Petr")).toBe(false);
    expect(nameMatches("Shardakov", "Petr Shardakov")).toBe(false);
    expect(nameMatches("Pet", "Petr")).toBe(false);
    expect(nameMatches("", "Petr")).toBe(false);
  });

  it("gives null when two speakers match a speaker name", () => {
    const t = transcript([PETR, { id: "s3", name: "Petr Smirnov" }, LAURA]);
    expect(findLearner(t, USER, jamieAdapter)).toBeNull();
  });

  it("never matches a placeholder name, also not a saved one", () => {
    const t = transcript([
      { id: "s1", name: "Speaker 1" },
      { id: "s2", name: "Speaker 2" },
    ]);
    const user = { ...USER, speakerNames: ["Speaker 2"] };
    expect(findLearner(t, user, jamieAdapter)).toBeNull();
    expect(findLearner(t, { ...USER, speakerNames: ["Speaker"] }, jamieAdapter)).toBeNull();
    // The json source has no placeholder names.
    expect(findLearner(t, user, jsonAdapter)?.speakerId).toBe("s2");
  });

  it("takes the only speaker, also one with a placeholder name", () => {
    const t = transcript([
      { id: "s1", name: "Speaker 1", text: "a b" },
      { id: "s1", name: "Speaker 1" },
    ]);
    expect(findLearner(t, { ...USER, speakerNames: [] }, jamieAdapter)).toEqual({
      speakerId: "s1",
      wordCount: 5,
    });
  });

  it("gives null when no rule finds a speaker", () => {
    expect(
      findLearner(transcript([LAURA, PETR]), { ...USER, speakerNames: ["Anna"] }, jamieAdapter),
    ).toBeNull();
  });

  it("follows the order of the rules", () => {
    const t = transcript([LAURA, PETR], [{ id: "s1", email: USER.email }], "s1");
    expect(findLearner(t, USER, jsonAdapter)?.speakerId).toBe("s1");
  });
});

describe("countWords", () => {
  it("counts the tokens of the normalized text", () => {
    expect(countWords("It's a good idea — isn't it?")).toBe(8);
    expect(countWords("  ")).toBe(0);
  });
});
