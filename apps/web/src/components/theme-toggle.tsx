'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Mode = 'light' | 'dark' | 'system';
const cycle: Record<Mode, Mode> = { light: 'dark', dark: 'system', system: 'light' };

export function ThemeToggle() {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch — render a stable placeholder until mounted.
  if (!mounted) {
    return (
      <Button size="icon" variant="outline" aria-label={t('toggle')} disabled>
        <Sun className="size-4" />
      </Button>
    );
  }

  const current = (theme as Mode) ?? 'system';
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;

  return (
    <Button
      size="icon"
      variant="outline"
      aria-label={t(current)}
      title={t(current)}
      onClick={() => setTheme(cycle[current])}
    >
      <Icon className="size-4 transition-transform duration-200" />
    </Button>
  );
}
