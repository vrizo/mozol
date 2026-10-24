// English name of a BCP 47 language code ("de" → "German"); the code itself when Intl has no name.
const names = new Intl.DisplayNames(["en"], { type: "language" });

export function languageName(code: string): string {
  return names.of(code) ?? code;
}
