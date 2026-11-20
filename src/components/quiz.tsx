'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Disc3,
  Headphones,
  LockKeyhole,
  Save,
  Send,
  Trophy,
  ChevronDown,
} from 'lucide-react';
import { useApp } from './app';
import { api, AudioPlayer, Avatar, dateLabel, Loading, Notice } from './shared';
import type { Quiz, Submission, Result, Field } from '@/lib/types';

type Entry = Submission & { version: number };
export function QuizPage({ id }: { id: string }) {
  const { data } = useApp();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('All changes saved');
  const [submitting, setSubmitting] = useState(false);
  const [rules, setRules] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const latest = useRef<Record<string, string>>({});
  const version = useRef(0);
  const dirty = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);
  const key = `needle-drop:${data.demo ? 'preview' : data.profile?.id}:${id}`;
  useEffect(() => {
    let mounted = true;
    api<{ quiz: Quiz; submission: Entry | null }>(`quizzes/${id}`)
      .then((r) => {
        if (!mounted) return;
        let initial = r.submission?.answers || {};
        version.current = r.submission?.version || 0;
        try {
          const local = JSON.parse(localStorage.getItem(key) || 'null');
          if (local && local.version === version.current) {
            initial = { ...initial, ...local.answers };
            if (JSON.stringify(initial) !== JSON.stringify(r.submission?.answers || {})) {
              dirty.current = true;
              setStatus(data.demo ? 'Saved on this device' : 'Recovered answers — save to sync');
            }
          }
        } catch {
          /* Storage may be disabled. */
        }
        latest.current = initial;
        setAnswers(initial);
        setQuiz(r.quiz);
        setEntry(r.submission);
      })
      .catch((e) => mounted && setError(e.message));
    const interval = setInterval(() => setTick(Date.now()), 15000);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current && !data.demo) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      mounted = false;
      clearInterval(interval);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('beforeunload', unload);
    };
  }, [id, key, data.demo]);
  function storeLocal() {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ answers: latest.current, version: version.current }),
      );
    } catch {
      setStatus('Device storage unavailable — keep this page open until synced');
    }
  }
  function persist(submit = false): Promise<void> {
    const task = chain.current
      .catch(() => {})
      .then(async () => {
        if (blocked.current)
          throw new Error(
            'Reload this page to resolve the conflicting save. Your device copy is preserved.',
          );
        const snapshot = { ...latest.current };
        setStatus(submit ? 'Submitting…' : 'Saving…');
        try {
          if (data.demo) {
            storeLocal();
            dirty.current = false;
            setStatus('Saved on this device');
            if (submit)
              setEntry({
                id: 'preview',
                userId: data.profile!.id,
                answers: snapshot,
                submittedAt: new Date().toISOString(),
                reviewed: false,
                grades: {},
                version: 0,
              });
            return;
          }
          const saved = await api<Entry>(`quizzes/${id}/submission`, 'PUT', {
            answers: snapshot,
            submit,
            version: version.current,
          });
          version.current = saved.version;
          setEntry(saved);
          storeLocal();
          dirty.current = JSON.stringify(snapshot) !== JSON.stringify(latest.current);
          setStatus(dirty.current ? 'Changes waiting to save' : 'All changes saved');
          setError('');
        } catch (e) {
          const message = (e as Error).message;
          if (message.includes('another tab')) blocked.current = true;
          setStatus('Not synced — your answers are on this device');
          setError(message);
          throw e;
        }
      });
    chain.current = task;
    return task;
  }
  function change(fieldId: string, value: string) {
    latest.current = { ...latest.current, [fieldId]: value };
    setAnswers(latest.current);
    dirty.current = true;
    storeLocal();
    setStatus('Unsaved changes');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      persist().catch(() => {});
    }, 750);
  }
  if (!quiz) return error ? <Notice error message={error} /> : <Loading />;
  const closed = quiz.state !== 'open' || (!data.demo && tick >= new Date(quiz.deadline).getTime());
  const filled = quiz.fields!.filter((f) => (answers[f.id] || '').trim()).length;
  const total = quiz.fields!.length;
  const renderField = (f: Field) => (
    <label className={f.kind === 'connection' || !f.clipId ? 'wide' : ''} key={f.id}>
      <span>
        {f.label}
        <small>
          {f.maxPoints} {f.maxPoints === 1 ? 'pt' : 'pts'}
        </small>
      </span>
      {f.kind === 'connection' || f.kind === 'theme' ? (
        <textarea
          rows={2}
          value={answers[f.id] || ''}
          disabled={closed || submitting}
          maxLength={4000}
          placeholder={f.kind === 'theme' ? 'What’s the common thread?' : 'Your connection…'}
          onChange={(e) => change(f.id, e.target.value)}
        />
      ) : (
        <input
          value={answers[f.id] || ''}
          disabled={closed || submitting}
          maxLength={4000}
          placeholder="Your guess…"
          onChange={(e) => change(f.id, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <>
      <Link href="/" className="back-link">
        <ArrowLeft size={15} />
        Back to overview
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE MONTHLY MUSIC QUIZ</span>
          <h1>
            {quiz.title}
            <span className="orange">.</span>
          </h1>
          <p>
            Hosted by {quiz.hostName} · {quiz.clipCount} clips · {quiz.maxPoints} points
          </p>
        </div>
        <span className={`status ${closed ? 'grading' : 'open'}`}>
          {closed ? 'Submissions closed' : 'Open for guesses'}
        </span>
      </div>
      {error && <Notice message={error} error />}
      {entry?.submittedAt && (
        <Notice
          message={
            data.demo
              ? 'Preview submission saved on this device. You can still edit your answers.'
              : 'Your entry is submitted. You can keep making changes until the deadline.'
          }
        />
      )}
      {closed && (
        <Notice message="Submissions have closed. Your last saved entry is shown below." />
      )}
      <div className="quiz-layout">
        <div>
          <section className="card rules-card">
            <button className="disclosure" onClick={() => setRules(!rules)}>
              <span>
                <Headphones size={19} />
                Before the needle drops
              </span>
              <ChevronDown className={rules ? 'rotate' : ''} size={18} />
            </button>
            <p>{quiz.description}</p>
            {rules && <div className="rules-text">{quiz.rules}</div>}
          </section>
          {quiz.clips?.map((clip) => (
            <section className="card clip-card" id={`clip-${clip.position}`} key={clip.id}>
              <div className="clip-heading">
                <span className="clip-number">{String(clip.position).padStart(2, '0')}</span>
                <div>
                  <h2>Clip {String(clip.position).padStart(2, '0')}</h2>
                  <p>A title, an artist, a piece of the puzzle.</p>
                </div>
                {quiz.fields
                  ?.filter((f) => f.clipId === clip.id)
                  .every((f) => (answers[f.id] || '').trim()) ? (
                  <CheckCircle2 size={21} className="green" />
                ) : (
                  <Disc3 size={21} className="muted" />
                )}
              </div>
              <AudioPlayer clipId={clip.id} ready={clip.ready} demo={data.demo} />
              <div className="answer-fields">
                {quiz.fields?.filter((f) => f.clipId === clip.id).map(renderField)}
              </div>
            </section>
          ))}
          {!!quiz.fields?.some((f) => !f.clipId) && (
            <section className="card clip-card theme-card">
              <span className="eyebrow">THE BIG PICTURE</span>
              <h2>Bring it all together.</h2>
              <div className="answer-fields">
                {quiz.fields.filter((f) => !f.clipId).map(renderField)}
              </div>
            </section>
          )}
        </div>
        <aside>
          <div className="card entry-summary">
            <span className="eyebrow">YOUR RECORD SO FAR</span>
            <h3>
              {filled}
              <span> / {total}</span>
            </h3>
            <p>questions with a guess</p>
            <div className="progress-track">
              <i style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
            </div>
            <div className="clip-jumps">
              {quiz.clips?.map((c) => (
                <a href={`#clip-${c.position}`} key={c.id}>
                  {String(c.position).padStart(2, '0')}
                </a>
              ))}
            </div>
            <div className="summary-deadline">
              <Clock3 size={17} />
              <span>
                Answers due<strong>{dateLabel(quiz.deadline, quiz.timezone, true)}</strong>
              </span>
            </div>
            <div className="save-status" role="status">
              <Save size={14} />
              {status}
            </div>
            {!closed && (
              <>
                <button
                  className="button full"
                  disabled={submitting}
                  onClick={async () => {
                    if (timer.current) clearTimeout(timer.current);
                    setSubmitting(true);
                    try {
                      await persist(true);
                    } catch {
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  <Send size={16} />
                  {submitting
                    ? 'Submitting…'
                    : entry?.submittedAt
                      ? 'Update submission'
                      : 'Submit my answers'}
                </button>
                <button
                  className="text-button full"
                  disabled={submitting}
                  onClick={() => persist(false).catch(() => {})}
                >
                  Save now
                </button>
                <p className="fine-print">
                  Blank answers are allowed. You can revise your submission until the deadline.
                </p>
              </>
            )}
            {quiz.state === 'released' && (
              <Link className="button full" href={`/results/${id}`}>
                See results <ArrowRight size={16} />
              </Link>
            )}
          </div>
          <div className="quiet-note">
            <LockKeyhole size={16} />
            <p>Your guesses stay private until everyone’s scores are ready.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
export function ResultsPage({ id }: { id: string }) {
  const { data } = useApp();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    api<Result>(`results/${id}`)
      .then((r) => {
        setResult(r);
        setSelected(r.submissions[0]?.id || '');
      })
      .catch((e) => setError(e.message));
  }, [id]);
  if (!result) return error ? <Notice error message={error} /> : <Loading />;
  const score = (s: Submission) =>
    Object.values(s.grades).reduce((n, g) => n + Number(g.points), 0);
  const sorted = [...result.submissions].sort(
    (a, b) => score(b) - score(a) || (a.displayName || '').localeCompare(b.displayName || ''),
  );
  const s = sorted.find((s) => s.id === selected);
  return (
    <>
      <Link href="/results" className="back-link">
        <ArrowLeft size={15} />
        All results
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE RESULTS ARE IN</span>
          <h1>
            {result.quiz.title}
            <span className="orange">.</span>
          </h1>
          <p>The mystery, solved. Here’s how everyone heard it.</p>
        </div>
        <span className="status released">
          <Check size={13} />
          All graded
        </span>
      </div>
      <div className="results-banner">
        <Trophy size={40} />
        <div>
          <h2>
            {sorted.length
              ? `${sorted[0].displayName} tops the charts.`
              : 'A quiet month on the turntable.'}
          </h2>
          <p>
            {sorted.length
              ? `${score(sorted[0])} points. A fine pair of ears.`
              : 'No submitted entries for this quiz.'}
          </p>
        </div>
      </div>
      <div className="results-layout">
        <section className="card leaderboard">
          <div className="section-heading">
            <h2>The leaderboard</h2>
            <small>{sorted.length} players</small>
          </div>
          {sorted.map((s, i) => (
            <button
              className={`leader-row ${selected === s.id ? 'selected' : ''}`}
              key={s.id}
              onClick={() => setSelected(s.id)}
            >
              <span className="rank">
                {i > 0 && score(s) === score(sorted[i - 1]) ? '=' : i + 1}
              </span>
              <Avatar name={s.displayName || 'Player'} small />
              <strong>{s.displayName}</strong>
              <span>
                {score(s)}
                <small> pts</small>
              </span>
            </button>
          ))}
        </section>
        <section className="card guesses">
          <h2>{s ? `${s.displayName}’s guesses` : 'The answer key'}</h2>
          <p className="muted">Choose a player to compare their answers.</p>
          {result.fields.map((f, i) => (
            <div className="result-answer" key={f.id}>
              <span className="eyebrow">
                {f.clipId
                  ? `CLIP ${String(result.quiz.clips?.find((c) => c.id === f.clipId)?.position || Math.floor(i / 3) + 1).padStart(2, '0')} · `
                  : ''}
                {f.label}
              </span>
              <strong>{f.answer}</strong>
              {s && (
                <>
                  <p>
                    Guessed: <span>{s.answers[f.id] || 'No answer'}</span>
                    <b>
                      {s.grades[f.id]?.points ?? 0}/{f.maxPoints}
                    </b>
                  </p>
                  {s.grades[f.id]?.feedback && (
                    <div className="grade-feedback">{s.grades[f.id].feedback}</div>
                  )}
                </>
              )}
            </div>
          ))}
          <p className="fine-print">
            Audio is removed seven days after results are released. Answers and scores stay in the
            collection.
          </p>
          {!data.demo &&
            result.quiz.clips
              ?.filter((c) => c.ready)
              .map((c) => (
                <div key={c.id} className="result-audio">
                  <span>Clip {c.position}</span>
                  <AudioPlayer clipId={c.id} ready={c.ready} />
                </div>
              ))}
        </section>
      </div>
    </>
  );
}
