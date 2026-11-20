import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadedSongDetails, songDetails } from '../src/lib/song-metadata';

test('structured song metadata takes priority over video title and uploader', () => {
  assert.deepEqual(
    songDetails({
      track: 'Get Lucky',
      artist: 'Daft Punk',
      title: 'Some Channel - Different Title',
      channel: 'Uploader',
    }),
    { title: 'Get Lucky', artist: 'Daft Punk' },
  );
  assert.deepEqual(songDetails({ track: 'Song', artists: ['First', 'Second'] }), {
    title: 'Song',
    artist: 'First, Second',
  });
});
test('common YouTube titles suggest song/artist while retaining recording versions', () => {
  assert.deepEqual(
    songDetails({
      title: 'Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers',
    }),
    { title: 'Get Lucky', artist: 'Daft Punk' },
  );
  assert.deepEqual(songDetails({ title: 'Daft Punk - Get Lucky (Official Audio)' }), {
    title: 'Get Lucky',
    artist: 'Daft Punk',
  });
  assert.deepEqual(songDetails({ title: 'Artist – Song [Official Music Video] [HD]' }), {
    title: 'Song',
    artist: 'Artist',
  });
  assert.deepEqual(songDetails({ title: 'Artist - Song (Live) [Official Video]' }), {
    title: 'Song (Live)',
    artist: 'Artist',
  });
  assert.deepEqual(songDetails({ title: 'Song (Remix)', channel: 'Artist - Topic' }), {
    title: 'Song (Remix)',
    artist: 'Artist',
  });
  assert.deepEqual(songDetails({ title: 'Song', channel: 'Random uploader' }), {
    title: 'Song',
    artist: '',
  });
});
test('download metadata handles missing fields and progress output without failing the audio job', () => {
  assert.deepEqual(
    downloadedSongDetails('progress\n{"title":"Artist - Song","track":"NA","artist":null}\n'),
    { title: 'Song', artist: 'Artist' },
  );
  assert.deepEqual(downloadedSongDetails('unavailable'), { title: '', artist: '' });
  assert.deepEqual(songDetails(null), { title: '', artist: '' });
});
