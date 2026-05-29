'use client';

import { useAuth } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  GitBranch,
  Home,
  KeyRound,
  Layers,
  Megaphone,
  Menu,
  ScrollText,
  Settings,
  Shield,
  Users,
  UserSquare2,
  X,
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
      { href: '/', labelKey: 'home', icon: Home },
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
    ],
  },
  {
    titleKey: 'personal',
    items: [
      { href: '/me/profile', labelKey: 'myProfile', icon: UserSquare2 },
      { href: '/settings/notifications', labelKey: 'notifications', icon: Bell },
      { href: '/settings/company', labelKey: 'company', icon: Settings, roles: ['ceo', 'admin'] },
      { href: '/settings/security', labelKey: 'security', icon: Shield },
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
      {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
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
        // Sidebar is 240px (w-60) on md+. Shift the content over when open.
        open ? 'md:ps-60' : 'md:ps-0',
      )}
    >
      {children}
    </div>
  );
}

export function SiteSidebar() {
  const t = useTranslations('nav');
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();

  const { data: me } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get('me'),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });
  const { data: perms } = useQuery<PermissionsResponse>({
    queryKey: ['me', 'permissions'],
    queryFn: () => api.get('me/permissions'),
    enabled: isLoaded && !!isSignedIn,
    retry: false,
  });

  if (!isLoaded || !isSignedIn) return null;

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.permission && !hasPerm(perms?.permissions ?? [], item.permission)) return false;
      if (item.roles && me?.orgRole && !item.roles.includes(me.orgRole)) return false;
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
          // Always fixed below the header. Slide transform animates the
          // open/closed state without a layout reflow.
          'fixed top-14 z-40 h-[calc(100vh-3.5rem)] w-60 overflow-y-auto border-e bg-background px-3 py-4',
          'transition-transform duration-200',
          // Hidden state: slide off the start side.
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
        )}
        aria-hidden={!open}
      >
        <nav className="space-y-6">
          {visibleSections.map((section) => (
            <div key={section.titleKey}>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`sections.${section.titleKey}`)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);
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
                        className={cn(
                          'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-secondary text-foreground'
                            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{t(`items.${item.labelKey}`)}</span>
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
