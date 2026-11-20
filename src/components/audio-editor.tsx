'use client';
import { useEffect, useRef, useState } from 'react';
import { api, Notice } from './shared';
import { segmentSchema, youtubeUrl } from '@/lib/audio-source';

export type SourceTrack = { title: string; artist: string; url: string };
type Match = { title: string; channel: string; url: string; duration?: number };

export function PlaylistImporter({
  quizId,
  disabled,
  onAdd,
}: {
  quizId: string;
  disabled: boolean;
  onAdd: (track: SourceTrack, url: string) => void;
}) {
  const [link, setLink] = useState('');
  const [tracks, setTracks] = useState<SourceTrack[]>([]);
  const [query, setQuery] = useState('');
  const [track, setTrack] = useState<SourceTrack | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function search(text: string, source: SourceTrack | null) {
    setMatches([]);
    setTrack(source);
    setQuery(text);
    await run(async () => {
      const result = await api<{ matches: Match[] }>(`host/${quizId}/sources`, 'POST', {
        kind: 'search',
        query: text,
      });
      setMatches(result.matches);
      if (!result.matches.length)
        setMessage('No matches found. Try a different search or paste a video link into a clip.');
    });
  }
  return (
    <section className="card settings-card">
      <h2>Import songs</h2>
      <p>
        Import a Spotify track list, review YouTube matches, then choose an excerpt for each clip.
      </p>
      <label>
        Spotify playlist link
        <input
          type="url"
          placeholder="https://open.spotify.com/playlist/…"
          value={link}
          disabled={disabled || busy}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <button
        className="button secondary"
        disabled={disabled || busy || !link.trim()}
        onClick={() =>
          run(async () => {
            const result = await api<{ tracks: SourceTrack[]; truncated: boolean }>(
              `host/${quizId}/sources`,
              'POST',
              { kind: 'spotify', url: link },
            );
            setTracks(result.tracks);
            setMatches([]);
            setTrack(null);
            setMessage(
              result.tracks.length
                ? `Loaded ${result.tracks.length} songs.${result.truncated ? ' Import is limited to the first 30 available tracks.' : ''}`
                : 'No available songs in this playlist.',
            );
          })
        }
      >
        {busy ? 'Working…' : 'Read playlist'}
      </button>
      <div className="source-track-list">
        {tracks.map((t, i) => (
          <div className="source-track" key={`${t.url}-${i}`}>
            <div>
              <strong>{t.title}</strong>
              <span>{t.artist}</span>
              <a href={t.url} target="_blank" rel="noreferrer">
                View on Spotify
              </a>
            </div>
            <button
              className="button secondary"
              disabled={disabled || busy}
              onClick={() => search(`${t.artist} ${t.title} official audio`, t)}
            >
              Find YouTube matches
            </button>
          </div>
        ))}
      </div>
      <label>
        Or search YouTube by song and artist
        <input
          value={query}
          maxLength={250}
          disabled={disabled || busy}
          onChange={(e) => {
            setQuery(e.target.value);
            setTrack(null);
          }}
        />
      </label>
      <button
        className="button secondary"
        disabled={disabled || busy || !query.trim()}
        onClick={() => search(query, track)}
      >
        Search YouTube
      </button>
      {matches.length > 0 && (
        <div className="source-track-list">
          <p>
            Check the recording before adding it. Search results may include covers or live
            versions.
          </p>
          {matches.map((m) => (
            <div className="source-track" key={m.url}>
              <div>
                <a href={m.url} target="_blank" rel="noreferrer">
                  {m.title}
                </a>
                <span>
                  {m.channel}
                  {m.duration
                    ? ` · ${Math.floor(m.duration / 60)}:${String(Math.floor(m.duration % 60)).padStart(2, '0')}`
                    : ''}
                </span>
              </div>
              <button
                className="button"
                disabled={disabled || busy}
                onClick={() => {
                  onAdd(track || { title: '', artist: '', url: '' }, m.url);
                  setMessage(
                    'Added a clip below. Choose its start and end, then import the excerpt.',
                  );
                }}
              >
                Add this recording
              </button>
            </div>
          ))}
        </div>
      )}
      <Notice error message={error} />
      <Notice message={message} />
    </section>
  );
}

export function AudioEditor({
  initialUrl = '',
  disabled,
  onSubmit,
}: {
  initialUrl?: string;
  disabled: boolean;
  onSubmit: (source: { file?: File; url?: string; start: number; end: number }) => Promise<void>;
}) {
  const [mode, setMode] = useState<'file' | 'youtube'>(initialUrl ? 'youtube' : 'file');
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(20);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const sourceDuration = mode === 'file' ? duration : 0;
  useEffect(() => {
    if (!file) {
      setLocalUrl('');
      return;
    }
    const value = URL.createObjectURL(file);
    setLocalUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  function rangeStart(value: number) {
    const next = Math.max(0, value);
    setStart(next);
    setEnd(Math.min(sourceDuration || 43260, next + Math.min(60, Math.max(1, end - start))));
  }
  const valid =
    segmentSchema.safeParse({ start, end }).success &&
    (mode === 'youtube' ? !!url.trim() : !!file && duration > 0 && end <= duration);
  return (
    <div className="audio-editor">
      <label>
        Audio source
        <select
          value={mode}
          disabled={disabled || working}
          onChange={(e) => {
            setMode(e.target.value as 'file' | 'youtube');
            setError('');
            audio.current?.pause();
          }}
        >
          <option value="file">Upload an audio file</option>
          <option value="youtube">Audio from a YouTube link</option>
        </select>
      </label>
      {mode === 'youtube' ? (
        <label>
          YouTube link
          <input
            type="url"
            value={url}
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={disabled || working}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
        </label>
      ) : (
        <label className="upload-box">
          Choose audio (up to 25 MB)
          <input
            type="file"
            accept="audio/*"
            disabled={disabled || working}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              setError('');
              if (!chosen) return;
              if (!chosen.size || chosen.size > 25 * 1024 * 1024) {
                setError('Choose an audio file under 25 MB.');
                e.target.value = '';
                return;
              }
              setFile(chosen);
              setDuration(0);
              setStart(0);
              setEnd(20);
            }}
          />
        </label>
      )}
      {mode === 'file' && localUrl && (
        <audio
          ref={audio}
          src={localUrl}
          controls
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (!Number.isFinite(d) || d <= 0) {
              setError('Cannot determine this file’s duration. Choose a different file.');
              return;
            }
            setDuration(d);
            setEnd(Math.min(20, d));
          }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= end) e.currentTarget.pause();
          }}
          onPlay={(e) => {
            if (e.currentTarget.currentTime < start || e.currentTarget.currentTime >= end)
              e.currentTarget.currentTime = start;
          }}
          onError={() => {
            setDuration(0);
            setError('This browser cannot preview this file. Try MP3, WAV, or M4A.');
          }}
        />
      )}
      <div className="form-grid">
        <label>
          Start (seconds)
          <input
            type="number"
            min="0"
            max={sourceDuration || 43200}
            step="0.1"
            value={start}
            disabled={disabled || working}
            onChange={(e) => rangeStart(Number(e.target.value))}
          />
        </label>
        <label>
          End (seconds)
          <input
            type="number"
            min={start + 0.1}
            max={Math.min(sourceDuration || 43260, start + 60)}
            step="0.1"
            value={end}
            disabled={disabled || working}
            onChange={(e) => {
              setEnd(Number(e.target.value));
            }}
          />
        </label>
      </div>
      {mode === 'file' && duration > 0 && (
        <label>
          Scrub to the start
          <input
            type="range"
            min="0"
            max={Math.max(0, duration - 0.1)}
            step="0.1"
            value={start}
            disabled={disabled || working}
            onChange={(e) => {
              rangeStart(Number(e.target.value));
              if (audio.current) audio.current.currentTime = Number(e.target.value);
            }}
          />
        </label>
      )}
      <div className="button-row">
        {[15, 20, 30].map((seconds) => (
          <button
            className="button secondary"
            key={seconds}
            disabled={disabled || working}
            onClick={() => {
              setEnd(Math.min(sourceDuration || 43260, start + seconds));
            }}
          >
            {seconds} seconds
          </button>
        ))}
      </div>
      <p className="fine-print">
        Selected excerpt: {Math.max(0, end - start).toFixed(1)} seconds (maximum 60). Only the
        processed excerpt is shared with players.
      </p>
      {mode === 'youtube' && (
        <p className="fine-print">
          Import the excerpt to create an audio clip. Once processing finishes, refresh the quiz and
          use Play clip below to listen. To change the excerpt, adjust the times and import again.
        </p>
      )}
      <div className="button-row">
        {mode === 'file' && (
          <button
            className="button secondary"
            disabled={disabled || working || !valid}
            onClick={async () => {
              setError('');
              try {
                if (audio.current) {
                  audio.current.currentTime = start;
                  await audio.current.play();
                }
              } catch {
                setError('Audio preview failed. Check the audio file.');
              }
            }}
          >
            Preview excerpt
          </button>
        )}
        <button
          className="button"
          disabled={disabled || working || !valid}
          onClick={async () => {
            setError('');
            setWorking(true);
            audio.current?.pause();
            try {
              await onSubmit({
                ...(mode === 'file' ? { file: file! } : { url: youtubeUrl(url) }),
                start,
                end,
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setWorking(false);
            }
          }}
        >
          {working ? 'Submitting…' : mode === 'file' ? 'Upload excerpt' : 'Import YouTube excerpt'}
        </button>
      </div>
      {mode === 'youtube' && (
        <p className="fine-print">
          Use recordings you’re authorized to download and reuse. Availability varies; private,
          restricted, or blocked videos may fail.
        </p>
      )}
      <Notice error message={error} />
    </div>
  );
}
