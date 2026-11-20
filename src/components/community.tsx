'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  MessageCircle,
  Plus,
  Send,
  Music2,
  Pencil,
  Trash2,
  Link2,
} from 'lucide-react';
import { useApp } from './app';
import { api, Avatar, dateLabel, Notice, SongLink } from './shared';
import type { Post } from '@/lib/types';

export function Community() {
  const { data } = useApp();
  const [compose, setCompose] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GOOD FINDS DESERVE GOOD COMPANY</span>
          <h1>
            The listening room<span className="orange">.</span>
          </h1>
          <p>What’s been on repeat? Share a song. Start a conversation.</p>
        </div>
        <button className="button" onClick={() => setCompose(!compose)}>
          <Plus size={17} />
          Share a song
        </button>
      </div>
      <div className="community-layout">
        <div>
          {compose && <Composer onDone={() => setCompose(false)} />}
          <div className="feed-label">
            <span>
              <i /> THE LATEST DISCOVERIES
            </span>
            <small>{data.posts.length} conversations</small>
          </div>
          {data.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          {!data.posts.length && (
            <div className="card empty">
              <Music2 size={30} />
              <h3>The room is yours.</h3>
              <p>Share the first song and get the conversation going.</p>
            </div>
          )}
        </div>
        <aside>
          <div className="mini-card room-note">
            <Music2 size={28} />
            <h3>No wrong answers here.</h3>
            <p>
              A new discovery. An old favorite. Something delightfully obscure. This is the space
              for all of it.
            </p>
            <hr />
            <p>Be kind, give a little context, and let the music do its thing.</p>
          </div>
          <div className="mini-card newsletter">
            <span className="eyebrow">THE WEEKLY ROUNDUP</span>
            <h3>A good week in music.</h3>
            <p>Fresh discoveries, delivered in one weekly email. Your inbox will thank you.</p>
            <Link href="/account" className="text-link">
              Manage your digest <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
function Composer({
  parentId = null,
  initial,
  onDone,
}: {
  parentId?: string | null;
  initial?: Post;
  onDone: () => void;
}) {
  const { data, refresh } = useApp();
  const [body, setBody] = useState(initial?.body || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (data.demo) {
          setError('Posting is available after live services are connected.');
          return;
        }
        setBusy(true);
        setError('');
        try {
          await api(initial ? `posts/${initial.id}` : 'posts', initial ? 'PATCH' : 'POST', {
            body,
            url,
            parentId,
          });
          await refresh();
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        {initial
          ? 'Edit your post'
          : parentId
            ? 'Join the conversation'
            : 'What should we listen to?'}
      </h3>
      <textarea
        aria-label="Post text"
        rows={parentId ? 2 : 4}
        maxLength={5000}
        required
        placeholder={parentId ? 'Add your reply…' : 'Tell us a little about your pick…'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <label className="link-input">
        <Link2 size={16} />
        <input
          aria-label="Song link"
          type="url"
          placeholder="A song link (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <Notice message={error} error />
      <div className="composer-bottom">
        <span>Links & words. Good company.</span>
        <div className="button-row">
          <button type="button" className="text-button" onClick={onDone}>
            Cancel
          </button>
          <button className="button small-button" disabled={busy}>
            <Send size={15} />
            {busy ? 'Sending…' : initial ? 'Save changes' : parentId ? 'Reply' : 'Share it'}
          </button>
        </div>
      </div>
    </form>
  );
}
export function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const { data, refresh } = useApp();
  const [reply, setReply] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const canEdit = data.profile?.id === post.authorId || data.profile?.admin;
  if (editing) return <Composer initial={post} onDone={() => setEditing(false)} />;
  async function remove() {
    if (data.demo) {
      setError('Deleting posts needs connected services.');
      return;
    }
    try {
      await api(`posts/${post.id}`, 'DELETE');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <article className={`card post-card ${compact ? 'compact' : ''}`} id={`post-${post.id}`}>
      <div className="post-header">
        <Avatar name={post.author} />
        <div>
          <strong>{post.author}</strong>
          <small>{dateLabel(post.createdAt)}</small>
        </div>
        {canEdit && !compact && (
          <div className="post-actions">
            <button aria-label="Edit post" className="icon-button" onClick={() => setEditing(true)}>
              <Pencil size={14} />
            </button>
            <button
              aria-label="Delete post"
              className="icon-button"
              onClick={() => setConfirmDelete(!confirmDelete)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      <p className="post-body">{post.body}</p>
      <SongLink url={post.url} />
      <div className="post-bottom">
        {compact ? (
          <Link className="text-button" href={`/community#post-${post.id}`}>
            <MessageCircle size={15} />
            {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}
          </Link>
        ) : (
          <button className="text-button" onClick={() => setReply(!reply)}>
            <MessageCircle size={15} />
            {post.replies.length} {post.replies.length === 1 ? 'reply' : 'replies'}{' '}
            <span className="muted">· Add yours</span>
          </button>
        )}
        <span className="post-tag">A GOOD LISTEN</span>
      </div>
      {confirmDelete && (
        <div className="delete-confirm">
          Remove this post and its replies?
          <button className="text-button danger" onClick={remove}>
            Delete
          </button>
          <button className="text-button" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      )}
      <Notice message={error} error />
      {!compact && (
        <>
          {post.replies.map((r) => (
            <Reply key={r.id} reply={r} />
          ))}
          {reply && <Composer parentId={post.id} onDone={() => setReply(false)} />}
        </>
      )}
    </article>
  );
}
function Reply({ reply: r }: { reply: Post }) {
  const { data, refresh } = useApp();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  if (edit) return <Composer initial={r} onDone={() => setEdit(false)} />;
  return (
    <div className="reply">
      <Avatar name={r.author} small />
      <div>
        <strong>{r.author}</strong>
        <small> · {dateLabel(r.createdAt)}</small>
        <p>{r.body}</p>
        <SongLink url={r.url} />
        {(r.authorId === data.profile?.id || data.profile?.admin) && (
          <div className="button-row">
            <button className="text-button" onClick={() => setEdit(true)}>
              Edit
            </button>
            <button
              className="text-button danger"
              onClick={async () => {
                if (!confirm) {
                  setConfirm(true);
                  return;
                }
                try {
                  await api(`posts/${r.id}`, 'DELETE');
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {confirm ? 'Confirm delete' : 'Delete'}
            </button>
          </div>
        )}
        <Notice message={error} error />
      </div>
    </div>
  );
}
