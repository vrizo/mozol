// Language choices for the profile and sign-up forms.

const codes = (
  "af am ar az be bg bn bs ca cs cy da de el en eo es et eu fa fi fil fr ga gl gu ha he hi hr ht hu " +
  "hy id ig is it ja jv ka kk km kn ko ku ky la lb lo lt lv mg mi mk ml mn mr ms mt my ne nl no ny " +
  "or pa pl ps pt ro ru rw sd si sk sl sm sn so sq sr st su sv sw ta te tg th tk tl tr tt ug uk ur " +
  "uz vi xh yi yo zh zu"
).split(" ");

const names = new Intl.DisplayNames(["en"], { type: "language" });

export function languageName(code: string): string {
  return names.of(code) ?? code;
}

export function languageOptions(current?: string): { value: string; label: string }[] {
  const list = current && !codes.includes(current) ? [...codes, current] : codes;
  return list
    .map((code) => ({ value: code, label: languageName(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function browserLanguage(): string {
  const primary = (navigator.language || "en").split("-")[0]?.toLowerCase() ?? "en";
  return /^[a-z]{2,3}$/.test(primary) ? primary : "en";
}
