// Profile: details, your names in transcripts, reminder settings, sign out and account deletion.

import { type FormEvent, useState } from "react";
import type { ReminderSettings } from "shared";
import { ApiError, deleteMe, patchMe } from "../api";
import { copy } from "../copy/en";
import { languageOptions } from "../languages";
import { fieldErrors } from "../lib/auth";
import { navigate } from "../router";
import { useSession, useUser } from "../session";
import { Button, Checkbox, ConfirmDialog, Select, TextField } from "../ui/controls";
import { errorCode, Notice, PageHeader } from "../ui/states";
import "./auth.css";

const t = copy.profile;
const MAX_SPEAKERS = 10;

function fieldText(code: string | undefined): string | null {
  if (!code) return null;
  return copy.auth.fieldErrors[code] ?? copy.auth.fieldError(code);
}

export function ProfilePage() {
  const user = useUser();
  const session = useSession();
  const [form, setForm] = useState({
    displayName: user.displayName,
    nativeLanguage: user.nativeLanguage,
    speakerNames: user.speakerNames,
    reminderSettings: user.reminderSettings,
  });
  const [newSpeaker, setNewSpeaker] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setReminders = (changes: Partial<ReminderSettings>) =>
    setForm({ ...form, reminderSettings: { ...form.reminderSettings, ...changes } });

  const addSpeaker = () => {
    const name = newSpeaker.trim();
    if (!name || form.speakerNames.includes(name) || form.speakerNames.length >= MAX_SPEAKERS) return;
    setForm({ ...form, speakerNames: [...form.speakerNames, name] });
    setNewSpeaker("");
  };

  const hoursInOrder = form.reminderSettings.activeTo > form.reminderSettings.activeFrom;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setErrors({});
    if (!hoursInOrder) return;
    setBusy(true);
    try {
      session.setUser(await patchMe(form));
      setStatus({ tone: "success", text: t.saved });
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation_failed")
        setErrors(fieldErrors(error.issues));
      setStatus({ tone: "error", text: t.saveFailed(errorCode(error)) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    navigate("/");
    await session.signOut();
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.profile} />
      <form className="profile-form" onSubmit={save} noValidate>
        <section className="stack">
          <h2 className="label label-section">{t.details}</h2>
          <TextField
            label={copy.auth.displayName}
            required
            maxLength={80}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            error={fieldText(errors.displayName)}
          />
          <Select
            label={copy.auth.nativeLanguage}
            hint={copy.auth.nativeLanguageHint}
            options={languageOptions(form.nativeLanguage)}
            value={form.nativeLanguage}
            onChange={(e) => setForm({ ...form, nativeLanguage: e.target.value })}
            error={fieldText(errors.nativeLanguage)}
          />
        </section>

        <section className="stack section">
          <h2 className="label label-section">{t.speakerNames}</h2>
          <p className="field-hint">{t.speakerNamesHint}</p>
          {form.speakerNames.length === 0 ? (
            <p className="secondary-text">{t.noSpeakers}</p>
          ) : (
            <ul className="speaker-list">
              {form.speakerNames.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <Button
                    variant="link"
                    aria-label={t.removeSpeaker(name)}
                    onClick={() =>
                      setForm({ ...form, speakerNames: form.speakerNames.filter((n) => n !== name) })
                    }
                  >
                    {copy.common.delete}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {form.speakerNames.length < MAX_SPEAKERS ? (
            <div className="speaker-add">
              <TextField
                label={t.speakerName}
                maxLength={80}
                value={newSpeaker}
                onChange={(e) => setNewSpeaker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSpeaker();
                  }
                }}
                error={fieldText(errors.speakerNames)}
              />
              <Button onClick={addSpeaker} disabled={!newSpeaker.trim()}>
                {t.addSpeaker}
              </Button>
            </div>
          ) : (
            <p className="secondary-text">{t.speakerLimit}</p>
          )}
        </section>

        <section className="stack section">
          <h2 className="label label-section">{t.reminders}</h2>
          <Checkbox
            label={t.embed}
            checked={form.reminderSettings.embedInMyReminders}
            onChange={(e) => setReminders({ embedInMyReminders: e.target.checked })}
          />
          <Select
            label={t.intensity}
            options={(["light", "normal", "intense"] as const).map((v) => ({
              value: v,
              label: t.intensities[v],
            }))}
            value={form.reminderSettings.intensity}
            onChange={(e) => setReminders({ intensity: e.target.value as ReminderSettings["intensity"] })}
          />
          <div className="hours">
            <TextField
              label={t.activeFrom}
              type="time"
              required
              value={form.reminderSettings.activeFrom}
              onChange={(e) => setReminders({ activeFrom: e.target.value })}
            />
            <TextField
              label={t.activeTo}
              type="time"
              required
              value={form.reminderSettings.activeTo}
              onChange={(e) => setReminders({ activeTo: e.target.value })}
              error={!hoursInOrder ? t.activeOrder : fieldText(errors.reminderSettings)}
            />
          </div>
          <p className="field-hint">{t.activeHint}</p>
        </section>

        <div className="profile-save">
          {status && <Notice tone={status.tone}>{status.text}</Notice>}
          <div className="actions">
            <Button variant="primary" type="submit" busy={busy}>
              {copy.common.save}
            </Button>
          </div>
        </div>
      </form>

      <section className="stack section">
        <h2 className="label label-section">{t.account}</h2>
        <p>{t.signedInAs(user.email)}</p>
        <div className="actions">
          <Button onClick={signOut}>{t.signOut}</Button>
          <DeleteAccount />
        </div>
      </section>
    </main>
  );
}

function DeleteAccount() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMe({ password });
      navigate("/");
      session.setUser(null);
    } catch (e) {
      const code = errorCode(e);
      setError(code === "invalid_credentials" ? t.deleteWrongPassword : t.deleteFailed(code));
      setBusy(false);
    }
  };

  const cancel = () => {
    setOpen(false);
    setPassword("");
    setError(null);
  };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t.deleteAccount}
      </Button>
      <ConfirmDialog
        open={open}
        title={t.deleteTitle}
        confirmLabel={t.deleteConfirm}
        busy={busy}
        onConfirm={confirm}
        onCancel={cancel}
      >
        <p>{t.deleteText}</p>
        <TextField
          label={copy.auth.password}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error}
        />
      </ConfirmDialog>
    </>
  );
}
