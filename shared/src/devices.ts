// The user's iOS devices, their Reminders access and push registration.
import { z } from "zod";
import { Id, InstallationId, Time } from "./common";

export const RemindersAccess = z.enum(["full", "write_only", "denied", "restricted", "not_determined"]);
export type RemindersAccess = z.infer<typeof RemindersAccess>;

export const Device = z.strictObject({
  id: Id,
  installationId: InstallationId,
  platform: z.literal("ios"),
  appVersion: z.string().nullable(),
  osVersion: z.string().nullable(),
  // Has an APNs token that APNs did not reject.
  pushEnabled: z.boolean(),
  remindersAccess: RemindersAccess,
  lastSeenAt: Time,
});
export type Device = z.infer<typeof Device>;

export const PutDeviceBody = z
  .strictObject({
    platform: z.literal("ios"),
    bundleId: z.string().min(1).max(200),
    appVersion: z.string().min(1).max(50).nullable(),
    osVersion: z.string().min(1).max(50).nullable(),
    apnsToken: z
      .string()
      .regex(/^[0-9a-f]{64,200}$/)
      .nullable(),
    apnsEnvironment: z.enum(["sandbox", "production"]).nullable(),
    remindersAccess: RemindersAccess,
  })
  .refine((body) => (body.apnsToken === null) === (body.apnsEnvironment === null), {
    path: ["apnsEnvironment"],
    message: "apnsEnvironment is null exactly when apnsToken is null",
  });
export type PutDeviceBody = z.infer<typeof PutDeviceBody>;

export const DeviceResponse = z.strictObject({ device: Device });
export type DeviceResponse = z.infer<typeof DeviceResponse>;

export const DevicesResponse = z.strictObject({ devices: z.array(Device) });
export type DevicesResponse = z.infer<typeof DevicesResponse>;

export const TestPushResponse = z.strictObject({ ok: z.literal(true) });
export type TestPushResponse = z.infer<typeof TestPushResponse>;
