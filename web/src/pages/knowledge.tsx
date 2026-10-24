// Patterns and Words: the user's recurring mistakes and suggested words across all transcripts.

import { useState } from "react";
import type { Pattern, PatternStatus, Word, WordStatus } from "shared";
import { getPatterns, getWords, patchPattern, patchWord } from "../api";
import { copy } from "../copy/en";
import { formatDate } from "../lib/format";
import { filterByLanguage, languagesOf, pickStatus } from "../lib/knowledge";
import { languageName } from "../lib/languageName";
import { useLoad } from "../lib/useLoad";
import { setQuery, useRoute } from "../router";
import { Button, Select } from "../ui/controls";
import { Empty, ErrorState, Loading, PageHeader } from "../ui/states";
import { Tabs } from "../ui/Tabs";
import "./knowledge.css";

function LanguageFilter({
  languages,
  current,
  label,
  all,
}: {
  languages: string[];
  current: string | null;
  label: string;
  all: string;
}) {
  if (languages.length < 2 && !current) return null;
  const options = [
    { value: "", label: all },
    ...languages.map((code) => ({ value: code, label: languageName(code) })),
  ];
  if (current && !languages.includes(current)) options.push({ value: current, label: languageName(current) });
  return (
    <div className="language-filter">
      <Select
        label={label}
        value={current ?? ""}
        options={options}
        onChange={(e) => setQuery({ language: e.target.value || undefined })}
      />
    </div>
  );
}

const patternStatuses = ["active", "learned", "dismissed"] as const;

export function PatternsPage() {
  const t = copy.patterns;
  const route = useRoute();
  const status = pickStatus(route.query.get("status"), patternStatuses);
  const language = route.query.get("language");
  const { state, retry, set } = useLoad(() => getPatterns(status), status);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const move = async (pattern: Pattern, next: PatternStatus) => {
    setBusy(pattern.id);
    setActionError(null);
    try {
      await patchPattern(pattern.id, next);
      set((list) => list.filter((p) => p.id !== pattern.id));
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.patterns} />
      <Tabs label={t.tabsLabel} param="status" values={patternStatuses} current={status} names={t.tabs} />
      {state.status === "ready" && (
        <LanguageFilter
          languages={languagesOf(state.data)}
          current={language}
          label={t.languageFilter}
          all={t.allLanguages}
        />
      )}
      {actionError !== null && <ErrorState what={t.update} error={actionError} />}
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState what={t.load} error={state.error} onRetry={retry} />}
      {state.status === "ready" &&
        (state.data.length === 0 ? (
          <Empty
            text={t.empty[status]}
            action={status === "active" ? { href: "/sources", label: t.connectSource } : undefined}
          />
        ) : (
          <ul className="list">
            {filterByLanguage(state.data, language).map((pattern) => (
              <li key={pattern.id}>
                <PatternCard
                  pattern={pattern}
                  busy={busy === pattern.id}
                  onMove={(next) => move(pattern, next)}
                />
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}

function PatternCard({
  pattern,
  busy,
  onMove,
}: {
  pattern: Pattern;
  busy: boolean;
  onMove: (status: PatternStatus) => void;
}) {
  const t = copy.patterns;
  const example = pattern.latest.examples[0];
  return (
    <article className="card knowledge-card">
      <div className="knowledge-tags">
        <span className="tag">{languageName(pattern.language)}</span>
        <span className="tag">{copy.labels.categories[pattern.category]}</span>
        {pattern.recurring && <span className="tag tag-strong">{t.recurring}</span>}
      </div>
      <h2>{pattern.title}</h2>
      <p className="secondary-text small">
        {t.counts(pattern.occurrencesTotal, pattern.transcriptsCount)},{" "}
        {pattern.sources.map((s) => copy.labels.sources[s]).join(", ")}.{" "}
        {t.lastSeen(formatDate(pattern.lastSeenAt))}
      </p>
      {example && (
        <dl className="example" lang={pattern.language}>
          <div className="example-quote">
            <dt>{t.youSaid}</dt>
            <dd>{example.quote}</dd>
          </div>
          <div className="example-correction">
            <dt>{t.better}</dt>
            <dd>{example.correction}</dd>
          </div>
        </dl>
      )}
      <p>{pattern.latest.explanation}</p>
      {pattern.latest.tip && (
        <p>
          <span className="label">{t.tip}</span> {pattern.latest.tip}
        </p>
      )}
      <div className="actions">
        {pattern.status === "active" ? (
          <>
            <Button variant="primary" busy={busy} onClick={() => onMove("learned")}>
              {t.markLearned}
            </Button>
            <Button busy={busy} onClick={() => onMove("dismissed")}>
              {t.dismiss}
            </Button>
          </>
        ) : (
          <Button busy={busy} onClick={() => onMove("active")}>
            {t.makeActive}
          </Button>
        )}
      </div>
    </article>
  );
}

const wordStatuses = ["new", "learning", "known", "dismissed"] as const;

export function WordsPage() {
  const t = copy.words;
  const route = useRoute();
  const status = pickStatus(route.query.get("status"), wordStatuses);
  const language = route.query.get("language");
  const { state, retry, set } = useLoad(() => getWords(status), status);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const move = async (word: Word, next: WordStatus) => {
    setBusy(word.id);
    setActionError(null);
    try {
      await patchWord(word.id, next);
      set((list) => list.filter((w) => w.id !== word.id));
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <PageHeader title={copy.pages.words} />
      <Tabs label={t.tabsLabel} param="status" values={wordStatuses} current={status} names={t.tabs} />
      {state.status === "ready" && (
        <LanguageFilter
          languages={languagesOf(state.data)}
          current={language}
          label={t.languageFilter}
          all={t.allLanguages}
        />
      )}
      {actionError !== null && <ErrorState what={t.update} error={actionError} />}
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorState what={t.load} error={state.error} onRetry={retry} />}
      {state.status === "ready" &&
        (state.data.length === 0 ? (
          <Empty
            text={t.empty[status]}
            action={status === "new" ? { href: "/sources", label: t.connectSource } : undefined}
          />
        ) : (
          <ul className="list">
            {filterByLanguage(state.data, language).map((word) => (
              <li key={word.id}>
                <WordCard word={word} busy={busy === word.id} onMove={(next) => move(word, next)} />
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}

function WordCard({
  word,
  busy,
  onMove,
}: {
  word: Word;
  busy: boolean;
  onMove: (status: WordStatus) => void;
}) {
  const t = copy.words;
  return (
    <article className="card knowledge-card">
      <div className="knowledge-tags">
        <span className="tag">{languageName(word.language)}</span>
        <span className="tag">{t.types[word.type]}</span>
      </div>
      <h2 lang={word.language}>{word.term}</h2>
      <p className="word-translation">{word.translation}</p>
      <p>{word.meaning}</p>
      <div className="word-example">
        <p className="label">{t.example}</p>
        <p lang={word.language}>{word.example}</p>
        <p className="secondary-text">{word.exampleTranslation}</p>
      </div>
      <p className="secondary-text small">
        {t.timesSuggested(word.timesSuggested)}. {t.lastSeen(formatDate(word.lastSeenAt))}
      </p>
      <div className="actions">
        {wordStatuses
          .filter((s) => s !== word.status)
          .map((next) => (
            <Button
              key={next}
              variant={next === "learning" ? "primary" : "secondary"}
              busy={busy}
              onClick={() => onMove(next)}
            >
              {t.actions[next]}
            </Button>
          ))}
      </div>
    </article>
  );
}
