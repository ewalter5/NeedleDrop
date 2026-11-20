'use client';
import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Headphones,
  LayoutGrid,
  Disc3,
  Trophy,
  MessagesSquare,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Music2,
  Clock3,
  Mail,
  Shield,
  Menu,
  X,
  LogOut,
  Radio,
} from 'lucide-react';
import type { Bootstrap, Quiz } from '@/lib/types';
import { api, Avatar, dateLabel, Loading, Notice } from './shared';
import { QuizPage, ResultsPage } from './quiz';
import { Community, PostCard } from './community';
import { Account, AuthPage, UnsubscribePage } from './account';
import { HostPage } from './host';
type AppContext = { data: Bootstrap; refresh: () => Promise<void> };
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const c = useContext(Context);
  if (!c) throw new Error('App context missing');
  return c;
}
export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const refresh = useCallback(async () => {
    const result = await api<Bootstrap>('bootstrap');
    setData(result);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    setMenu(false);
  }, [path]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const sync = () => setMobile(media.matches);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    sync();
    media.addEventListener('change', sync);
    window.addEventListener('keydown', escape);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  if (error)
    return (
      <main className="standalone">
        <Disc3 size={42} />
        <h1>A skipped beat.</h1>
        <Notice message={error} error />
        <button
          onClick={() => {
            setError('');
            refresh().catch((e) => setError(e.message));
          }}
        >
          Try again
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="standalone">
        <Loading />
      </main>
    );
  const active =
    data.quizzes.find((q) => q.state === 'open') ||
    data.quizzes.find((q) => q.state === 'scheduled');
  const links = [
    { href: '/', label: 'Overview', icon: LayoutGrid },
    { href: active ? `/quiz/${active.id}` : '/quizzes', label: 'The monthly quiz', icon: Disc3 },
    { href: '/results', label: 'Past results', icon: Trophy },
    { href: '/community', label: 'Listening room', icon: MessagesSquare },
  ];
  const authView = path === '/login' || path === '/signup' || path === '/forgot-password';
  let page: React.ReactNode;
  if (path === '/unsubscribe') page = <UnsubscribePage />;
  else if (authView) page = <AuthPage />;
  else if (!data.profile) page = <Welcome />;
  else if (data.profile.restricted)
    page = (
      <Notice
        message="Your account has been restricted. Please contact the quiz administrator."
        error
      />
    );
  else if (path.startsWith('/quiz/')) page = <QuizPage id={path.split('/')[2]} />;
  else if (path.startsWith('/results/')) page = <ResultsPage id={path.split('/')[2]} />;
  else if (path === '/results') page = <QuizArchive results />;
  else if (path === '/quizzes') page = <QuizArchive />;
  else if (path === '/community') page = <Community />;
  else if (path.startsWith('/account')) page = <Account reset={path.endsWith('/reset')} />;
  else if (path.startsWith('/host'))
    page = data.canHost ? (
      <HostPage id={path.split('/')[2]} />
    ) : (
      <Notice message="Host access is required." error />
    );
  else if (path === '/') page = <Dashboard />;
  else
    page = (
      <div className="empty">
        <h1>Nothing on this track.</h1>
        <Link href="/">Back to the overview</Link>
      </div>
    );
  return (
    <Context.Provider value={{ data, refresh }}>
      <div className="shell">
        <button
          className="mobile-toggle icon-button"
          aria-label={menu ? 'Close navigation' : 'Open navigation'}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
        <aside
          className={`sidebar ${menu ? 'shown' : ''}`}
          inert={mobile && !menu}
          aria-hidden={mobile && !menu}
        >
          <Link href="/" className="brand">
            <span className="brand-icon">
              <Disc3 size={27} />
            </span>
            <span>
              needle drop<span className="brand-period">.</span>
              <small>A GOOD KIND OF RECORD</small>
            </span>
          </Link>
          <div className="nav-label">YOUR CORNER OF MUSIC</div>
          <nav>
            {links.map((l) => {
              const activeLink =
                l.href === '/'
                  ? path === '/'
                  : path.startsWith(l.href.split('/').slice(0, 2).join('/'));
              return (
                <Link key={l.label} href={l.href} className={activeLink ? 'active' : ''}>
                  <l.icon size={19} />
                  <span>{l.label}</span>
                  {l.label === 'The monthly quiz' && active?.state === 'open' && (
                    <i className="nav-dot" />
                  )}
                </Link>
              );
            })}
          </nav>
          {data.canHost && (
            <>
              <div className="nav-label host-label">BEHIND THE SCENES</div>
              <nav>
                <Link href="/host" className={path.startsWith('/host') ? 'active' : ''}>
                  <Shield size={19} />
                  Host studio
                </Link>
              </nav>
            </>
          )}
          <div className="sidebar-note">
            <Radio size={23} />
            <p>
              Good music is
              <br />
              better together.
            </p>
            <span>
              A few familiar faces.
              <br />A few unexpected songs.
            </span>
          </div>
          <div className="sidebar-bottom">
            <Link href="/account" className="account-link">
              <Avatar name={data.profile?.displayName || 'Music lover'} />
              <span>
                {data.profile?.displayName || 'Welcome'}
                <small>{data.profile?.admin ? 'Quiz administrator' : 'Music enthusiast'}</small>
              </span>
              <Settings size={17} />
            </Link>
            {!data.demo && data.profile && (
              <button
                className="text-button signout"
                onClick={async () => {
                  await api('auth/signout', 'POST', {});
                  await refresh();
                  router.push('/login');
                }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            )}
          </div>
        </aside>
        <div className="main-wrap" inert={mobile && menu}>
          <header className="topbar">
            <span>
              <Headphones size={16} /> A little music. A little mystery.
            </span>
            <div>
              {data.demo ? (
                <span className="preview-chip">Preview mode</span>
              ) : (
                <span className="member-chip">
                  <i /> The listening room is open
                </span>
              )}
              <Link href="/account" aria-label="Account settings">
                <Avatar name={data.profile?.displayName || 'You'} small />
              </Link>
            </div>
          </header>
          {data.demo && (
            <div className="preview-banner">
              You’re exploring a sample quiz. Answers save on this device; accounts, audio, and
              community publishing need connected services.
            </div>
          )}
          <main className="main-content" key={path}>
            {page}
          </main>
          <footer>
            Made for the love of music.<span>Listen closely. Guess boldly.</span>
            <Music2 size={14} />
          </footer>
        </div>
      </div>
    </Context.Provider>
  );
}
function Welcome() {
  return (
    <div className="welcome">
      <span className="eyebrow">WELCOME TO NEEDLE DROP</span>
      <h1>
        A little music.
        <br />A little mystery.
        <br />
        <em>A lot to talk about.</em>
      </h1>
      <p>
        A monthly music quiz and a place to share the songs that stick with you. Listen, take a
        guess, and find your people.
      </p>
      <div className="button-row">
        <Link href="/signup" className="button">
          Join the listening room <ArrowRight size={17} />
        </Link>
        <Link href="/login" className="button secondary">
          Sign in
        </Link>
      </div>
      <div className="welcome-record">
        <Vinyl />
      </div>
    </div>
  );
}
function Vinyl() {
  return (
    <div className="record-art" aria-hidden>
      <div className="record-shadow" />
      <div className="record-sleeve">
        <span>
          THE MONTHLY
          <br />
          LISTENING CLUB
        </span>
        <Music2 size={28} />
      </div>
      <div className="record">
        <div className="record-label">
          <span>
            needle
            <br />
            drop.
          </span>
          <i />
        </div>
      </div>
      <div className="record-spark spark-one">✳</div>
      <div className="record-spark spark-two">✦</div>
    </div>
  );
}
function Dashboard() {
  const { data } = useApp();
  const name = data.profile?.displayName.split(' ')[0];
  const q = data.quizzes.find((q) => q.state === 'open');
  const upcoming = data.quizzes.find((q) => q.state === 'scheduled');
  const past = data.quizzes.filter((q) => q.state === 'released');
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR MONTHLY DOSE OF MUSICAL CURIOSITY</span>
          <h1>
            Good to see you, {name}
            <span className="orange">.</span>
          </h1>
          <p>Put the kettle on. There’s something good to listen to.</p>
        </div>
        <span className="small-date">{dateLabel(new Date().toISOString(), undefined, true)}</span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span /> THE MONTHLY MUSIC QUIZ
          </span>
          <h2>
            A familiar tune.
            <br />
            An unexpected
            <br />
            <em>connection.</em>
          </h2>
          <p>
            A handful of songs, a hidden theme, and your ears.
            <br />
            Let’s see where the music takes you.
          </p>
          <Link className="button light" href={q ? `/quiz/${q.id}` : '/quizzes'}>
            {q ? 'Give it a spin' : 'Explore the quizzes'}
            <ArrowUpRight size={18} />
          </Link>
        </div>
        <Vinyl />
        <span className="hero-footnote">NO SHAZAM. JUST YOU AND THE MUSIC.</span>
      </section>
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <section>
            <div className="section-heading">
              <h2>On the turntable</h2>
              <span className="muted">This month’s challenge</span>
            </div>
            {q ? (
              <QuizCard quiz={q} featured />
            ) : upcoming ? (
              <QuizCard quiz={upcoming} />
            ) : (
              <div className="card empty">
                <Disc3 />
                <h3>The next quiz is on its way.</h3>
                <p>We’ll email you when the needle drops.</p>
              </div>
            )}
          </section>
          <section className="feed-section">
            <div className="section-heading">
              <h2>From the listening room</h2>
              <Link className="text-link" href="/community">
                All conversations <ArrowRight size={15} />
              </Link>
            </div>
            <p className="section-description">The songs we’re sharing between quizzes.</p>
            {data.posts.slice(0, 2).map((post) => (
              <PostCard key={post.id} post={post} compact />
            ))}
            {!data.posts.length && (
              <div className="card empty">
                <MessagesSquare />
                <p>Be the first to share a song.</p>
                <Link href="/community">Start a conversation</Link>
              </div>
            )}
          </section>
        </div>
        <aside className="dashboard-secondary">
          <div className="mini-card how-card">
            <span className="eyebrow">NEW AROUND HERE?</span>
            <h3>Three simple things.</h3>
            {[
              ['01', 'Listen closely', 'Short clips. As many replays as you like.'],
              ['02', 'Make the connection', 'Name the songs and spot the theme.'],
              ['03', 'Compare notes', 'See the answers and everyone’s guesses.'],
            ].map(([n, title, text]) => (
              <div className="how-step" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mini-card newsletter">
            <Mail size={23} />
            <h3>Never miss a beat.</h3>
            <p>
              {data.profile?.quizEnrolled
                ? 'You’re on the list for new quizzes and deadline reminders.'
                : 'Join the monthly quiz list to hear when a new one lands.'}
            </p>
            <Link href="/account" className="text-link">
              Email preferences <ArrowUpRight size={14} />
            </Link>
          </div>
          {past[0] && (
            <Link href={`/results/${past[0].id}`} className="mini-card last-results">
              <div className="section-heading">
                <Trophy size={22} />
                <ArrowUpRight size={17} />
              </div>
              <span className="eyebrow">LAST TIME AROUND</span>
              <h3>{past[0].title}</h3>
              <p>The guesses are in. Take a look.</p>
              <span className="text-link">
                See the results <ArrowRight size={14} />
              </span>
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}
export function QuizCard({ quiz: q, featured = false }: { quiz: Quiz; featured?: boolean }) {
  return (
    <Link
      href={
        q.state === 'released'
          ? `/results/${q.id}`
          : q.state === 'draft'
            ? `/host/${q.id}`
            : q.state === 'scheduled'
              ? '/quizzes'
              : `/quiz/${q.id}`
      }
      className={`quiz-card card ${featured ? 'featured' : ''}`}
    >
      <div className="quiz-card-top">
        <span className={`status ${q.state}`}>
          {q.state === 'open'
            ? 'Open for guesses'
            : q.state === 'released'
              ? 'Results are in'
              : q.state === 'grading'
                ? 'Being graded'
                : q.state === 'draft'
                  ? 'Draft'
                  : 'Coming soon'}
        </span>
        <span className="muted">{dateLabel(q.releaseAt, q.timezone)}</span>
      </div>
      <div className="quiz-card-body">
        <div className="small-record">
          <Disc3 size={43} />
        </div>
        <div>
          <h3>{q.title}</h3>
          <p>Hosted by {q.hostName}</p>
        </div>
        <ArrowUpRight className="card-arrow" size={24} />
      </div>
      <div className="quiz-card-bottom">
        <span>
          <Music2 size={15} />
          {q.clipCount} clips
        </span>
        <span>
          <Trophy size={15} />
          {q.maxPoints} points
        </span>
        <span>
          <Clock3 size={15} />
          {q.state === 'scheduled' ? 'Opens' : 'Due'}{' '}
          {dateLabel(q.state === 'scheduled' ? q.releaseAt : q.deadline, q.timezone)}
        </span>
      </div>
    </Link>
  );
}
function QuizArchive({ results = false }: { results?: boolean }) {
  const { data } = useApp();
  const quizzes = data.quizzes.filter((q) =>
    results ? q.state === 'released' : q.state !== 'draft',
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {results ? 'THE RECORD COLLECTION' : 'SOMETHING TO LISTEN FOR'}
          </span>
          <h1>
            {results ? 'Past results' : 'The monthly quiz'}
            <span className="orange">.</span>
          </h1>
          <p>
            {results
              ? 'The answers, the scores, and the inspired guesses.'
              : 'Find your next musical mystery.'}
          </p>
        </div>
      </div>
      <div className="quiz-grid">
        {quizzes.map((q) => (
          <QuizCard key={q.id} quiz={q} />
        ))}
      </div>
      {!quizzes.length && (
        <div className="card empty">
          <Disc3 />
          <p>
            {results
              ? 'No results yet. Check back after the first quiz.'
              : 'The next quiz is being put together.'}
          </p>
        </div>
      )}
    </>
  );
}
