'use client';
import { useState, useEffect } from 'react';
import { AlertCircle, ArrowUpRight, Check, Play, LoaderCircle } from 'lucide-react';
export async function api<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    credentials: 'same-origin',
    headers:
      body instanceof FormData
        ? undefined
        : body !== undefined
          ? { 'Content-Type': 'application/json' }
          : undefined,
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Unable to complete this request.');
  return data as T;
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return message ? (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <AlertCircle size={17} /> : <Check size={17} />}
      <span>{message}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={28} />
      <p>Getting things ready…</p>
    </div>
  );
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span
      className={`avatar ${small ? 'small' : ''}`}
      style={
        {
          '--avatar-color': ['#e2e7da', '#e6dfef', '#efdfd4', '#d8e5ed'][name.charCodeAt(0) % 4],
        } as React.CSSProperties
      }
    >
      {name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function dateLabel(value: string, timezone = 'America/New_York', full = false) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    ...(full
      ? { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
      : {}),
  }).format(new Date(value));
}
export function SongLink({ url }: { url: string }) {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url).hostname.replace('www.', '');
  } catch {
    return null;
  }
  return (
    <a className="song-link" href={url} target="_blank" rel="noopener noreferrer">
      <span className="song-link-icon">
        <Play size={15} fill="currentColor" />
      </span>
      <span>
        Give it a listen<small>{host}</small>
      </span>
      <ArrowUpRight size={17} />
    </a>
  );
}
export function AudioPlayer({
  clipId,
  ready,
  demo = false,
}: {
  clipId: string;
  ready: boolean;
  demo?: boolean;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setUrl('');
    setError('');
  }, [clipId]);
  if (demo)
    return (
      <div className="audio-placeholder">
        <span className="play-circle">
          <Play size={17} />
        </span>
        <div className="waveform" aria-hidden>
          {Array.from({ length: 45 }, (_, i) => (
            <i key={i} style={{ height: `${8 + ((i * 17 + 11) % 28)}px` }} />
          ))}
        </div>
        <small>Sample layout · no audio</small>
      </div>
    );
  return (
    <div>
      {url ? (
        <audio
          controls
          autoPlay
          src={url}
          onError={() => {
            setUrl('');
            setError('Playback expired or failed. Load the clip again.');
          }}
        />
      ) : (
        <button
          className="audio-load"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const r = await api<{ url: string }>(`clips/${clipId}`);
              setUrl(r.url);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play size={18} />
          {busy ? 'Loading…' : ready ? 'Play clip' : 'Audio unavailable'}
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
