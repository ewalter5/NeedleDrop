import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingSong } from '../src/lib/clip-sources';

test('duplicate detection recognizes YouTube URL variants without relying on song answers', () => {
  const clip = { id: 'first', position: 1, sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=20' };
  assert.equal(
    findExistingSong([clip], [], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      title: '',
      artist: '',
    }),
    clip,
  );
});
test('duplicate detection recognizes the same song from a different recording but allows other songs/artists', () => {
  const clip = { id: 'first', position: 1 };
  const fields = [
    { clipId: 'first', kind: 'title', answer: 'Song!' },
    { clipId: 'first', kind: 'artist', answer: 'Beyoncé' },
  ];
  assert.equal(findExistingSong([clip], fields, '', { title: 'song', artist: 'beyonce' }), clip);
  assert.equal(
    findExistingSong([clip], fields, '', { title: 'Other song', artist: 'beyonce' }),
    undefined,
  );
  assert.equal(
    findExistingSong([clip], fields, '', { title: 'Song', artist: 'Another artist' }),
    undefined,
  );
  assert.equal(findExistingSong([clip], fields, '', { title: '', artist: '' }), undefined);
  assert.equal(findExistingSong([], fields, '', { title: 'Song', artist: 'beyonce' }), undefined);
});
