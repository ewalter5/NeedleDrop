# NeedleDrop handoff — November 20, 2026

## Current deployment

- Repository: https://github.com/ewalter5/NeedleDrop (main).
- Live website: https://needle-drop-xd1i.onrender.com
- One Free Render Docker web service in My Workspace; no paid worker or disk.
- Render service: srv-dc08ocom7kps73d93200. Blueprint: exs-dc08940n74is73a4v6hg.
- Supabase existing project: luvpypdggciojaotiuec. Database and private audio storage are shared between hosted web and local worker.
- Latest deployed application commit: 63e0519. CI passed 38 tests, Docker build, typecheck, and audio tool checks. Hosted homepage and /api/health returned 200.

## Local worker and secrets

- Original Windows folder: C:\Users\Eric\Documents\ChatGPT\music quiz website
- Scheduled task `NeedleDrop local worker` runs every five minutes while the original PC is awake and signed in. PowerShell does not need to stay open. Worker logs are in ignored logs/worker.log. Recent cycles succeeded.
- Scripts: scripts/install-worker.ps1, scripts/run-worker.ps1, scripts/jobs.ts. See README for setup.
- .env.local is intentionally excluded from Git. Transfer it privately if needed; never commit or print secrets. A clone alone does not include credentials or install the scheduled task.
- WORKER_APP_URL points to the live Render URL; APP_URL remains localhost for local development.
- WORKER_SEND_EMAILS=false. Keep disabled until queued email jobs have been reviewed, to avoid sending old test notifications. Do not send emails to others without user authorization.
- If moving the worker, coordinate with the original PC; avoid accidentally installing duplicate scheduled tasks or enabling email on both computers.

## Email setup status

- Sender: needledroppermusicquiz@gmail.com.
- Google 2-Step Verification enabled; app password saved privately in .env.local. Nodemailer SMTP authentication against smtp.gmail.com:465 verified without sending a message.
- User configured Supabase custom SMTP and hosted Site URL/callback allowlist. User successfully tested signup and confirmation on the live website; email landed in spam.
- Signup emails are sent by Supabase independently of the local notification worker. Marking messages Not spam helps that recipient; delivery for other users remains unverified.

## Immediate unresolved issue

- Hosted YouTube song search is slow and fails with: `YouTube search failed. Check yt-dlp installation or paste a video link directly.`
- No fix has been written or deployed yet. Working tree was clean before this handoff.
- src/server/sources.ts searchYoutube uses yt-dlp ytsearch3, --dump-single-json, --skip-download, but fully extracts each video. Timeout is 60 seconds. Raw error is swallowed, and current Render logs show no useful search diagnostics.
- Candidate improvement: use documented --flat-playlist to obtain search metadata without extracting video formats; consider sanitized failure classification/logging. This is a hypothesis, not a verified root cause. Cloud YouTube restrictions may also matter.
- Docker installs yt-dlp[default] into /opt/yt-dlp and sets YTDLP_PATH. Search runs on Render, whereas actual audio download/processing runs on the local PC.
- Spotify playlist metadata uses Spotify API but audio still comes from YouTube. Switching to Spotify does not eliminate YouTube extraction for clips.
- Direct YouTube links bypass search and can be tried as a workaround; hosted end-to-end clip import still needs verification.

## Product status / next validation

- Audio-only previews, excerpt selection, Spotify playlist import, duplicate prevention, song/artist autofill, single correct answers, manual grading all worked in local testing.
- Next live test: host creates quiz, imports clip, waits for local worker, plays clip, publishes, test player answers, host grades and checks results on phone.
- Follow AGENTS.md: read relevant node_modules/next/dist/docs before editing code. Do not weaken auth or expose service keys. Render auto-deploy waits for GitHub CI.

Suggested prompt for a new Codex session: Read AGENTS.md, README.md, and HANDOFF.md. Continue diagnosing hosted YouTube search failure, implement and test the fix, push it, and verify Render deployment. Keep notification emails disabled until explicitly authorized.
