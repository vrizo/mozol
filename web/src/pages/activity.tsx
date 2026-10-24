// Activity (recommendations MOZOL put into the user's Reminders) and Transcript (one analysis) pages.

import { useCallback, useEffect, useState } from "react";
import type { Recommendation, Transcript, TranscriptDetail } from "shared";
import {
  ApiError,
  analyzeAgain,
  deleteTranscript,
  deliverRecommendation,
  getRecommendations,
  getTranscript,
} from "../api";
import { copy } from "../copy/en";
import { canSend, deliveryText } from "../lib/deliveries";
import { formatDateTime } from "../lib/format";
import { languageName } from "../lib/languageName";
import { formatDuration, groupFindings, isBusy } from "../lib/transcripts";
import { usePolling } from "../lib/usePolling";
import { Link, navigate, useRoute } from "../router";
import { useUser } from "../session";
import { Button, ConfirmDialog } from "../ui/controls";
import { Empty, ErrorState, Loading, Notice, PageHeader } from "../ui/states";
import { NotFoundState } from "./NotFound";
import { DeliveryLine } from "./recommendations";
import "./activity.css";
import "./knowledge.css";

const t = copy.transcript;
const labels = copy.labels;

export function ActivityPage() {
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });

  const loadFirst = useCallback(async () => {
    setError(null);
    try {
      const page = await getRecommendations(true);
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  // Polling refreshes the first page and keeps any older pages already loaded.
  const refresh = async () => {
    try {
      const page = await getRecommendations(true);
      setItems((current) => {
        const fresh = new Set(page.items.map((item) => item.id));
        const older = (current ?? []).filter((item) => !fresh.has(item.id));
        return [...page.items, ...older];
      });
    } catch (e) {
      setError(e);
    }
  };
  usePolling(refresh, 5000, items !== null && error === null);

  const loadMore = async () => {
    if (!nextCursor) return;
    setMore({ busy: true, error: null });
    try {
      const page = await getRecommendations(true, nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
      setMore({ busy: false, error: null });
    } catch (e) {
      setMore({ busy: false, error: e });
    }
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.activity}>
        <p className="secondary-text">{copy.activity.intro}</p>
      </PageHeader>
      {error !== null && <ErrorState what={copy.activity.load} error={error} onRetry={loadFirst} />}
      {items === null && error === null && <Loading />}
      {items?.length === 0 && (
        <Empty text={copy.activity.empty} action={{ href: "/sources", label: copy.activity.connectSource }} />
      )}
      {items && items.length > 0 && (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id}>
              <ActivityRow recommendation={item} />
            </li>
          ))}
        </ul>
      )}
      {more.error !== null && <ErrorState what={copy.activity.load} error={more.error} />}
      {nextCursor && (
        <div className="actions activity-more">
          <Button onClick={loadMore} busy={more.busy}>
            {copy.common.loadMore}
          </Button>
        </div>
      )}
    </main>
  );
}

function ActivityRow({ recommendation: r }: { recommendation: Recommendation }) {
  return (
    <article className="card knowledge-card">
      <div className="knowledge-tags">
        <span className="tag">{labels.recommendationKind[r.kind]}</span>
        <span className="tag">{languageName(r.language)}</span>
      </div>
      <h2>
        <Link href={`/r/${r.id}`}>{r.title}</Link>
      </h2>
      <DeliveryLine recommendation={r} />
    </article>
  );
}

function TranscriptMeta({ transcript }: { transcript: Transcript }) {
  return (
    <dl className="meta">
      <div>
        <dt>{t.source}</dt>
        <dd>{labels.sources[transcript.source]}</dd>
      </div>
      <div>
        <dt>{t.date}</dt>
        <dd>{formatDateTime(transcript.occurredAt)}</dd>
      </div>
      {transcript.durationSec !== null && (
        <div>
          <dt>{t.duration}</dt>
          <dd>{formatDuration(transcript.durationSec)}</dd>
        </div>
      )}
      {transcript.language && (
        <div>
          <dt>{t.language}</dt>
          <dd>{languageName(transcript.language)}</dd>
        </div>
      )}
      <div>
        <dt>{t.status}</dt>
        <dd>
          <span className="tag">{labels.transcriptStatus[transcript.status]}</span>
        </dd>
      </div>
      {transcript.learnerSpeakerName && (
        <div>
          <dt>{t.learner}</dt>
          <dd>{transcript.learnerSpeakerName}</dd>
        </div>
      )}
    </dl>
  );
}

function StatusNote({ transcript }: { transcript: Transcript }) {
  if (transcript.status === "skipped" && transcript.skipReason) {
    return <p className="secondary-text">{labels.skipReason[transcript.skipReason]}</p>;
  }
  if (transcript.status === "failed") {
    return <p className="danger-text">{labels.transcriptError(transcript.errorCode ?? "internal")}</p>;
  }
  return null;
}

export function TranscriptPage() {
  const { params } = useRoute();
  const id = params.id ?? "";
  const [transcript, setTranscript] = useState<TranscriptDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTranscript(await getTranscript(id));
    } catch (e) {
      setError(e);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(load, 5000, transcript !== null && isBusy(transcript.status));

  if (error instanceof ApiError && error.status === 404) {
    return (
      <main id="main-content" className="page" tabIndex={-1}>
        <NotFoundState />
      </main>
    );
  }

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <p className="back-link">
        <Link href="/activity">{t.backToActivity}</Link>
      </p>
      {error !== null && <ErrorState what={t.load} error={error} onRetry={load} />}
      {transcript === null && error === null && <Loading />}
      {transcript && <TranscriptView transcript={transcript} reload={load} />}
    </main>
  );
}

function TranscriptView({
  transcript,
  reload,
}: {
  transcript: TranscriptDetail;
  reload: () => Promise<void>;
}) {
  const user = useUser();
  const native = user.nativeLanguage;
  const spoken = transcript.language ?? undefined;
  const result = transcript.analysis?.result ?? null;

  return (
    <>
      <PageHeader title={transcript.title ?? copy.activity.untitled} />
      <TranscriptMeta transcript={transcript} />

      <div className="transcript-status">
        {isBusy(transcript.status) && <Notice>{t.working}</Notice>}
        <StatusNote transcript={transcript} />
      </div>

      {result?.status === "ok" && (
        <>
          <section className="section" aria-labelledby="summary-heading" lang={native}>
            <h2 id="summary-heading">{t.summaryLabel}</h2>
            <p className="reading">{result.summary.overview}</p>
            <dl className="meta">
              {result.summary.estimatedLevel && (
                <div>
                  <dt>{t.level}</dt>
                  <dd>
                    <span className="tag">{result.summary.estimatedLevel}</span>
                  </dd>
                </div>
              )}
            </dl>
            {result.summary.strengths.length > 0 && (
              <>
                <h3 className="label label-section summary-sub">{t.strengths}</h3>
                <ul>
                  {result.summary.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {result.summary.focus && (
              <>
                <h3 className="label label-section summary-sub">{t.focus}</h3>
                <p>{result.summary.focus}</p>
              </>
            )}
          </section>

          <section className="section" aria-labelledby="findings-heading">
            <h2 id="findings-heading">{t.findingsLabel}</h2>
            {result.findings.length === 0 && <p>{t.noFindings}</p>}
            {groupFindings(result.findings).map((group) => (
              <div key={group.category} className="finding-group">
                <h3 className="label label-section">{labels.categories[group.category]}</h3>
                <ul className="list">
                  {group.findings.map((finding) => (
                    <li key={finding.patternKey} className="card">
                      <h4 lang={native}>{finding.title}</h4>
                      <p className="finding-tags">
                        <span className={`tag${finding.severity === "high" ? " tag-strong" : ""}`}>
                          {labels.severity[finding.severity]}
                        </span>{" "}
                        <span className="tag">{t.occurrences(finding.occurrences)}</span>
                      </p>
                      <ul className="examples">
                        {finding.examples.map((example) => (
                          <li key={example.quote}>
                            <Pair said={example.quote} better={example.correction} lang={spoken} />
                          </li>
                        ))}
                      </ul>
                      <p lang={native}>{finding.explanation}</p>
                      {finding.tip && (
                        <p lang={native}>
                          <strong>{t.tip}: </strong>
                          {finding.tip}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="section" aria-labelledby="words-heading">
            <h2 id="words-heading">{t.wordsLabel}</h2>
            {result.words.length === 0 && <p>{t.noWords}</p>}
            <ul className="list">
              {result.words.map((word) => (
                <li key={word.term} className="card">
                  <h3>
                    <span lang={spoken}>{word.term}</span>{" "}
                    <span className="tag">{copy.words.types[word.type]}</span>
                  </h3>
                  <p lang={native}>
                    <strong>{word.translation}</strong>. {word.meaning}
                  </p>
                  <p>
                    <span className="label">{t.example}</span> <span lang={spoken}>{word.example}</span>
                    <br />
                    <span lang={native} className="secondary-text">
                      {word.exampleTranslation}
                    </span>
                  </p>
                  {word.learnerSaid && (
                    <p>
                      <span className="label">{t.instead}</span> <span lang={spoken}>{word.learnerSaid}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="section" aria-labelledby="phrases-heading">
            <h2 id="phrases-heading">{t.phrasesLabel}</h2>
            {result.phrases.length === 0 && <p>{t.noPhrases}</p>}
            <ul className="list">
              {result.phrases.map((phrase) => (
                <li key={phrase.phrase} className="card">
                  <h3 lang={spoken}>{phrase.phrase}</h3>
                  <p lang={native}>
                    <strong>{phrase.translation}</strong>
                  </p>
                  <p>
                    <span className="label">{t.useWhen}</span> <span lang={native}>{phrase.useWhen}</span>
                  </p>
                  {phrase.insteadOf && (
                    <p>
                      <span className="label">{t.yourVersion}</span>{" "}
                      <span lang={spoken}>{phrase.insteadOf}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="section" aria-labelledby="rewrites-heading">
            <h2 id="rewrites-heading">{t.rewritesLabel}</h2>
            {result.rewrites.length === 0 && <p>{t.noRewrites}</p>}
            <ul className="list">
              {result.rewrites.map((rewrite) => (
                <li key={rewrite.original} className="card">
                  <Pair said={rewrite.original} better={rewrite.rewrite} lang={spoken} wide />
                  <p lang={native} className="secondary-text">
                    {rewrite.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {transcript.status === "analyzed" && result === null && <Notice>{t.noAnalysis}</Notice>}

      <RecommendationsBlock recommendations={transcript.recommendations} />

      <section className="section" aria-labelledby="text-heading">
        <h2 id="text-heading">{t.transcriptLabel}</h2>
        <details className="segments">
          <summary>{t.showTranscript}</summary>
          <ol className="segment-list">
            {transcript.segments.map((segment, i) => {
              const mine = segment.speakerName === transcript.learnerSpeakerName;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments have no id and never reorder
                <li key={i} className={mine ? "segment segment-mine" : "segment"}>
                  <span className="segment-speaker">
                    {segment.speakerName}
                    {mine && ` ${t.you}`}
                  </span>{" "}
                  <span lang={spoken}>{segment.text}</span>
                </li>
              );
            })}
          </ol>
        </details>
      </section>

      <TranscriptActions transcript={transcript} reload={reload} />
    </>
  );
}

// The learner's words and the better version, labeled so screen readers say which is which.
function Pair({ said, better, lang, wide }: { said: string; better: string; lang?: string; wide?: boolean }) {
  return (
    <div className={wide ? "pair pair-wide" : "pair"}>
      <p className="pair-said">
        <span className="label">{t.youSaid}</span>
        <span lang={lang}>{said}</span>
      </p>
      <p className="pair-better">
        <span className="label">{t.better}</span>
        <span lang={lang}>{better}</span>
      </p>
    </div>
  );
}

function RecommendationsBlock({ recommendations }: { recommendations: Recommendation[] }) {
  const [items, setItems] = useState(recommendations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  useEffect(() => setItems(recommendations), [recommendations]);

  const send = async (id: string) => {
    setBusyId(id);
    setError(null);
    setSentId(null);
    try {
      const updated = await deliverRecommendation(id);
      setItems((current) => current.map((r) => (r.id === id ? updated : r)));
      setSentId(id);
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="section" aria-labelledby="recommendations-heading">
      <h2 id="recommendations-heading">{t.recommendationsLabel}</h2>
      {error !== null && <ErrorState what={t.send} error={error} />}
      {items.length === 0 && <p>{t.noRecommendations}</p>}
      <ol className="list">
        {items.map((rec) => (
          <li key={rec.id} className="card recommendation">
            <p className="recommendation-title">
              <span className="tag">{labels.recommendationKind[rec.kind]}</span>{" "}
              <Link href={`/r/${rec.id}`}>{rec.title}</Link>
            </p>
            <p className="small">{deliveryText(rec.delivery)}</p>
            {sentId === rec.id && <Notice tone="success">{t.sent}</Notice>}
            {canSend(rec.delivery) && (
              <Button onClick={() => send(rec.id)} busy={busyId === rec.id} disabled={busyId !== null}>
                {t.sendToPhone}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TranscriptActions({
  transcript,
  reload,
}: {
  transcript: TranscriptDetail;
  reload: () => Promise<void>;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<{ what: string; error: unknown } | null>(null);
  const [busyNotice, setBusyNotice] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = isBusy(transcript.status);

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    setBusyNotice(false);
    try {
      await analyzeAgain(transcript.id);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "transcript_busy") setBusyNotice(true);
      else setError({ what: t.analyze, error: e });
    } finally {
      setAnalyzing(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteTranscript(transcript.id);
      navigate("/activity");
    } catch (e) {
      setConfirm(false);
      setError({ what: t.delete, error: e });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="section" aria-labelledby="actions-heading">
      <h2 id="actions-heading">{t.actionsLabel}</h2>
      {busyNotice && <Notice>{t.busy}</Notice>}
      {error && <ErrorState what={error.what} error={error.error} />}
      <div className="actions">
        <Button variant="primary" onClick={analyze} busy={analyzing} disabled={busy}>
          {t.analyzeAgain}
        </Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          {t.deleteTranscript}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t.deleteTitle}
        confirmLabel={copy.common.delete}
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      >
        <p>{t.deleteText}</p>
      </ConfirmDialog>
    </section>
  );
}
