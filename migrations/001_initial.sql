CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
 admin boolean NOT NULL DEFAULT false, restricted boolean NOT NULL DEFAULT false,
 quiz_enrolled boolean NOT NULL DEFAULT true, digest_subscribed boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), digest_day integer NOT NULL DEFAULT 5 CHECK(digest_day BETWEEN 0 AND 6),
 digest_hour integer NOT NULL DEFAULT 12 CHECK(digest_hour BETWEEN 0 AND 23), timezone text NOT NULL DEFAULT 'America/New_York'
);
INSERT INTO settings(id) VALUES(true);
CREATE TABLE quizzes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text NOT NULL DEFAULT '', rules text NOT NULL DEFAULT '',
 release_at timestamptz NOT NULL, deadline timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'America/New_York',
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','scheduled','open','grading','released')),
 released_at timestamptz, created_by uuid NOT NULL REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(deadline > release_at)
);
CREATE TABLE quiz_hosts (
 quiz_id uuid REFERENCES quizzes(id) ON DELETE CASCADE, user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
 PRIMARY KEY(quiz_id,user_id)
);
CREATE TABLE clips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position > 0), storage_key text, audio_status text NOT NULL DEFAULT 'missing' CHECK(audio_status IN ('missing','processing','ready','failed','deleted')),
 UNIQUE(quiz_id,position)
);
CREATE TABLE answer_fields (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
 clip_id uuid REFERENCES clips(id) ON DELETE CASCADE, label text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('title','artist','connection','custom','theme')),
 max_points numeric(7,2) NOT NULL CHECK(max_points > 0 AND max_points <= 1000), position integer NOT NULL DEFAULT 0
);
CREATE TABLE answer_keys (
 field_id uuid PRIMARY KEY REFERENCES answer_fields(id) ON DELETE CASCADE,
 answer text NOT NULL DEFAULT '', alternatives jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(alternatives)='array')
);
CREATE TABLE submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quiz_id uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES profiles(id), answers jsonb NOT NULL DEFAULT '{}', submitted_at timestamptz,
 reviewed boolean NOT NULL DEFAULT false, reviewed_by uuid REFERENCES profiles(id), updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 0, UNIQUE(quiz_id,user_id)
);
CREATE TABLE grades (
 submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE, field_id uuid REFERENCES answer_fields(id),
 points numeric(7,2) NOT NULL CHECK(points >= 0), feedback text NOT NULL DEFAULT '', PRIMARY KEY(submission_id,field_id)
);
CREATE TABLE grade_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES submissions(id),
 actor_id uuid NOT NULL REFERENCES profiles(id), previous jsonb NOT NULL, replacement jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE posts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES profiles(id),
 parent_id uuid REFERENCES posts(id) ON DELETE CASCADE, body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
 url text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, dedupe_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL DEFAULT '{}', due_at timestamptz NOT NULL DEFAULT now(), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','working','done','failed')),
 attempts integer NOT NULL DEFAULT 0, locked_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX jobs_due ON jobs(state,due_at);
CREATE INDEX submissions_quiz ON submissions(quiz_id);
CREATE INDEX posts_date ON posts(created_at);
CREATE INDEX clips_quiz ON clips(quiz_id);
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL);
-- All application data is server-only. Browser JWTs have no direct table access.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','settings','quizzes','quiz_hosts','clips','answer_fields','answer_keys','submissions','grades','grade_audit','posts','jobs','rate_limits'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t);
 END LOOP;
END $$;
-- Supabase Storage is optional in a restored/self-hosted database.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('quiz-audio','quiz-audio',false,26214400,ARRAY['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/flac','audio/ogg','application/octet-stream'])
  ON CONFLICT(id) DO UPDATE SET public=false;
 END IF;
END $$;
