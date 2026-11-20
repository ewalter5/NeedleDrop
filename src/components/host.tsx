'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ArrowLeft, Plus, Save, Trash2, Eye, Send, Check, Shield, RefreshCw } from 'lucide-react';
import { useApp } from './app';
import { api, AudioPlayer, Loading, Notice, dateLabel } from './shared';
import type { Quiz, Field, Submission, FieldKind } from '@/lib/types';
import { AudioEditor, PlaylistImporter, type SourceTrack } from './audio-editor';
type HostField = Field & { answer: string; alternatives: string[] };
type HostQuiz = Omit<Quiz, 'fields' | 'clips'> & {
  fields: HostField[];
  clips: { id: string; position: number; ready: boolean; audioStatus?: string }[];
};
type HostEntry = Submission & {
  suggestions: Record<string, { match: string; points: number | null }>;
};
type HostData = {
  quiz: HostQuiz;
  submissions: HostEntry[];
  hosts: { id: string; displayName: string }[];
};
type Member = { id: string; displayName: string; admin: boolean; restricted: boolean };
export function HostPage({ id }: { id?: string }) {
  const { data, refresh } = useApp();
  const router = useRouter();
  const [host, setHost] = useState<HostData | null>(null);
  const [quiz, setQuiz] = useState<HostQuiz | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [users, setUsers] = useState<Member[]>([]);
  const [assign, setAssign] = useState('');
  const [deadline, setDeadline] = useState('');
  const [sourceUrls, setSourceUrls] = useState<Record<string, string>>({});
  const [audioVersions, setAudioVersions] = useState<Record<string, number>>({});
  async function load() {
    if (!id) return;
    const h = await api<HostData>(`host/${id}`);
    setHost(h);
    setQuiz(h.quiz);
    setDeadline(formatInTimeZone(h.quiz.deadline, h.quiz.timezone, "yyyy-MM-dd'T'HH:mm"));
  }
  useEffect(() => {
    if (id) {
      if (data.demo) {
        setError(
          'The host studio needs connected services. The preview shows the player experience; live hosts get quiz editing, uploads, and grading here.',
        );
        return;
      }
      load().catch((e) => setError(e.message));
    }
    if (data.profile?.admin && !data.demo)
      api<Member[]>('admin/users')
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [id, data.demo, data.profile?.admin]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(fn: () => Promise<unknown>, success = 'Saved.') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (data.demo) throw new Error('Connect live services to use the host studio.');
      await fn();
      setMessage(success);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (!quiz) return;
    await api(`host/${id}`, 'PUT', {
      ...quiz,
      fields: quiz.fields.map((field, position) => ({
        ...field,
        position,
        alternatives: field.alternatives.map((a) => a.trim()).filter(Boolean),
      })),
    });
  }
  const update = (patch: Partial<HostQuiz>) => setQuiz((q) => (q ? { ...q, ...patch } : null));
  const updateField = (fieldId: string, patch: Partial<HostField>) =>
    setQuiz((q) =>
      q ? { ...q, fields: q.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) } : null,
    );
  function addSourceClip(track: SourceTrack, url: string) {
    if (!quiz || quiz.clips.length >= 30) return;
    const clipId = crypto.randomUUID();
    setSourceUrls((current) => ({ ...current, [clipId]: url }));
    update({
      clips: [...quiz.clips, { id: clipId, position: quiz.clips.length + 1, ready: false }],
      fields: [
        ...quiz.fields,
        ...(['title', 'artist', 'connection'] as const).map((kind, i) => ({
          id: crypto.randomUUID(),
          clipId,
          kind,
          label: { title: 'Song title', artist: 'Artist / author', connection: 'Theme connection' }[
            kind
          ],
          maxPoints: 1,
          position: quiz.fields.length + i,
          answer: kind === 'title' ? track.title : kind === 'artist' ? track.artist : '',
          alternatives: [],
        })),
      ],
    });
  }
  function addField(clipId: string | null, kind: FieldKind = 'custom') {
    if (!quiz) return;
    const labels = {
      title: 'Song title',
      artist: 'Artist / author',
      connection: 'Theme connection',
      custom: 'Your question',
      theme: 'Overall theme',
    };
    update({
      fields: [
        ...quiz.fields,
        {
          id: crypto.randomUUID(),
          clipId,
          kind,
          label: labels[kind],
          maxPoints: 1,
          position: quiz.fields.length,
          answer: '',
          alternatives: [],
        },
      ],
    });
  }
  if (!id)
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">BEHIND THE SCENES</span>
            <h1>
              The host studio<span className="orange">.</span>
            </h1>
            <p>Put together a good mystery. Help everyone find the connection.</p>
          </div>
          {data.profile?.admin && (
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const q = await api<{ id: string }>('quizzes', 'POST', {});
                  router.push(`/host/${q.id}`);
                }, 'Draft created.')
              }
            >
              <Plus size={17} />
              Create quiz
            </button>
          )}
        </div>
        <Notice error message={error} />
        <Notice message={message} />
        {data.demo && (
          <div className="card studio-intro">
            <Shield size={28} />
            <h2>A home for your quizmasters.</h2>
            <p>
              In live mode, assigned hosts can build quizzes, upload audio, preview the player view,
              and confirm suggested grades. Your dad can assign hosts and moderate the community.
            </p>
          </div>
        )}
        <div className="quiz-grid">
          {data.quizzes
            .filter((q) => data.profile?.admin || data.managedQuizIds?.includes(q.id))
            .map((q) => (
              <Link className="card host-list-card" href={`/host/${q.id}`} key={q.id}>
                <span className={`status ${q.state}`}>{q.state}</span>
                <h3>{q.title}</h3>
                <p>
                  {q.clipCount} clips · {dateLabel(q.deadline, q.timezone)}
                </p>
                <span className="text-link">Manage quiz →</span>
              </Link>
            ))}
        </div>
        {data.profile?.admin && !data.demo && (
          <AdminTools
            users={users}
            refreshUsers={async () => setUsers(await api<Member[]>('admin/users'))}
          />
        )}
      </>
    );
  if (!quiz || !host)
    return (
      <>
        <Link href="/host" className="back-link">
          <ArrowLeft size={16} />
          Host studio
        </Link>
        {error ? <Notice error message={error} /> : <Loading />}
      </>
    );
  const editable = quiz.state === 'draft';
  const fieldEditor = (f: HostField) => (
    <div className="field-editor" key={f.id}>
      <div className="field-editor-top">
        <label>
          Question label
          <input
            disabled={!editable || busy}
            value={f.label}
            maxLength={100}
            onChange={(e) => updateField(f.id, { label: e.target.value })}
          />
        </label>
        <label>
          Type
          <select
            disabled={!editable || busy}
            value={f.kind}
            onChange={(e) => updateField(f.id, { kind: e.target.value as FieldKind })}
          >
            {['title', 'artist', 'connection', 'custom', 'theme'].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Points
          <input
            type="number"
            step="0.25"
            min="0.25"
            max="1000"
            disabled={!editable || busy}
            value={f.maxPoints}
            onChange={(e) => updateField(f.id, { maxPoints: Number(e.target.value) })}
          />
        </label>
        {editable && (
          <button
            className="icon-button danger"
            aria-label="Remove question"
            disabled={busy}
            onClick={() => update({ fields: quiz.fields.filter((x) => x.id !== f.id) })}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      <label>
        Correct answer / grading guide
        <textarea
          rows={2}
          disabled={!editable || busy}
          value={f.answer}
          onChange={(e) => updateField(f.id, { answer: e.target.value })}
        />
      </label>
      <label>
        Accepted alternatives (one per line)
        <textarea
          rows={2}
          disabled={!editable || busy}
          value={f.alternatives.join('\n')}
          onChange={(e) => updateField(f.id, { alternatives: e.target.value.split('\n') })}
        />
      </label>
    </div>
  );
  return (
    <>
      <Link href="/host" className="back-link">
        <ArrowLeft size={15} />
        Host studio
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">QUIZ WORKSPACE · {quiz.state}</span>
          <h1>
            {quiz.title}
            <span className="orange">.</span>
          </h1>
          <p>
            {editable
              ? 'Build your quiz, save it, then upload the clips.'
              : 'Question structure is locked. Manage the deadline or grade submitted entries.'}
          </p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => setPreview(!preview)}>
            <Eye size={16} />
            {preview ? 'Back to editor' : 'Player preview'}
          </button>
          <button
            className="icon-button"
            aria-label="Refresh quiz"
            disabled={busy}
            onClick={() => action(load, 'Quiz refreshed.')}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <Notice error message={error} />
      <Notice message={message} />
      {preview ? (
        <div className="preview-quiz">
          <Notice message="Host preview: answer keys are hidden in this view." />
          <section className="card clip-card">
            <h2>{quiz.title}</h2>
            <p className="rules-text">{quiz.rules}</p>
          </section>
          {quiz.clips.map((c) => (
            <section className="card clip-card" key={c.id}>
              <h2>Clip {c.position}</h2>
              <AudioPlayer clipId={c.id} ready={c.ready} />
              {quiz.fields
                .filter((f) => f.clipId === c.id)
                .map((f) => (
                  <label key={f.id}>
                    {f.label} · {f.maxPoints} pts
                    <input disabled placeholder="Player’s answer" />
                  </label>
                ))}
            </section>
          ))}
          {quiz.fields
            .filter((f) => !f.clipId)
            .map((f) => (
              <section className="card clip-card" key={f.id}>
                <label>
                  {f.label}
                  <input disabled placeholder="Player’s answer" />
                </label>
              </section>
            ))}
        </div>
      ) : (
        <>
          <section className="card settings-card">
            <h2>Quiz details</h2>
            <label>
              Title
              <input
                value={quiz.title}
                disabled={!editable || busy}
                maxLength={150}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <label>
              Introduction
              <textarea
                rows={2}
                value={quiz.description}
                disabled={!editable || busy}
                onChange={(e) => update({ description: e.target.value })}
              />
            </label>
            <label>
              Rules
              <textarea
                rows={4}
                value={quiz.rules}
                disabled={!editable || busy}
                onChange={(e) => update({ rules: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Timezone
                <select
                  disabled={!editable || busy}
                  value={quiz.timezone}
                  onChange={(e) => {
                    update({ timezone: e.target.value });
                    setDeadline(
                      formatInTimeZone(quiz.deadline, e.target.value, "yyyy-MM-dd'T'HH:mm"),
                    );
                  }}
                >
                  {['UTC', ...Intl.supportedValuesOf('timeZone')].map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Release time
                <input
                  type="datetime-local"
                  disabled={!editable || busy}
                  value={formatInTimeZone(quiz.releaseAt, quiz.timezone, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => {
                    if (e.target.value)
                      update({
                        releaseAt: fromZonedTime(e.target.value, quiz.timezone).toISOString(),
                      });
                  }}
                />
              </label>
              <label>
                Submission deadline
                <input
                  type="datetime-local"
                  disabled={busy || !['draft', 'scheduled', 'open'].includes(quiz.state)}
                  value={deadline}
                  onChange={(e) => {
                    setDeadline(e.target.value);
                    if (editable && e.target.value)
                      update({
                        deadline: fromZonedTime(e.target.value, quiz.timezone).toISOString(),
                      });
                  }}
                />
              </label>
            </div>
            {!editable && ['scheduled', 'open'].includes(quiz.state) && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  action(
                    () =>
                      api(`host/${id}/deadline`, 'PATCH', {
                        deadline: fromZonedTime(deadline, quiz.timezone).toISOString(),
                      }),
                    'Deadline updated. Outstanding reminders will use the new deadline.',
                  )
                }
              >
                Update deadline
              </button>
            )}
          </section>
          {editable && (
            <PlaylistImporter
              quizId={id}
              disabled={busy || quiz.clips.length >= 30}
              onAdd={addSourceClip}
            />
          )}
          {quiz.clips.map((clip, i) => (
            <section className="card clip-card" key={clip.id}>
              <div className="section-heading">
                <h2>Clip {String(clip.position).padStart(2, '0')}</h2>
                {editable && (
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() =>
                      update({
                        clips: quiz.clips
                          .filter((c) => c.id !== clip.id)
                          .map((c, i) => ({ ...c, position: i + 1 })),
                        fields: quiz.fields.filter((f) => f.clipId !== clip.id),
                      })
                    }
                  >
                    <Trash2 size={15} />
                    Remove clip
                  </button>
                )}
              </div>
              {editable && (
                <AudioEditor
                  initialUrl={sourceUrls[clip.id]}
                  disabled={busy}
                  onSubmit={async (source) => {
                    await action(async () => {
                      await saveDraft();
                      if (source.url)
                        await api(`clips/${clip.id}/youtube`, 'POST', {
                          url: source.url,
                          start: source.start,
                          end: source.end,
                        });
                      else {
                        const form = new FormData();
                        form.set('audio', source.file!);
                        form.set('start', String(source.start));
                        form.set('end', String(source.end));
                        await api(`clips/${clip.id}`, 'POST', form);
                      }
                      setAudioVersions((current) => ({
                        ...current,
                        [clip.id]: (current[clip.id] || 0) + 1,
                      }));
                      await load();
                    }, 'Excerpt queued. Refresh after the background worker processes it.');
                  }}
                />
              )}
              <p className="fine-print">
                {clip.ready
                  ? 'Processed and ready.'
                  : clip.audioStatus === 'failed'
                    ? 'Processing failed. Check the source and range, then import again.'
                    : clip.audioStatus === 'processing'
                      ? 'Processing queued. Refresh after the next background job cycle.'
                      : 'Not ready yet. Save, upload, then refresh after processing.'}{' '}
                Original names and tags are removed before player access.
              </p>
              {clip.ready && (
                <AudioPlayer
                  key={`${clip.id}-${audioVersions[clip.id] || 0}`}
                  clipId={clip.id}
                  ready
                />
              )}
              {quiz.fields.filter((f) => f.clipId === clip.id).map(fieldEditor)}
              {editable && (
                <div className="button-row">
                  <button
                    className="button secondary small-button"
                    disabled={busy}
                    onClick={() => addField(clip.id, 'custom')}
                  >
                    <Plus size={14} />
                    Add question
                  </button>
                </div>
              )}
            </section>
          ))}
          {editable && (
            <button
              className="button secondary"
              disabled={busy || quiz.clips.length >= 30}
              onClick={() => {
                const clipId = crypto.randomUUID();
                const start = quiz.fields.length;
                update({
                  clips: [
                    ...quiz.clips,
                    { id: clipId, position: quiz.clips.length + 1, ready: false },
                  ],
                  fields: [
                    ...quiz.fields,
                    ...(['title', 'artist', 'connection'] as FieldKind[]).map((kind, j) => ({
                      id: crypto.randomUUID(),
                      clipId,
                      label: {
                        title: 'Song title',
                        artist: 'Artist / author',
                        connection: 'Theme connection',
                      }[kind as 'title' | 'artist' | 'connection'],
                      kind,
                      maxPoints: 1,
                      position: start + j,
                      answer: '',
                      alternatives: [],
                    })),
                  ],
                });
              }}
            >
              <Plus size={16} />
              Add clip with title, artist & connection
            </button>
          )}
          <section className="card settings-card theme-editor">
            <h2>Quiz-wide questions</h2>
            {quiz.fields.filter((f) => !f.clipId).map(fieldEditor)}
            {editable && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => addField(null, 'theme')}
              >
                <Plus size={16} />
                Add overall-theme question
              </button>
            )}
          </section>
          {editable && (
            <div className="sticky-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => action(saveDraft, 'Draft saved.')}
              >
                <Save size={16} />
                Save draft
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await saveDraft();
                    await api(`host/${id}/publish`, 'POST', {});
                    await load();
                  }, 'Quiz scheduled. The answer structure and audio are now locked.')
                }
              >
                <Send size={16} />
                Schedule / publish quiz
              </button>
            </div>
          )}
          {data.profile?.admin && (
            <section className="card settings-card">
              <h2>Assigned guest hosts</h2>
              {host.hosts.map((h) => (
                <div className="member-row" key={h.id}>
                  <span>{h.displayName}</span>
                  <button
                    className="text-button danger"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await api(`host/${id}/hosts`, 'PUT', { userId: h.id, remove: true });
                        await load();
                      })
                    }
                  >
                    Remove access
                  </button>
                </div>
              ))}
              <div className="button-row">
                <select
                  aria-label="Choose guest host"
                  value={assign}
                  onChange={(e) => setAssign(e.target.value)}
                >
                  <option value="">Choose a member…</option>
                  {users
                    .filter((u) => !u.restricted)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                </select>
                <button
                  className="button secondary"
                  disabled={busy || !assign}
                  onClick={() =>
                    action(async () => {
                      await api(`host/${id}/hosts`, 'PUT', { userId: assign });
                      await load();
                    })
                  }
                >
                  Assign host
                </button>
              </div>
            </section>
          )}
          {['grading', 'released'].includes(quiz.state) && (
            <section className="grading-section">
              <div className="section-heading">
                <h2>Review submitted entries</h2>
                <span>
                  {host.submissions.filter((s) => s.reviewed).length}/{host.submissions.length}{' '}
                  confirmed
                </span>
              </div>
              <p className="section-description">
                Exact matches are suggestions. Confirm every field to release results automatically.
              </p>
              {host.submissions.map((s) => (
                <GradeEntry key={s.id} quiz={quiz} submission={s} onDone={load} />
              ))}
              {host.submissions.length === 0 && (
                <div className="card settings-card">
                  <p>No submitted entries. Drafts are excluded.</p>
                  {data.profile?.admin && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await api(`host/${id}/close`, 'POST', {});
                          await load();
                        }, 'Empty quiz closed.')
                      }
                    >
                      Close empty quiz
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
function GradeEntry({
  quiz,
  submission: s,
  onDone,
}: {
  quiz: HostQuiz;
  submission: HostEntry;
  onDone: () => Promise<void>;
}) {
  const [grades, setGrades] = useState<Record<string, { points: number | null; feedback: string }>>(
    () =>
      Object.fromEntries(
        quiz.fields.map((f) => [
          f.id,
          {
            points: s.grades[f.id]?.points ?? s.suggestions[f.id]?.points ?? null,
            feedback: s.grades[f.id]?.feedback || '',
          },
        ]),
      ),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!s.reviewed);
  return (
    <section className="card grade-entry">
      <button className="disclosure" onClick={() => setOpen(!open)}>
        <strong>{s.displayName}</strong>
        <span className={`status ${s.reviewed ? 'released' : 'grading'}`}>
          {s.reviewed ? 'Reviewed' : 'Needs review'}
        </span>
      </button>
      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api(`host/${quiz.id}/grades/${s.id}`, 'PUT', { grades });
              await onDone();
              setOpen(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {quiz.fields.map((f) => (
            <div className="grading-field" key={f.id}>
              <span className="eyebrow">
                {f.clipId ? `CLIP ${quiz.clips.find((c) => c.id === f.clipId)?.position} · ` : ''}
                {f.label}
              </span>
              <div className="grading-answers">
                <div>
                  <small>Player guessed</small>
                  <p>{s.answers[f.id] || 'No answer'}</p>
                </div>
                <div>
                  <small>Answer key</small>
                  <p>{f.answer}</p>
                </div>
              </div>
              <span className={`match-chip ${s.suggestions[f.id]?.match}`}>
                {s.suggestions[f.id]?.match === 'exact'
                  ? 'Exact match — suggested full credit'
                  : s.suggestions[f.id]?.match === 'possible'
                    ? 'Possible misspelling — review needed'
                    : 'Manual review'}
              </span>
              <div className="grade-inputs">
                <label>
                  Points / {f.maxPoints}
                  <input
                    type="number"
                    min={0}
                    max={f.maxPoints}
                    step="0.25"
                    required
                    value={grades[f.id].points ?? ''}
                    onChange={(e) =>
                      setGrades({
                        ...grades,
                        [f.id]: {
                          ...grades[f.id],
                          points: e.target.value === '' ? null : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Feedback
                  <input
                    maxLength={2000}
                    value={grades[f.id].feedback}
                    onChange={(e) =>
                      setGrades({
                        ...grades,
                        [f.id]: { ...grades[f.id], feedback: e.target.value },
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
          <Notice error message={error} />
          <button className="button" disabled={busy}>
            <Check size={16} />
            {busy ? 'Saving…' : s.reviewed ? 'Confirm corrected grades' : 'Confirm all grades'}
          </button>
        </form>
      )}
    </section>
  );
}
function AdminTools({
  users,
  refreshUsers,
}: {
  users: Member[];
  refreshUsers: () => Promise<void>;
}) {
  const { data, refresh } = useApp();
  const [settings, setSettings] = useState(data.settings);
  const [jobs, setJobs] = useState<
    { id: string; kind: string; state: string; last_error: string }[]
  >([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<typeof jobs>('admin/jobs')
      .then(setJobs)
      .catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setMessage('Saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-tools">
      <Notice error message={error} />
      <Notice message={message} />
      <section className="card settings-card">
        <h2>Weekly digest schedule</h2>
        <div className="form-grid">
          <label>
            Day
            <select
              value={settings.digestDay}
              onChange={(e) => setSettings({ ...settings, digestDay: Number(e.target.value) })}
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (d, i) => (
                  <option value={i} key={d}>
                    {d}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Hour (0–23)
            <input
              type="number"
              min={0}
              max={23}
              value={settings.digestHour}
              onChange={(e) => setSettings({ ...settings, digestHour: Number(e.target.value) })}
            />
          </label>
          <label>
            Timezone
            <input
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            />
          </label>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api('admin/settings', 'PUT', settings);
              await refresh();
            })
          }
        >
          Save digest schedule
        </button>
      </section>
      <section className="card settings-card">
        <h2>Community members</h2>
        {users.map((u) => (
          <div className="member-row" key={u.id}>
            <span>
              {u.displayName}
              {u.admin ? ' · Administrator' : ''}
            </span>
            {u.id !== data.profile?.id && (
              <button
                className={`text-button ${u.restricted ? '' : 'danger'}`}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api('admin/users', 'PATCH', { id: u.id, restricted: !u.restricted });
                    await refreshUsers();
                  })
                }
              >
                {u.restricted ? 'Restore access' : 'Restrict account'}
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="card settings-card">
        <div className="section-heading">
          <h2>Background jobs</h2>
          <button
            className="text-button"
            onClick={() =>
              api<typeof jobs>('admin/jobs')
                .then(setJobs)
                .catch((e) => setError(e.message))
            }
          >
            Refresh
          </button>
        </div>
        <p className="fine-print">
          Pending work and failures. Job errors omit audio metadata and email addresses.
        </p>
        {jobs.length ? (
          jobs.map((j) => (
            <div className="job-row" key={j.id}>
              <strong>{j.kind}</strong>
              <span>{j.state}</span>
              <small>{j.last_error}</small>
            </div>
          ))
        ) : (
          <p>All caught up.</p>
        )}
      </section>
    </div>
  );
}
