'use client';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>A skipped beat.</h1>
      <p>We couldn’t load this page. Please try again.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
