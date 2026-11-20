# Needle Drop

A monthly music quiz and members-only listening room for a small community. Hosts create quizzes, choose short song excerpts, and grade answers. Players listen, submit their guesses, and see results after grading.

Built with Next.js/TypeScript, PostgreSQL, Supabase Auth/Storage, FFmpeg, yt-dlp, and Resend. The website and background worker can run locally, on Render, or through Docker on your own server.

## Features

- Private member accounts, assigned quiz hosts, and administrator tools.
- Audio uploads and YouTube links with start/end selection, previews, and 15/20/30-second presets.
- Optional Spotify playlist metadata import followed by reviewed YouTube matches.
- Song title, artist, connection, theme, and custom questions with configurable points.
- One correct answer per question. YouTube song and artist details are suggested automatically and remain editable.
- Saved player answers, submission deadlines, host-confirmed grading, and released results.
- Member discussions, email reminders, and a weekly digest.
- Private audio playback and automatic cleanup seven days after results release.

## Run the preview

Requires Node.js 24 and pnpm 11.25.0. For a regular Windows installation, install Node.js 24 from [nodejs.org](https://nodejs.org/en/download), including npm and PATH support, then reopen your terminal. Corepack is not required.

### Windows PowerShell

Install pnpm once:

```powershell
npm.cmd install --global pnpm@11.25.0
```

If Node was installed through fnm instead, initialize it in each new PowerShell window before running project commands:

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
fnm use 24
```

The first time, use `fnm install --use 24` if that version is not installed. After installing fnm with winget, close all terminal windows and reopen PowerShell so the new PATH takes effect.

Clone the repository if you do not already have the project locally:

```powershell
git clone https://github.com/ewalter5/NeedleDrop.git
cd NeedleDrop
```

If you already have Eric's original working folder, use it instead of cloning:

```powershell
cd "C:\Users\Eric\Documents\ChatGPT\music quiz website"
```

From the project folder (the one containing `package.json`), run:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev
```

Leave that window open and visit <http://localhost:3000>. Press Ctrl+C in the terminal to stop the server. The `.cmd` suffix avoids PowerShell script execution-policy issues.

### Other terminals

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Without service credentials, development mode shows clearly labeled sample data. Sample quiz answers save only in your browser; account creation, community writes, real clips, and the host studio require connected services. Production refuses unconfigured requests unless `ALLOW_DEMO=true` is explicitly set. The health check remains unhealthy without real services.

## Connect live services

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard). The Free plan can be used for development. This app uses a PostgreSQL connection for quiz data, so **Enable Data API** can remain unchecked; Auth and Storage use separate APIs. GitHub integration in Supabase is optional; this repository runs its own migrations. Copy `.env.example` to `.env.local` and fill its URL, anon/publishable-compatible key, service-role/secret key, and Postgres URL. Use the direct connection or **session pooler**, with TLS and a trusted certificate. Do not disable certificate verification. Set `PG_CA_FILE` if your environment needs the provider's CA certificate.
2. Enable email/password signups and **email confirmation** in Supabase Auth. Set Site URL to `APP_URL` and allow `${APP_URL}/auth/callback` and `${APP_URL}/auth/callback?next=/account/reset` redirect URLs. For local development use the exact same origin, including hostname, everywhere.
3. Configure Supabase Auth's custom SMTP with your verified email provider so verification/reset messages reach real users. The app uses Supabase's server-side PKCE cookie flow. For cross-device verification, use email templates linking to `${APP_URL}/auth/callback?token_hash={{ .TokenHash }}&type=email`; the recovery template uses `type=recovery`. Keep Supabase's existing template variables as literal template expressions.
4. Verify a sending domain in Resend, including its required DNS records. Set `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_URL`. Generate a random `UNSUBSCRIBE_SECRET` of at least 32 characters and share the same value between web and jobs. Never paste secrets into Git or client-side code.
5. Run `pnpm migrate`. This creates the schema and the **private** `quiz-audio` storage bucket. If changing `STORAGE_BUCKET`, create an equivalent private bucket yourself. Do not add browser access policies for original uploads or app database tables.
6. Install FFmpeg and FFprobe locally or use Docker (both are included). For YouTube import/search, also install yt-dlp as described below. Run `pnpm jobs` once to check job execution, then schedule it every five minutes. Render and Compose examples are included. Nothing depends on your personal computer staying on after deployment.
7. Register and verify the initial host's account, then run `pnpm admin your-email@example.com` with that signup email. This is the intentional administrative bootstrap; users cannot promote themselves through signup metadata or the API.
8. In **Host studio**, create a draft, add rules/clips/questions/answer keys, save, upload audio, and refresh after processing. Schedule only when all clips are ready. Admins create drafts and assign members as guest hosts; guests build/publish/grade their assigned drafts.

On Windows, use `pnpm.cmd` in place of `pnpm` in these commands. Restart the development server after editing `.env.local`. All scripts load that file from the project folder.

### Environment settings

If `.env.local` does not exist, create it from the template with `Copy-Item .env.example .env.local` in PowerShell. Keep an existing `.env.local` instead of overwriting it. Open the file in your editor and replace placeholders with your own values.

| Variable                                                              | Purpose                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                            | Supabase project URL                                                                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                       | Publishable key or legacy anon key                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                           | Server-only secret key or legacy service-role key                                                              |
| `DATABASE_URL`                                                        | PostgreSQL connection string from Supabase's Connect dialog; use session pooling if direct IPv6 is unavailable |
| `APP_URL`                                                             | `http://localhost:3000` locally; the public HTTPS origin when deployed                                         |
| `RESEND_API_KEY`, `EMAIL_FROM`                                        | Quiz email delivery through your verified sender                                                               |
| `UNSUBSCRIBE_SECRET`                                                  | Random secret of at least 32 characters, shared by web and worker                                              |
| `STORAGE_BUCKET`                                                      | Private bucket name; defaults to `quiz-audio`                                                                  |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH`                           | Optional executable path overrides; see `.env.example`                                                         |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` | Optional Spotify playlist access; see import setup below                                                       |

Generate an unsubscribe secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the printed value as `UNSUBSCRIBE_SECRET`. The `.gitignore` excludes `.env.local`, dependency folders, build output, logs, and backups. Only the blank `.env.example` belongs in Git. Enter deployment secrets through the hosting provider's environment settings.

### Test an audio upload

After configuring Supabase, running migrations, and granting your verified account administrator access:

1. Check `ffmpeg -version` and `ffprobe -version` in a terminal. Both must work on the machine running jobs.
2. Start the website with `pnpm.cmd dev` and sign in.
3. Open **Host studio**, create a quiz, and add a clip.
4. Choose an MP3 under 25 MB. Set Start to 10 and End to 30 seconds, preview it, then click **Upload excerpt**.
5. In a second terminal, enter the same project folder and run `pnpm.cmd jobs`. Initialize fnm in that window too if needed.
6. Refresh the quiz. The status should become **Processed and ready**. Confirm playback contains approximately 20 seconds beginning 10 seconds into the original file.

To test YouTube, verify `yt-dlp --version`, choose **YouTube video link**, paste a recording you can download and reuse, select the range, and click **Import YouTube excerpt**. Run the jobs command and refresh again. Spotify credentials are not needed for direct YouTube links or manual song searches. If processing fails, inspect the clip status and **Host studio → Background jobs**.

## Behavior

- New verified members are enrolled in monthly quizzes and the weekly digest, disclosed during signup. Preferences are independent. Unsubscribing from monthly emails does not prevent playing quizzes.
- Hosts set times in an IANA timezone; timestamps are stored in UTC. The default is Saturday 9 a.m. through Wednesday 11:59 p.m. Eastern. Question structure/audio lock at scheduling; upcoming/open deadlines remain editable. Closed quizzes cannot reopen in v1.
- Answers autosave after a short pause, with explicit saved/error status and a device recovery copy. A version check prevents silently overwriting another tab. Only explicit submissions count; submitted entries can still be revised until closure. Blanks are allowed. Recovery copies are scoped to user and quiz on that browser.
- After closure, all submitted fields need an explicit host score, including suggested exact matches. Theme, connection, and custom fields always require manual grading. Once every submitted entry is confirmed, release is automatic. An empty quiz needs explicit admin closure. Later score corrections are audited.
- Matching title/artist answers have full credit prefilled against the single correct answer, ignoring case, accents, spacing, and punctuation. Other answers need manual scoring. Hosts confirm each entry; there are no accepted-alternative lists or fuzzy-match suggestions. Legacy alternatives are ignored.
- All verified, unrestricted members can see released answers, display names, field grades, feedback, and submitted guesses. Emails, drafts, private keys, storage paths, and original filenames are excluded from player responses.
- Community supports text, HTTP(S) song links, and one level of replies. Authors/admins can edit/delete; admins can restrict accounts. No community audio uploads. The feed shows the latest 50 conversations and their replies; weekly digests cover all new top-level posts in their weekly window.
- Reminders are due 48, 36, and 24 hours before closure, processed within the next five-minute job cycle. Delivery rechecks enrollment, restriction, and submission status. Each threshold has one durable delivery key even if deadlines change. A reminder missed by more than an hour is skipped rather than sending obsolete reminders together.
- The digest defaults to Friday noon Eastern, configurable in the studio. Fixed local-time weekly windows account for daylight saving. Empty digests are skipped. Replies remain on the website.
- Audio uploads are limited to 25 MB each. FFmpeg writes a fresh 128 kbps MP3 containing only the first audio stream, without artwork, chapters, ID3 tags, or original filenames. Originals and replacements enter durable cleanup jobs. Only opaque processed objects receive two-minute signed playback URLs.
- Seven days after release, the next job cycle revokes audio access and deletes clips. Written quiz records and community discussions stay. Failed deletion jobs keep retrying; audio conversion/email jobs stop after five attempts and show in the admin job list.

## Playlist imports and excerpt selection

In a draft quiz, **Import songs** reads a Spotify playlist's titles and artists. Choose **Find YouTube matches**, review a recording, and add it as a clip. Playlist metadata fills the title and artist answer keys; verify them before publishing. You can also search by song/artist or paste a YouTube video link directly into a clip. Hosts select start/end times and submit the excerpt for background processing. YouTube imports use audio playback after processing; there is no embedded video player. Refresh the quiz and use **Play clip** once processing finishes. To change the excerpt, adjust the times and import again. The default is 20 seconds, with 15/20/30-second presets and a 60-second maximum. File uploads also support local audio preview and scrubbing before upload.

YouTube search selections suggest the song and artist immediately, preferring music metadata and falling back to common `Artist - Song` titles. For directly pasted links, the background worker fills blank title/artist answers from download metadata; refresh after processing. Existing answers and host corrections are preserved. These are suggestions, so verify the correct answers before publishing. Uploaded local audio files still use manually entered answers.

Songs already present in a quiz show **Already added** in search results. The editor checks the video URL and matching song/artist answers, and blocks repeated clicks. Spotify imports skip repeated track IDs. The server reuses an existing processing request for the same clip, YouTube URL and time range, and blocks adding the same active YouTube recording to another clip in that quiz. Changing an existing clip's range still creates a new excerpt; failed imports can be retried. These checks also apply after a saved import is reloaded. Existing duplicate clips are retained: use **Remove clip**, then save the draft to clean them up.

Credentials are a one-time server setup. Hosts never enter tokens or sign into Spotify in the editor. Spotify's current development-mode rules require the app owner to have Premium, and playlist items are accessible only when the authorized user owns or collaborates on that playlist. Public visibility alone does not grant API access. Players listening to the quiz do not need Spotify accounts or Premium. The API reads at most 30 available tracks, skipping local files and episodes.

To configure Spotify locally:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app that uses **Web API**.
2. Register the exact redirect URI `http://127.0.0.1:8888/callback`. Spotify does not accept `localhost` as a redirect URI. This address is only for the one-time setup helper, not the website's Supabase login.
3. Copy the app's Client ID and Client Secret into `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env.local`.
4. From the project folder, run `pnpm.cmd spotify:auth` on Windows (`pnpm spotify:auth` elsewhere).
5. Open the authorization URL printed in the terminal. Sign in with the Spotify account that owns or collaborates on the quiz playlists, and approve playlist-read access. If using a separate account in development mode, add it to the app's allowed users first.
6. The helper saves `SPOTIFY_REFRESH_TOKEN` to `.env.local` without printing the token. Restart the website, paste a playlist link in **Import songs**, and click **Read playlist**.

The helper listens only on `127.0.0.1:8888`, validates OAuth state, requests read-only playlist scopes, and times out after five minutes. If port 8888 is in use, close the service using it before retrying. Refresh tokens can expire or be revoked; rerun the helper when account authorization needs renewing. For deployment, copy all three Spotify variables privately into the web service's environment settings. The server refreshes access tokens; no secrets reach the browser. Import failures explain account restrictions, and manual YouTube search/direct links remain available.

Install `yt-dlp[default]` with Python/pip, FFmpeg and FFprobe on the job server, and yt-dlp on the web server for searches. Node 24 supplies yt-dlp's JavaScript runtime. Docker includes these tools. `YTDLP_PATH`, `FFMPEG_PATH`, and optional `FFPROBE_PATH` allow executable overrides. Rebuild the Docker image periodically to update yt-dlp as YouTube changes. Never supply browser cookies or login credentials to this feature.

YouTube import requests only the selected section, converts it into a fresh anonymous MP3, checks its duration, and uses the existing private storage, authenticated playback and seven-day retention. Downloads have time and size limits. Unavailable, restricted, or bot-blocked videos can fail; choose another recording or upload a file. Processing is asynchronous: save the draft and refresh after the next five-minute worker cycle. Failed processing appears in the clip status and admin jobs list. Source URLs and selected ranges live in server-only job payloads; source filenames/tags and answer keys are never included in player playback responses.

Use recordings you are authorized to download and reuse. Short excerpts do not automatically grant permission. Review [Spotify's developer policy](https://developer.spotify.com/policy) and [YouTube's terms](https://www.youtube.com/static?template=terms) before deploying this integration; Spotify restricts quiz uses and YouTube restricts downloading/extracting audio. The Spotify connection reads metadata, not audio; it does not remove these platform restrictions.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

The test suite uses an isolated embedded Postgres engine, not your production database. It exercises the real migration and repository SQL for the full quiz lifecycle, guest permissions, private projections, draft exclusion, version conflicts, deadline enforcement, grading suggestions and release, audit history, post ownership, reply depth, database-role isolation, reminder deduplication and delivery rechecks, unsubscribe signatures, DST schedules, audio retention, and a database snapshot restore.

The development environment may require permission to run `tsx` outside its restricted Windows process sandbox. This is a test-runner profile lookup limitation; do not alter application authorization to work around it.

## Render deployment

Push this repository to your Git provider and create a Render Blueprint using `render.yaml`. It defines a Docker web service and a five-minute cron job sharing one environment group. Fill all environment values and set `APP_URL` to your final HTTPS domain. The web service runs migrations before deployment and checks `/api/health`. No persistent Render filesystem is used; durable data resides in Postgres/Storage.

Enable external monitoring for `/api/health` and job failures. The health route checks database/schema readiness and required service configuration, not delivery to an actual inbox. Before inviting players, complete a real signup/reset, tagged-audio upload/playback, test email, guest-host run, complete quiz, and backup restore in a separate staging environment. Docker/FFmpeg and real Supabase/Resend delivery need verification with your service accounts.

The build reads no secrets and uses no build-time public SDK credentials; runtime configuration is sufficient. Keep `ALLOW_DEMO` unset/false on the real site.

## Your server later

```sh
docker compose build
docker compose run --rm web node node_modules/tsx/dist/cli.mjs scripts/migrate.ts
docker compose up -d
```

Place HTTPS termination (for example Caddy) in front of port 3000, set `APP_URL` to that public origin, and restrict direct database access. The Compose jobs container runs the same durable five-minute scheduler. Keep Supabase Auth/Storage and Resend initially; moving the app and scheduler alone avoids disrupting account sessions. Plain Postgres data and storage/email adapters allow later migrations, but replacing Supabase Auth requires an explicit account/session migration. Migration does not require moving everything at once.

## Backups, restoration, and operations

- Use managed encrypted daily backups and retain copies off the application server. `scripts/backup.sh` runs `pg_dump` using `DATABASE_URL`; set an appropriately privileged backup URL when exporting auth records. Dumps contain personal data and must stay private. The default script writes under ignored `backups/` with restrictive filesystem permissions.
- `scripts/restore-check.sh path/to/backup.dump` restores into `RESTORE_DATABASE_URL`, which must be a **new, empty isolated database**. It never drops existing objects. For full Supabase backups, restore into a separate compatible Supabase/local stack with its extensions and managed roles already available; follow the provider's restore procedure for auth/storage schemas.
- Verify quiz/submission/grade counts, sample result totals, auth identities, and foreign keys before switching traffic. Run a real production-format `pg_dump`/`pg_restore` drill before launch; the automated embedded-engine restore test is additional coverage.
- Live audio is temporary and deliberately excluded from long-term archives. Do not create permanent object versions/backups of audio. Monitor Storage cleanup; original/processed data can persist during a storage outage until retries succeed. Previously downloaded files cannot be recalled from a player's device.
- Check **Host studio → Background jobs** after an upload or delivery failure. To retry a failed conversion, upload the source again. For failed email deliveries, inspect the provider log first: the provider's idempotency window is 24 hours. Do not blindly requeue an ambiguous email outside that window. Deletion jobs retry indefinitely and need no manual reset.
- Keep `APP_URL`, timezone configuration, and the unsubscribe secret consistent across services. Rotating the unsubscribe secret invalidates old unsubscribe links, so retain the old value until you intentionally replace them.

## API map

All API responses are private/no-store. Writes require the configured same origin, bounded request sizes, and server authentication/authorization except signup/signin/reset and signed unsubscribe.

| Route                                                                                    | Purpose                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/bootstrap`                                                                     | Session-safe navigation, quiz summaries, member feed |
| `POST /api/auth/{signup,signin,signout,reset,password}`                                  | Supabase-backed account actions                      |
| `PATCH /api/profile`                                                                     | Display name and independent subscriptions           |
| `GET /api/quizzes/:id`, `PUT .../submission`                                             | Safe quiz projection and versioned answers           |
| `POST /api/quizzes`                                                                      | Admin creates an assignable draft                    |
| `GET/PUT /api/host/:id`                                                                  | Assigned-host private workspace                      |
| `POST .../publish`, `PATCH .../deadline`, `PUT .../grades/:submission`, `POST .../close` | Scheduling, grading, explicit empty closure          |
| `PUT /api/host/:id/hosts`                                                                | Admin-only guest assignments                         |
| `POST/GET /api/clips/:id`                                                                | Authorized upload / temporary processed playback     |
| `GET /api/results/:id`                                                                   | Released scores and guesses, signed-in members only  |
| `POST/PATCH/DELETE /api/posts[/id]`                                                      | Member discussions and ownership checks              |
| `/api/admin/{users,settings,jobs}`                                                       | Moderation, digest schedule, job status              |
| `POST /api/unsubscribe`                                                                  | HMAC-bound user/channel preference change            |
| `GET /api/health`                                                                        | Deployment readiness without private data            |

Deploying accounts, configuring DNS, and connecting billable hosting require your service access. No services have been provisioned and no emails are sent by the preview or tests.
