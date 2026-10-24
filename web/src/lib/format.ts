// Dates and times in the browser's locale and time zone.
const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
