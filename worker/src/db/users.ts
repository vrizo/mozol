// The users table and its mapping to the API User (shared/CONTRACT.md). reminder_settings is stored in snake_case.
import { type ReminderSettings, User } from "shared";
import { z } from "zod";
import { readJson, writeJson } from "./json";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  native_language: string;
  speaker_names: string;
  reminder_settings: string;
  created_at: string;
  updated_at: string;
};

const SpeakerNamesColumn = z.array(z.string());

const ReminderSettingsColumn = z.strictObject({
  embed_in_my_reminders: z.boolean(),
});

export function userFromRow(row: UserRow): User {
  const settings = readJson(row.reminder_settings, ReminderSettingsColumn, "users.reminder_settings");
  return User.parse({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    nativeLanguage: row.native_language,
    speakerNames: readJson(row.speaker_names, SpeakerNamesColumn, "users.speaker_names"),
    reminderSettings: { embedInMyReminders: settings.embed_in_my_reminders },
    createdAt: row.created_at,
  });
}

export function reminderSettingsColumn(settings: ReminderSettings): string {
  return writeJson({ embed_in_my_reminders: settings.embedInMyReminders });
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}
