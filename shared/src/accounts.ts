// Users, reminder settings, and the /api/auth and /api/me endpoints.
import { z } from "zod";
import { Id, InstallationId, LanguageCode, Time } from "./common";

const DisplayName = z.string().min(1).max(80);
const SpeakerName = z.string().min(1).max(80);
const Password = z.string().min(10).max(200);
// Sign-in and account deletion answer invalid_credentials for a wrong password, so only the size is checked.
const GivenPassword = z.string().min(1).max(200);

export const ReminderSettings = z.strictObject({
  embedInMyReminders: z.boolean(),
});
export type ReminderSettings = z.infer<typeof ReminderSettings>;

export const User = z.strictObject({
  id: Id,
  email: z.email(),
  displayName: DisplayName,
  nativeLanguage: LanguageCode,
  speakerNames: z.array(SpeakerName).max(10),
  reminderSettings: ReminderSettings,
  createdAt: Time,
});
export type User = z.infer<typeof User>;

export const UserResponse = z.strictObject({ user: User });
export type UserResponse = z.infer<typeof UserResponse>;

export const SignUpBody = z.strictObject({
  email: z.email(),
  password: Password,
  displayName: DisplayName,
  nativeLanguage: LanguageCode,
});
export type SignUpBody = z.infer<typeof SignUpBody>;

export const SignInBody = z.strictObject({
  email: z.string().min(1),
  password: GivenPassword,
});
export type SignInBody = z.infer<typeof SignInBody>;

export const AppCodeResponse = z.strictObject({ code: z.string().min(1), expiresAt: Time });
export type AppCodeResponse = z.infer<typeof AppCodeResponse>;

export const AppTokenBody = z.strictObject({ code: z.string().min(1), installationId: InstallationId });
export type AppTokenBody = z.infer<typeof AppTokenBody>;

export const AppTokenResponse = z.strictObject({ token: z.string().min(1), user: User });
export type AppTokenResponse = z.infer<typeof AppTokenResponse>;

// reminderSettings is sent whole.
export const PatchMeBody = z.strictObject({
  displayName: DisplayName.optional(),
  nativeLanguage: LanguageCode.optional(),
  speakerNames: z.array(SpeakerName).max(10).optional(),
  reminderSettings: ReminderSettings.optional(),
});
export type PatchMeBody = z.infer<typeof PatchMeBody>;

export const DeleteMeBody = z.strictObject({ password: GivenPassword });
export type DeleteMeBody = z.infer<typeof DeleteMeBody>;
