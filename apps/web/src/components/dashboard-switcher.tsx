'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LayoutDashboard } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Variant = 'employee' | 'manager' | 'admin';
type AvailableResponse = {
  available: Variant[];
  primary: Variant;
};

// Header-side dashboard switcher. Renders ONLY when the user has access
// to more than one variant — single-variant users never see it. The
// active variant is detected from the current URL so the label updates
// when the user navigates between dashboards via the sidebar.
export function DashboardSwitcher() {
  const t = useTranslations('dashboard.switcher');
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();

  const { data } = useQuery<AvailableResponse>({
    queryKey: ['dashboard', 'available'],
    queryFn: () => api.get('dashboard/available'),
    enabled: isLoaded && !!isSignedIn,
    staleTime: Infinity,
    retry: false,
  });

  // While Clerk auth + the /dashboard/available response are still
  // loading, reserve a slot so the header doesn't reflow if the
  // switcher ends up appearing. Once we know the user has < 2
  // variants, collapse to null (the common case for an Employee).
  if (!isLoaded || !isSignedIn) return null;
  if (!data) return <div className="h-9 w-24" aria-hidden />;
  if (data.available.length < 2) return null;

  // Active = whichever /dashboard/<x> we're on. Anywhere else, show the
  // primary's label so the switcher always has something to display.
  const match = pathname.match(/\/dashboard\/(employee|manager|admin)\b/);
  const active: Variant = (match?.[1] as Variant) ?? data.primary;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('aria')}
        >
          <LayoutDashboard className="h-4 w-4" />
          <span className="hidden sm:inline">{t(`labels.${active}`)}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {data.available.map((v) => (
          <DropdownMenuItem key={v} asChild>
            <Link
              href={`/dashboard/${v}` as never}
              className={cn(
                'flex w-full items-center gap-2 text-sm',
                v === active && 'bg-secondary text-foreground',
              )}
            >
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
              <span>{t(`labels.${v}`)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
