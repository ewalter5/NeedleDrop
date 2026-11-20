export type QuizState = 'draft' | 'scheduled' | 'open' | 'grading' | 'released';
export type FieldKind = 'title' | 'artist' | 'connection' | 'custom' | 'theme';
export type Field = {
  id: string;
  clipId: string | null;
  label: string;
  kind: FieldKind;
  maxPoints: number;
  position: number;
};
export type Clip = { id: string; position: number; ready: boolean };
export type Quiz = {
  id: string;
  title: string;
  description: string;
  rules: string;
  releaseAt: string;
  deadline: string;
  timezone: string;
  state: QuizState;
  releasedAt: string | null;
  hostName: string;
  clipCount: number;
  maxPoints: number;
  fields?: Field[];
  clips?: Clip[];
};
export type Profile = {
  id: string;
  displayName: string;
  admin: boolean;
  quizEnrolled: boolean;
  digestSubscribed: boolean;
  restricted: boolean;
};
export type Post = {
  id: string;
  authorId: string;
  author: string;
  body: string;
  url: string;
  createdAt: string;
  parentId: string | null;
  replies: Post[];
};
export type Submission = {
  id: string;
  userId: string;
  displayName?: string;
  submittedAt: string | null;
  reviewed: boolean;
  answers: Record<string, string>;
  grades: Record<string, { points: number; feedback: string }>;
};
export type Result = {
  quiz: Quiz;
  fields: (Field & { answer: string })[];
  submissions: Submission[];
};
export type Bootstrap = {
  demo: boolean;
  configured: boolean;
  profile: Profile | null;
  quizzes: Quiz[];
  posts: Post[];
  canHost: boolean;
  managedQuizIds?: string[];
  settings: { digestDay: number; digestHour: number; timezone: string };
};
