// Sources: the user's connections, one connection with its webhook URL and events, and the paste form.
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Connection, ConnectionSource, HookEvent, Source } from "shared";
import {
  ApiError,
  createConnection,
  deleteConnection,
  getConnectionEvents,
  getConnections,
  getSources,
  pasteTranscript,
  patchConnection,
  rotateConnection,
} from "../api";
import { copy } from "../copy/en";
import { formatDateTime } from "../lib/format";
import { formatSize, outcomeWithError, sampleCurl } from "../lib/sources";
import { usePolling } from "../lib/usePolling";
import { Link, navigate, useRoute } from "../router";
import { Button, ConfirmDialog, TextField } from "../ui/controls";
import { Empty, ErrorState, Loading, Notice, PageHeader } from "../ui/states";
import { NotFoundState } from "./NotFound";
import "./sources.css";

const t = copy.sources;
const c = copy.sources.connection;

// Loads a value once and again on reload(); keeps the last error.
function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await load(), loading: false });
    } catch (error) {
      setState({ error, loading: false });
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) };
}

function lastEventText(connection: Connection): string {
  if (!connection.lastEventAt || !connection.lastEventOutcome) return t.noEvents;
  const outcome = outcomeWithError(connection.lastEventOutcome, connection.lastEventError, t.outcomes);
  return `${formatDateTime(connection.lastEventAt)}, ${outcome}`;
}

export function SourcesPage() {
  const connections = useLoad(getConnections);
  const [connecting, setConnecting] = useState<ConnectionSource | null>(null);
  const [connectError, setConnectError] = useState<unknown>(null);

  const connect = async (source: ConnectionSource) => {
    setConnecting(source);
    setConnectError(null);
    try {
      const connection = await createConnection(source);
      navigate(`/sources/${connection.id}`);
    } catch (error) {
      setConnectError(error);
      setConnecting(null);
    }
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.sources}>
        <Button variant="primary" busy={connecting === "jamie"} onClick={() => connect("jamie")}>
          {t.connectJamie}
        </Button>
        <Button disabled>
          {t.connectAny} <span className="tag">{t.soon}</span>
        </Button>
        <Link className="button button-secondary" href="/sources/paste">
          {t.paste}
        </Link>
      </PageHeader>
      <p className="secondary-text">{t.intro}</p>
      {connectError !== null && <ErrorState what={t.connect} error={connectError} />}

      <section className="section" aria-labelledby="connections-label">
        <h2 id="connections-label" className="label label-section">
          {t.connectionsLabel}
        </h2>
        {connections.error !== undefined ? (
          <ErrorState what={t.loadConnections} error={connections.error} onRetry={connections.reload} />
        ) : !connections.data ? (
          <Loading />
        ) : connections.data.length === 0 ? (
          <Empty text={t.emptyConnections} />
        ) : (
          <ul className="list">
            {connections.data.map((connection) => (
              <li key={connection.id}>
                <Link className="card connection-card" href={`/sources/${connection.id}`}>
                  <span className="connection-card-title">{connection.label}</span>
                  <span className="connection-card-tags">
                    <span className="tag">{t.sourceNames[connection.source]}</span>
                    <span className={`tag${connection.status === "paused" ? " tag-strong" : ""}`}>
                      {t.status[connection.status]}
                    </span>
                  </span>
                  <span className="small secondary-text">
                    {t.lastEvent}: {lastEventText(connection)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export function ConnectionPage() {
  const { params } = useRoute();
  const id = params.id ?? "";
  const loadConnection = useCallback(async () => {
    const all = await getConnections();
    return all.find((x) => x.id === id) ?? null;
  }, [id]);
  const connection = useLoad(loadConnection);

  let body: React.ReactNode;
  if (connection.error !== undefined) {
    body = <ErrorState what={c.loadConnection} error={connection.error} onRetry={connection.reload} />;
  } else if (connection.data === undefined) {
    body = <Loading />;
  } else if (connection.data === null) {
    body = <NotFoundState />;
  } else {
    body = <ConnectionView connection={connection.data} onChange={connection.setData} />;
  }

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <p className="back-link">
        <Link href="/sources">{c.backToSources}</Link>
      </p>
      {body}
    </main>
  );
}

function ConnectionView({
  connection,
  onChange,
}: {
  connection: Connection;
  onChange: (connection: Connection) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"replace" | "delete" | null>(null);

  // Runs one change of the connection and shows its result.
  const run = async (key: string, action: () => Promise<Connection | null>, done: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const updated = await action();
      if (updated) onChange(updated);
      setNotice(done);
      setDialog(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteConnection(connection.id);
      navigate("/sources", { replace: true });
    } catch (e) {
      setError(e);
      setBusy(null);
      setDialog(null);
    }
  };

  return (
    <>
      <PageHeader title={connection.label} kicker={t.sourceNames[connection.source]}>
        <span className={`tag${connection.status === "paused" ? " tag-strong" : ""}`}>
          {t.status[connection.status]}
        </span>
      </PageHeader>

      <div aria-live="polite">
        {notice && <Notice tone="success">{notice}</Notice>}
        {error !== null && <ErrorState what={c.update} error={error} />}
      </div>

      <WebhookUrl url={connection.webhookUrl} />
      <SetupSteps source={connection.source} />
      {connection.source === "jamie" ? (
        <SigningSecret connection={connection} busy={busy} run={run} />
      ) : (
        <section className="section" aria-labelledby="sample-label">
          <h2 id="sample-label" className="label label-section">
            {c.sampleLabel}
          </h2>
          <p className="secondary-text">{c.sampleHint}</p>
          <pre className="code-block">
            <code>{sampleCurl(connection.webhookUrl)}</code>
          </pre>
        </section>
      )}
      <Events connectionId={connection.id} />

      <section className="section" aria-labelledby="manage-label">
        <h2 id="manage-label" className="label label-section">
          {c.manageLabel}
        </h2>
        <RenameForm connection={connection} busy={busy === "rename"} run={run} />
        <div className="actions manage-actions">
          {connection.status === "active" ? (
            <Button
              busy={busy === "status"}
              onClick={() =>
                run("status", () => patchConnection(connection.id, { status: "paused" }), c.paused)
              }
            >
              {c.pause}
            </Button>
          ) : (
            <Button
              busy={busy === "status"}
              onClick={() =>
                run("status", () => patchConnection(connection.id, { status: "active" }), c.resumed)
              }
            >
              {c.resume}
            </Button>
          )}
          <Button onClick={() => setDialog("replace")}>{c.replaceUrl}</Button>
          <Button variant="danger" onClick={() => setDialog("delete")}>
            {c.deleteConnection}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={dialog === "replace"}
        title={c.replaceTitle}
        confirmLabel={c.replaceUrl}
        busy={busy === "replace"}
        onConfirm={() => run("replace", () => rotateConnection(connection.id), c.replaced)}
        onCancel={() => setDialog(null)}
      >
        <p>{c.replaceText}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "delete"}
        title={c.deleteTitle}
        confirmLabel={copy.common.delete}
        busy={busy === "delete"}
        onConfirm={remove}
        onCancel={() => setDialog(null)}
      >
        <p>{c.deleteText}</p>
      </ConfirmDialog>
    </>
  );
}

function WebhookUrl({ url }: { url: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      const node = ref.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      setState("refused");
    }
  };

  return (
    <section className="section" aria-labelledby="url-label">
      <h2 id="url-label" className="label label-section">
        {c.urlLabel}
      </h2>
      <p className="secondary-text small">{c.urlHint}</p>
      <div className="webhook-url">
        <code ref={ref}>{url}</code>
        <Button variant="primary" onClick={copyUrl}>
          {state === "copied" ? c.copied : c.copy}
        </Button>
      </div>
      <div aria-live="polite">{state === "refused" && <Notice>{c.copyRefused}</Notice>}</div>
    </section>
  );
}

function SetupSteps({ source }: { source: ConnectionSource }) {
  const sources = useLoad(getSources);
  const found: Source | undefined = sources.data?.find((s) => s.id === source);

  return (
    <section className="section" aria-labelledby="setup-label">
      <h2 id="setup-label" className="label label-section">
        {c.setupLabel}
      </h2>
      {sources.error !== undefined ? (
        <ErrorState what={c.loadSetup} error={sources.error} onRetry={sources.reload} />
      ) : !sources.data ? (
        <Loading />
      ) : (
        <ol className="setup-steps">
          {(found?.setupSteps ?? []).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

type Run = (key: string, action: () => Promise<Connection | null>, done: string) => Promise<void>;

function SigningSecret({ connection, busy, run }: { connection: Connection; busy: string | null; run: Run }) {
  const [secret, setSecret] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!secret) return;
    await run("secret", () => patchConnection(connection.id, { signingSecret: secret }), c.secretSaved);
    setSecret("");
  };

  return (
    <section className="section" aria-labelledby="secret-label">
      <h2 id="secret-label" className="label label-section">
        {c.secretLabel}
      </h2>
      <p>{connection.hasSigningSecret ? c.secretSet : c.secretNotSet}</p>
      <form className="form" onSubmit={save}>
        <TextField
          label={c.secretField}
          type="password"
          autoComplete="off"
          maxLength={200}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <div className="actions">
          <Button variant="primary" type="submit" busy={busy === "secret"} disabled={!secret}>
            {c.secretSave}
          </Button>
          {connection.hasSigningSecret && (
            <Button
              variant="danger"
              busy={busy === "secret-remove"}
              onClick={() =>
                run(
                  "secret-remove",
                  () => patchConnection(connection.id, { signingSecret: null }),
                  c.secretRemoved,
                )
              }
            >
              {c.secretRemove}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function RenameForm({ connection, busy, run }: { connection: Connection; busy: boolean; run: Run }) {
  const [label, setLabel] = useState(connection.label);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || trimmed === connection.label) return;
    void run("rename", () => patchConnection(connection.id, { label: trimmed }), c.renamed);
  };

  return (
    <form className="form rename-form" onSubmit={save}>
      <TextField
        label={c.labelField}
        value={label}
        maxLength={80}
        required
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="actions">
        <Button type="submit" busy={busy}>
          {c.rename}
        </Button>
      </div>
    </form>
  );
}

function Events({ connectionId }: { connectionId: string }) {
  const load = useCallback(() => getConnectionEvents(connectionId), [connectionId]);
  const events = useLoad<HookEvent[]>(load);
  usePolling(() => void events.reload(), 10_000, events.error === undefined);

  return (
    <section className="section" aria-labelledby="events-label">
      <div className="section-head">
        <h2 id="events-label" className="label label-section">
          {c.eventsLabel}
        </h2>
        <Button busy={events.loading} onClick={() => void events.reload()}>
          {copy.common.refresh}
        </Button>
      </div>
      {events.error !== undefined ? (
        <ErrorState what={c.loadEvents} error={events.error} onRetry={events.reload} />
      ) : !events.data ? (
        <Loading />
      ) : events.data.length === 0 ? (
        <p className="secondary-text">{t.noEvents}</p>
      ) : (
        <div className="table-wrap">
          <table className="events">
            <thead>
              <tr>
                <th scope="col">{c.eventTime}</th>
                <th scope="col">{c.eventOutcome}</th>
                <th scope="col">{c.eventSize}</th>
                <th scope="col">{c.eventTranscript}</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((event) => (
                <tr key={event.id}>
                  <td className="mono">{formatDateTime(event.receivedAt)}</td>
                  <td>{outcomeWithError(event.outcome, event.errorCode, t.outcomes)}</td>
                  <td className="mono">{formatSize(event.sizeBytes)}</td>
                  <td>
                    {event.transcriptId && (
                      <Link href={`/activity/${event.transcriptId}`}>{c.openTranscript}</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PastePage() {
  const p = t.pastePage;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [textError, setTextError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!text.trim()) {
      setTextError(p.textRequired);
      return;
    }
    setTextError(null);
    setBusy(true);
    try {
      const transcript = await pasteTranscript({
        title: title.trim() || undefined,
        occurredAt: date ? new Date(date).toISOString() : undefined,
        text,
      });
      navigate(`/activity/${transcript.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const issueText =
    error instanceof ApiError && error.issues.length > 0
      ? error.issues.map((i) => `${i.path}: ${i.code}`).join(", ")
      : null;

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <p className="back-link">
        <Link href="/sources">{c.backToSources}</Link>
      </p>
      <PageHeader title={copy.pages.paste} />
      <p className="secondary-text">{p.intro}</p>
      <form className="form paste-form" onSubmit={submit} noValidate>
        <TextField
          label={p.titleField}
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label={p.dateField}
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextField
          label={p.textField}
          multiline
          rows={14}
          hint={p.formatHint}
          error={textError}
          value={text}
          maxLength={400_000}
          onChange={(e) => setText(e.target.value)}
        />
        {error !== null && (
          <div>
            <ErrorState what={p.send} error={error} />
            {issueText && <p className="mono small">{issueText}</p>}
          </div>
        )}
        <div className="actions">
          <Button variant="primary" type="submit" busy={busy}>
            {p.submit}
            <span aria-hidden="true"> -&gt;</span>
          </Button>
        </div>
      </form>
    </main>
  );
}
