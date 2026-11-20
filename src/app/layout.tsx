import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Needle Drop — a little music, a little mystery',
  description: 'Your monthly music quiz and a listening room full of good discoveries.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
