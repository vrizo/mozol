// Recommendations sent to the phone and not sent, the user's devices, and one recommendation (/r/:id).

import { useState } from "react";
import type { Device, Recommendation } from "shared";
import { ApiError, getDevices, getRecommendation, getRecommendations, testPush } from "../api";
import { copy } from "../copy/en";
import { deliveryText } from "../lib/deliveries";
import { formatDate, formatDateTime } from "../lib/format";
import { matchModeLabel } from "../lib/knowledge";
import { languageName } from "../lib/languageName";
import { useLoad } from "../lib/useLoad";
import { Link, useRoute } from "../router";
import { Button } from "../ui/controls";
import { Empty, ErrorState, Loading, Notice, PageHeader } from "../ui/states";
import { NotFoundState } from "./NotFound";
import "./knowledge.css";

const t = copy.recommendations;

export function DeliveryLine({ recommendation }: { recommendation: Recommendation }) {
  const { delivery } = recommendation;
  return (
    <p className="delivery-line">
      <span className="tag">{deliveryText(delivery)}</span>
      {delivery && (
        <span className="secondary-text small">{t.state.updated(formatDateTime(delivery.updatedAt))}</span>
      )}
    </p>
  );
}

export function RecommendationsPage() {
  const [more, setMore] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const { state, retry, set } = useLoad(() => getRecommendations(undefined), "all");

  const loadMore = async (cursor: string) => {
    setMore({ busy: true, error: null });
    try {
      const page = await getRecommendations(undefined, cursor);
      set((data) => ({ items: [...data.items, ...page.items], nextCursor: page.nextCursor }));
      setMore({ busy: false, error: null });
    } catch (error) {
      setMore({ busy: false, error });
    }
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.activity} />
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState what={t.load} error={state.error} onRetry={retry} />}
      {state.status === "ready" &&
        (state.data.items.length === 0 ? (
          <Empty
            text={t.empty.delivered}
            action={{ href: "/sources", label: t.connectSource }}
          />
        ) : (
          <>
            <ul className="list">
              {state.data.items.map((r) => (
                <li key={r.id}>
                  <RecommendationCard recommendation={r} />
                </li>
              ))}
            </ul>
            {more.error !== null && <ErrorState what={t.load} error={more.error} />}
            {state.data.nextCursor && (
              <div className="actions load-more">
                <Button
                  busy={more.busy}
                  onClick={() => state.data.nextCursor && loadMore(state.data.nextCursor)}
                >
                  {copy.common.loadMore}
                </Button>
              </div>
            )}
          </>
        ))}
      <Devices />
    </main>
  );
}

function RecommendationCard({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <article className="card knowledge-card">
      <div className="knowledge-tags">
        <span className="tag">{copy.labels.recommendationKind[r.kind]}</span>
        <span className="tag">{languageName(r.language)}</span>
      </div>
      <h2>
        <Link href={`/r/${r.id}`}>{r.title}</Link>
      </h2>
      <p className="embed-line">{r.embedLine}</p>
      <DeliveryLine recommendation={r} />
      <p className="secondary-text small">
        {t.created(formatDate(r.createdAt))}
        {r.transcriptId ? (
          <>
            {" "}
            <Link href={`/activity/${r.transcriptId}`}>{t.openTranscript}</Link>
          </>
        ) : null}
      </p>
    </article>
  );
}

function Devices() {
  const d = t.devices;
  const { state, retry } = useLoad(getDevices, "devices");
  return (
    <section className="section" aria-labelledby="devices-title">
      <h2 id="devices-title">{d.title}</h2>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState what={d.load} error={state.error} onRetry={retry} />}
      {state.status === "ready" &&
        (state.data.length === 0 ? (
          <Empty text={d.empty} icon={false} />
        ) : (
          <ul className="list">
            {state.data.map((device) => (
              <li key={device.id}>
                <DeviceCard device={device} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function DeviceCard({ device }: { device: Device }) {
  const d = t.devices;
  const [push, setPush] = useState<{ busy: boolean; error: unknown; sent: boolean }>({
    busy: false,
    error: null,
    sent: false,
  });

  const send = async () => {
    setPush({ busy: true, error: null, sent: false });
    try {
      await testPush(device.installationId);
      setPush({ busy: false, error: null, sent: true });
    } catch (error) {
      setPush({ busy: false, error, sent: false });
    }
  };

  const notConfigured = push.error instanceof ApiError && push.error.code === "push_not_configured";
  return (
    <article className="card knowledge-card">
      <h3>{d.device(device.osVersion)}</h3>
      <dl className="meta">
        <div>
          <dt>{d.appVersion}</dt>
          <dd>{device.appVersion ?? d.unknown}</dd>
        </div>
        <div>
          <dt>{d.push}</dt>
          <dd>{device.pushEnabled ? d.pushOn : d.pushOff}</dd>
        </div>
        <div>
          <dt>{d.reminders}</dt>
          <dd>{d.remindersAccess[device.remindersAccess]}</dd>
        </div>
        <div>
          <dt>{d.lastContact}</dt>
          <dd>{formatDateTime(device.lastSeenAt)}</dd>
        </div>
      </dl>
      <div className="actions">
        <Button busy={push.busy} onClick={send}>
          {d.testPush}
        </Button>
      </div>
      {push.sent && <Notice tone="success">{d.testPushSent}</Notice>}
      {notConfigured && <Notice>{d.pushNotConfigured}</Notice>}
      {push.error !== null && !notConfigured && <ErrorState what={d.testPushFailed} error={push.error} />}
    </article>
  );
}

export function RecommendationPage() {
  const route = useRoute();
  const id = route.params.id ?? "";
  const { state, retry } = useLoad(() => getRecommendation(id), id);

  if (state.status === "error" && state.error instanceof ApiError && state.error.status === 404) {
    return (
      <main id="main-content" className="page" tabIndex={-1}>
        <NotFoundState />
      </main>
    );
  }

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState what={t.loadOne} error={state.error} onRetry={retry} />}
      {state.status === "ready" && <RecommendationDetail recommendation={state.data} />}
    </main>
  );
}

function RecommendationDetail({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <>
      <PageHeader
        title={r.title}
        kicker={`${copy.labels.recommendationKind[r.kind]}, ${languageName(r.language)}`}
      />
      <div className="stack">
        <DeliveryLine recommendation={r} />
      </div>

      <section className="section">
        <h2>{t.notes}</h2>
        <pre className="reminder-notes">{r.notes}</pre>
      </section>

      <section className="section">
        <h2>{t.embedLine}</h2>
        <p className="embed-line">{r.embedLine}</p>
      </section>

      <section className="section">
        <h2>{t.matchTerms}</h2>
        <p className="secondary-text">{t.matchTermsHint}</p>
        {r.matchTerms.length === 0 ? (
          <p>{t.noMatchTerms}</p>
        ) : (
          <ul className="match-terms">
            {r.matchTerms.map((term) => (
              <li key={`${term.lang}:${term.mode}:${term.text}`}>
                <span className="mono" lang={term.lang}>
                  {term.text}
                </span>{" "}
                <span className="secondary-text small">
                  {languageName(term.lang)}, {matchModeLabel(term.mode)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <dl className="meta">
          <div>
            <dt>{t.delivery}</dt>
            <dd>{deliveryText(r.delivery)}</dd>
          </div>
        </dl>
        <p>
          {r.transcriptId ? (
            <Link href={`/activity/${r.transcriptId}`}>{t.openTranscript}</Link>
          ) : (
            <span className="secondary-text">{t.transcriptDeleted}</span>
          )}
        </p>
      </section>
    </>
  );
}
