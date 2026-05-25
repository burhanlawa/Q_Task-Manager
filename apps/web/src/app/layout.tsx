import type { Metadata } from 'next';
import './globals.css';
import { PostHogProvider } from '@/components/posthog-provider';

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
      <body>
        <PostHogProvider />
        {children}
      </body>
    </html>
  );
}
