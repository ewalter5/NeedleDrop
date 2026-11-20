import type { Bootstrap, Quiz, Field, Result } from './types';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fields: Field[] = Array.from({ length: 12 }, (_, i) => [
  {
    id: id(100 + i * 3),
    clipId: id(10 + i),
    label: 'Song title',
    kind: 'title' as const,
    maxPoints: 1,
    position: i * 3,
  },
  {
    id: id(101 + i * 3),
    clipId: id(10 + i),
    label: 'Artist',
    kind: 'artist' as const,
    maxPoints: 1,
    position: i * 3 + 1,
  },
  {
    id: id(102 + i * 3),
    clipId: id(10 + i),
    label: 'How does it fit the theme?',
    kind: 'connection' as const,
    maxPoints: 1,
    position: i * 3 + 2,
  },
]).flat();
fields.push({
  id: id(200),
  clipId: null,
  label: 'What connects all the songs?',
  kind: 'theme',
  maxPoints: 4,
  position: 100,
});
export const demoQuiz: Quiz = {
  id: id(1),
  title: 'A change of scenery',
  description: 'Twelve songs. One thread. Find your way from the first note to the bigger picture.',
  rules:
    'Name the song and artist for each clip, then tell us how it connects to the theme.\n\nOne point for each title, artist, and connection. Four bonus points for the overall theme. Please play by ear: no music recognition apps.\n\nYou can listen as often as you like and change your answers until the deadline.',
  releaseAt: '2026-11-07T14:00:00Z',
  deadline: '2099-11-12T04:59:00Z',
  timezone: 'America/New_York',
  state: 'open',
  releasedAt: null,
  hostName: 'The quizmaster',
  clipCount: 12,
  maxPoints: 40,
  fields,
  clips: Array.from({ length: 12 }, (_, i) => ({ id: id(10 + i), position: i + 1, ready: false })),
};
export const pastQuiz: Quiz = {
  ...demoQuiz,
  id: id(2),
  title: 'Written in the stars',
  description: 'A little cosmic connection.',
  state: 'released',
  releaseAt: '2026-10-03T13:00:00Z',
  deadline: '2026-10-08T03:59:00Z',
  releasedAt: '2026-10-10T13:00:00Z',
  clipCount: 10,
  maxPoints: 34,
  fields: undefined,
  clips: undefined,
};
export const demoData: Bootstrap = {
  demo: true,
  configured: false,
  profile: {
    id: id(999),
    displayName: 'Alex',
    admin: true,
    restricted: false,
    quizEnrolled: true,
    digestSubscribed: true,
  },
  quizzes: [demoQuiz, pastQuiz],
  canHost: true,
  settings: { digestDay: 5, digestHour: 12, timezone: 'America/New_York' },
  posts: [
    {
      id: id(500),
      authorId: id(510),
      author: 'Sarah M.',
      body: 'A little something for your Sunday morning. I keep coming back to this one — that bass line never gets old.',
      url: 'https://www.youtube.com/results?search_query=Fleetwood+Mac+Dreams',
      createdAt: '2026-11-08T15:30:00Z',
      parentId: null,
      replies: [
        {
          id: id(501),
          authorId: id(511),
          author: 'David R.',
          body: 'An entire album with no skips. Great pick.',
          url: '',
          createdAt: '2026-11-08T17:00:00Z',
          parentId: id(500),
          replies: [],
        },
      ],
    },
    {
      id: id(502),
      authorId: id(512),
      author: 'Michael T.',
      body: 'Anyone else go down a rabbit hole after last month’s quiz? This is where I ended up. Headphones recommended.',
      url: 'https://open.spotify.com/search/Khruangbin',
      createdAt: '2026-11-07T19:00:00Z',
      parentId: null,
      replies: [],
    },
  ],
};
const pastSongs = [
  ['Space Oddity', 'David Bowie', 'Space travel'],
  ['Rocket Man', 'Elton John', 'An astronaut'],
  ['Fly Me to the Moon', 'Frank Sinatra', 'The Moon'],
  ['Walking on the Moon', 'The Police', 'The Moon'],
  ['Man on the Moon', 'R.E.M.', 'The Moon in the title'],
  ['Starman', 'David Bowie', 'A visitor from the stars'],
  ['Across the Universe', 'The Beatles', 'The universe'],
  ['Drops of Jupiter', 'Train', 'A planet'],
  ['Venus', 'Shocking Blue', 'A planet in the title'],
  ['Supermassive Black Hole', 'Muse', 'A black hole'],
];
const pastFields: Result['fields'] = pastSongs.flatMap((song, i) =>
  (['title', 'artist', 'connection'] as const).map((kind, j) => ({
    id: id(300 + i * 3 + j),
    clipId: id(30 + i),
    label: ['Song title', 'Artist', 'Theme connection'][j],
    kind,
    maxPoints: 1,
    position: i * 3 + j,
    answer: song[j],
  })),
);
pastFields.push({
  id: id(400),
  clipId: null,
  label: 'Overall theme',
  kind: 'theme',
  maxPoints: 4,
  position: 31,
  answer: 'Space and celestial objects',
});
export const demoResults: Result = {
  quiz: {
    ...pastQuiz,
    clips: pastSongs.map((_, i) => ({ id: id(30 + i), position: i + 1, ready: false })),
  },
  fields: pastFields,
  submissions: ['Sarah M.', 'David R.', 'Alex', 'Michael T.'].map((displayName, i) => ({
    id: id(600 + i),
    userId: id(700 + i),
    displayName,
    submittedAt: '2026-10-07T12:00:00Z',
    reviewed: true,
    answers: Object.fromEntries(
      pastFields.map((field, j) => [
        field.id,
        i > 0 && j % (7 - i) === 0 ? 'Not sure' : field.answer,
      ]),
    ),
    grades: Object.fromEntries(
      pastFields.map((field, j) => [
        field.id,
        { points: i > 0 && j % (7 - i) === 0 ? 0 : field.maxPoints, feedback: '' },
      ]),
    ),
  })),
};
