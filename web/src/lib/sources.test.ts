import { describe, expect, it } from "vitest";
import { formatSize, outcomeWithError, sampleCurl, shellQuote } from "./sources";

describe("shellQuote", () => {
  it("wraps in single quotes and escapes single quotes", () => {
    expect(shellQuote("abc")).toBe("'abc'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("$(rm -rf /) `x`")).toBe("'$(rm -rf /) `x`'");
  });
});

describe("sampleCurl", () => {
  it("quotes the URL and the compact body", () => {
    const command = sampleCurl("https://mozol.vrizo.net/api/hooks/json/abc", '{ "text": "I\'m here" }');
    expect(command).toBe(
      [
        "curl -X POST 'https://mozol.vrizo.net/api/hooks/json/abc'",
        "  -H 'Content-Type: application/json'",
        `  --data '{"text":"I'\\''m here"}'`,
      ].join(" \\\n"),
    );
  });

  it("uses the shared json fixture by default", () => {
    const command = sampleCurl("https://x.test/api/hooks/json/t");
    expect(command).toContain('"segments":[');
    expect(command).toContain("learnerSpeaker");
  });
});

describe("formatting", () => {
  it("formats sizes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1500)).toBe("1.5 KB");
    expect(formatSize(2_500_000)).toBe("2.5 MB");
  });

  it("adds the error code to the outcome", () => {
    const names = { accepted: "Accepted", duplicate: "Duplicate", ignored: "Ignored", refused: "Refused" };
    expect(outcomeWithError("accepted", null, names)).toBe("Accepted");
    expect(outcomeWithError("refused", "payload_invalid", names)).toBe("Refused: payload_invalid");
  });
});
