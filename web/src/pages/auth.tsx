// Sign up, sign in, and the app sign-in that hands the session to the iOS app.

import { type FormEvent, useState } from "react";
import type { User } from "shared";
import { ApiError, createAppCode, signIn, signUp } from "../api";
import { copy } from "../copy/en";
import { browserLanguage, languageOptions } from "../languages";
import { fieldErrors, isAppReturn, withCode } from "../lib/auth";
import { Link, navigate, safeNext, useRoute } from "../router";
import { useSession } from "../session";
import { Button, Select, TextField } from "../ui/controls";
import { errorCode, Loading, Notice, PageHeader } from "../ui/states";
import "./auth.css";

const t = copy.auth;

function fieldText(code: string | undefined): string | null {
  if (!code) return null;
  return t.fieldErrors[code] ?? t.fieldError(code);
}

// The form-level message for a failed sign-up or sign-in; field errors are shown next to their fields.
function formError(error: unknown): string {
  const code = errorCode(error);
  if (code === "invalid_credentials") return t.invalidCredentials;
  if (code === "rate_limited") return t.rateLimited;
  return t.failed(code);
}

type FormProps = { onDone: (user: User) => void | Promise<void>; switchLink: React.ReactNode };

function SignUpForm({ onDone, switchLink }: FormProps) {
  const [form, setForm] = useState({
    email: "",
    password: "",
    displayName: "",
    nativeLanguage: browserLanguage(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setNotice(null);
    try {
      await onDone(await signUp(form));
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation_failed")
        setErrors(fieldErrors(error.issues));
      else if (error instanceof ApiError && error.code === "email_taken") setErrors({ email: "email_taken" });
      else setNotice(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {notice && <Notice tone="error">{notice}</Notice>}
      <TextField
        label={t.email}
        type="email"
        autoComplete="email"
        required
        value={form.email}
        onChange={set("email")}
        error={errors.email === "email_taken" ? t.emailTaken : fieldText(errors.email)}
      />
      <TextField
        label={t.password}
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint={t.passwordHint}
        value={form.password}
        onChange={set("password")}
        error={fieldText(errors.password)}
      />
      <TextField
        label={t.displayName}
        autoComplete="name"
        required
        maxLength={80}
        value={form.displayName}
        onChange={set("displayName")}
        error={fieldText(errors.displayName)}
      />
      <Select
        label={t.nativeLanguage}
        hint={t.nativeLanguageHint}
        options={languageOptions(form.nativeLanguage)}
        value={form.nativeLanguage}
        onChange={set("nativeLanguage")}
        error={fieldText(errors.nativeLanguage)}
      />
      <div className="actions">
        <Button variant="primary" type="submit" busy={busy}>
          {t.signUpSubmit}
          <span aria-hidden="true"> -&gt;</span>
        </Button>
      </div>
      <p className="auth-switch">{switchLink}</p>
    </form>
  );
}

function SignInForm({ onDone, switchLink }: FormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await onDone(await signIn({ email, password }));
    } catch (error) {
      setNotice(formError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {notice && <Notice tone="error">{notice}</Notice>}
      <TextField
        label={t.email}
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label={t.password}
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="actions">
        <Button variant="primary" type="submit" busy={busy}>
          {t.signInSubmit}
          <span aria-hidden="true"> -&gt;</span>
        </Button>
      </div>
      <p className="auth-switch">{switchLink}</p>
    </form>
  );
}

function nextQuery(next: string | null): string {
  return next ? `?next=${encodeURIComponent(next)}` : "";
}

export function SignUpPage() {
  const { query } = useRoute();
  const { setUser } = useSession();
  const next = query.get("next");
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.signup} />
      <SignUpForm
        onDone={(user) => {
          setUser(user);
          navigate(safeNext(next), { replace: true });
        }}
        switchLink={
          <>
            {t.haveAccount} <Link href={`/signin${nextQuery(next)}`}>{t.signInLink}</Link>
          </>
        }
      />
    </main>
  );
}

export function SignInPage() {
  const { query } = useRoute();
  const { setUser } = useSession();
  const next = query.get("next");
  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.signin} />
      <SignInForm
        onDone={(user) => {
          setUser(user);
          navigate(safeNext(next), { replace: true });
        }}
        switchLink={
          <>
            {t.noAccount} <Link href={`/signup${nextQuery(next)}`}>{t.signUpLink}</Link>
          </>
        }
      />
    </main>
  );
}

// Steps: check the return address, get the user signed in, then mint a code and open the app with it.
export function AppSignInPage() {
  const { query } = useRoute();
  const session = useSession();
  const returnTo = query.get("return");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [address, setAddress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAppReturn(returnTo)) {
    return (
      <main id="main-content" className="page" tabIndex={-1}>
        <PageHeader title={copy.pages.appSignin} />
        <Notice tone="error">{t.app.badReturn}</Notice>
      </main>
    );
  }

  const handOff = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { code } = await createAppCode();
      const target = withCode(returnTo, code);
      setAddress(target);
      window.location.href = target;
    } catch (error) {
      setNotice(t.app.codeFailed(errorCode(error)));
    } finally {
      setBusy(false);
    }
  };

  const onDone = async (user: User) => {
    session.setUser(user);
    await handOff();
  };

  const body = () => {
    if (address) {
      return (
        <div className="stack">
          <Notice tone="success">{t.app.opening}</Notice>
          <p className="secondary-text">{t.app.openHint}</p>
          <p>
            <a className="button button-primary" href={address}>
              {t.app.openLink}
            </a>
          </p>
        </div>
      );
    }
    if (session.status === "loading") return <Loading />;
    if (session.user) {
      return (
        <div className="stack">
          <div className="actions">
            <Button variant="primary" busy={busy} onClick={handOff}>
              {t.app.continueAs(session.user.displayName)}
              <span aria-hidden="true"> -&gt;</span>
            </Button>
            <Button onClick={() => session.signOut()} disabled={busy}>
              {t.app.otherAccount}
            </Button>
          </div>
        </div>
      );
    }
    if (mode === "signup") {
      return (
        <SignUpForm
          onDone={onDone}
          switchLink={
            <>
              {t.haveAccount}{" "}
              <Button variant="link" onClick={() => setMode("signin")}>
                {t.signInLink}
              </Button>
            </>
          }
        />
      );
    }
    return (
      <SignInForm
        onDone={onDone}
        switchLink={
          <>
            {t.noAccount}{" "}
            <Button variant="link" onClick={() => setMode("signup")}>
              {t.signUpLink}
            </Button>
          </>
        }
      />
    );
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.appSignin} />
      <p className="secondary-text">{t.app.intro}</p>
      {notice && <Notice tone="error">{notice}</Notice>}
      {body()}
    </main>
  );
}
