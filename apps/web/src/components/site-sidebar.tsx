'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  GitBranch,
  HelpCircle,
  Home,
  KeyRound,
  Layers,
  ListChecks,
  Megaphone,
  PanelLeft,
  PanelLeftClose,
  ScrollText,
  Settings,
  Shield,
  TrendingUp,
  Users,
  UserSquare2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// One row in the sidebar. `permission` gates visibility — leave undefined
// for items every signed-in user can hit. `roles` is the optional org-role
// allow-list (separate from the permissions union because some items are
// gated by role-shape, not by a permission key).
type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  roles?: ReadonlyArray<string>;
};

type NavSection = {
  titleKey: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    titleKey: 'workspace',
    items: [
      { href: '/dashboard', labelKey: 'home', icon: Home },
      {
        href: '/dashboard/manager',
        labelKey: 'managerDashboard',
        icon: TrendingUp,
        roles: ['ceo', 'admin', 'hr', 'manager', 'supervisor'],
      },
      {
        href: '/dashboard/admin',
        labelKey: 'adminDashboard',
        icon: Shield,
        roles: ['ceo', 'admin'],
      },
      { href: '/tasks', labelKey: 'tasks', icon: Layers, permission: 'task.read' },
      { href: '/people', labelKey: 'people', icon: Users, permission: 'user.read' },
      { href: '/broadcasts', labelKey: 'broadcasts', icon: Megaphone },
      {
        href: '/activity',
        labelKey: 'activity',
        icon: ScrollText,
        permission: 'activity_log.read',
      },
    ],
  },
  {
    titleKey: 'reports',
    items: [
      {
        href: '/reports/task-completion',
        labelKey: 'tasksCompletion',
        icon: BarChart3,
        permission: 'report.read',
      },
      {
        href: '/reports/employee-performance',
        labelKey: 'employeePerformance',
        icon: TrendingUp,
        permission: 'report.read',
      },
      {
        href: '/reports/workload',
        labelKey: 'workload',
        icon: ListChecks,
        permission: 'report.read',
      },
    ],
  },
  {
    titleKey: 'admin',
    items: [
      {
        href: '/admin/branches',
        labelKey: 'branches',
        icon: GitBranch,
        permission: 'branch.read',
        roles: ['ceo', 'admin', 'manager', 'hr'],
      },
      {
        href: '/admin/departments',
        labelKey: 'departments',
        icon: Building2,
        permission: 'department.read',
        roles: ['ceo', 'admin', 'manager', 'hr'],
      },
      {
        href: '/admin/roles',
        labelKey: 'roles',
        icon: KeyRound,
        roles: ['ceo', 'admin'],
      },
      {
        href: '/billing',
        labelKey: 'billing',
        icon: CreditCard,
        roles: ['ceo', 'admin'],
      },
    ],
  },
  {
    titleKey: 'personal',
    items: [
      { href: '/me/profile', labelKey: 'myProfile', icon: UserSquare2 },
      { href: '/settings/notifications', labelKey: 'notifications', icon: Bell },
      { href: '/settings/company', labelKey: 'company', icon: Settings, roles: ['ceo', 'admin'] },
      { href: '/settings/security', labelKey: 'security', icon: Shield },
      { href: '/help', labelKey: 'help', icon: HelpCircle },
    ],
  },
];

type MeResponse = { id: string; orgRole: string };
type PermissionsResponse = { permissions: string[] };

function hasPerm(perms: string[], key: string): boolean {
  return perms.includes('*') || perms.includes(key);
}

// The header's hamburger button toggles this. We use a context so the
// button (rendered inside SiteHeader, a server component) can hand off
// to a small client-side toggle that talks to the sidebar.
type SidebarCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};
const SidebarContext = createContext<SidebarCtx | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Desktop starts open, mobile starts closed. We pick by viewport once
  // on mount — once toggled, the user's choice sticks for the session.
  const [open, setOpen] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setOpen(false);
    }
  }, []);
  return (
    <SidebarContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </SidebarContext.Provider>
  );
}

function useSidebar(): SidebarCtx {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used inside SidebarProvider');
  return ctx;
}

// Header-side button — renders the burger icon and flips the shared state.
export function SidebarToggle() {
  const { open, toggle } = useSidebar();
  const t = useTranslations('nav');
  return (
    <button
      type="button"
      aria-label={open ? t('closeMenu') : t('openMenu')}
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
    </button>
  );
}

// Wraps page children + handles the ps-60 shift so main content sits to
// the side of the sidebar when it's open, and resets when collapsed.
export function MainArea({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();
  return (
    <div
      className={cn(
        'transition-[padding] duration-200',
        // On md+ the sidebar is always visible: 240px (w-60) when expanded,
        // 64px (w-16) icon rail when collapsed. Shift content to match. On
        // mobile the sidebar overlays, so no padding either way.
        open ? 'md:ps-60' : 'md:ps-16',
      )}
    >
      {children}
    </div>
  );
}

// Placeholder shown on a cold start (no persisted cache yet) while the `me`
// and permissions queries are in flight. Mimics two sections of nav rows so
// the sidebar holds its width and rhythm instead of collapsing.
function SidebarSkeleton({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="animate-pulse space-y-6" aria-hidden>
      {[5, 4].map((rows, i) => (
        <div key={i}>
          {/* Section-title bar — hidden in the rail, like the real titles. */}
          <div className={cn('mx-3 mb-2 h-3 w-20 rounded bg-secondary', collapsed && 'md:hidden')} />
          <ul className="space-y-1.5">
            {Array.from({ length: rows }).map((_, j) => (
              <li
                key={j}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5',
                  collapsed && 'md:justify-center md:px-0',
                )}
              >
                <div className="h-4 w-4 shrink-0 rounded bg-secondary" />
                {/* Label bar — hidden in the rail. */}
                <div className={cn('h-3 flex-1 rounded bg-secondary', collapsed && 'md:hidden')} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SiteSidebar() {
  const t = useTranslations('nav');
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();

  // These two power the sidebar's visibility gating. They're persisted to
  // localStorage (see QueryProvider) and kept fresh for a while so that on
  // reload the cached values are available immediately and the menu paints
  // without the blank flash, then revalidates in the background.
  const { data: me } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: perms } = useQuery<PermissionsResponse>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Don't render at all on unauthenticated routes — the header/footer
  // also know to hide there. But while Clerk is still loading, keep the
  // aside present (empty) so MainArea's md:ps-60 shift doesn't cause a
  // layout flash where the page renders full-width and then jumps right
  // when the sidebar pops in.
  if (isLoaded && !isSignedIn) return null;
  const authReady = isLoaded && isSignedIn;

  // Only render items once we know who the user is and what they can do.
  // Without this check, role-gated items briefly render for everyone
  // (because me?.orgRole is undefined → role filter short-circuits true)
  // and then disappear once /me resolves — that's the popping-in flash.
  const dataReady = authReady && !!me && !!perms;
  const visibleSections = !dataReady
    ? []
    : SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (item.permission && !hasPerm(perms.permissions, item.permission)) return false;
          if (item.roles && !item.roles.includes(me.orgRole)) return false;
          return true;
        }),
      })).filter((s) => s.items.length > 0);

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <>
      {/* Mobile backdrop. Closes the sidebar when tapped. Md+ hides it
          because the sidebar isn't full-screen there. */}
      {open && (
        <div
          className="fixed inset-0 top-14 z-30 bg-background/70 backdrop-blur md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed top-14 z-40 h-[calc(100vh-3.5rem)] overflow-x-hidden overflow-y-auto border-e bg-background py-4',
          'transition-[transform,width,padding] duration-200',
          // Mobile (<md): full-width drawer that slides off the start side
          // when collapsed; a backdrop (below) sits behind it when open.
          'w-60 px-3',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          // Desktop (md+): never slides away. Expanded = 240px with labels;
          // collapsed = 64px icon rail. Reset the mobile slide transform.
          'md:translate-x-0 md:rtl:translate-x-0',
          open ? 'md:w-60 md:px-3' : 'md:w-16 md:px-2',
        )}
      >
        <nav className="space-y-6">
          {/* Cold start (no persisted cache): keep the sidebar's shape with a
              skeleton instead of rendering nothing, so the chrome doesn't
              collapse and reflow while `me`/`perms` load. On reload the
              persisted cache makes dataReady true on first paint, so this is
              only seen on a genuine first visit. */}
          {authReady && !dataReady && <SidebarSkeleton collapsed={!open} />}
          {visibleSections.map((section) => (
            <div key={section.titleKey}>
              <p
                className={cn(
                  'px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
                  // In the desktop rail there's no room for section titles —
                  // hide them. Replaced by spacing between groups.
                  !open && 'md:hidden',
                )}
              >
                {t(`sections.${section.titleKey}`)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
                  const label = t(`items.${item.labelKey}`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href as never}
                        // On mobile we close the drawer after navigation so
                        // the user actually sees the page they tapped.
                        onClick={() => {
                          if (typeof window !== 'undefined' && window.innerWidth < 768) {
                            setOpen(false);
                          }
                        }}
                        // `group/nav` scopes the rail tooltip's hover state to
                        // this row. `title` is the no-JS fallback hint.
                        title={!open ? label : undefined}
                        className={cn(
                          'group/nav relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                          // Center the icon in the rail (no label beside it).
                          !open && 'md:justify-center md:px-0',
                          active
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {/* Label: hidden in the desktop rail, always shown on
                            mobile and when expanded. */}
                        <span className={cn(!open && 'md:hidden')}>{label}</span>
                        {/* Rail-only hover tooltip. Pure CSS: hidden unless the
                            row is hovered/focused, and only rendered as a popup
                            on md+ when collapsed. Uses logical `start-full` so
                            it flips correctly under RTL. */}
                        {!open && (
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute start-full top-1/2 z-50 ms-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100 md:block"
                          >
                            {label}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
