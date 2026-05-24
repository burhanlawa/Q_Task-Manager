import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Q Task Manager',
  description: 'Task management for businesses in Iraq, Kurdistan, and MENA.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
