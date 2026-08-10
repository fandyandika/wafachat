'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, BarChart3, ClipboardList, Send, PanelLeft, PanelLeftClose, Settings, LogOut, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe } from '@/components/panel/use-me';
import { PwaInstallButton } from '@/components/panel/pwa-install';

const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
  { href: '/panel/laporan', label: 'Laporan', icon: ClipboardList },
  { href: '/panel/follow-up', label: 'Follow-up', icon: Send },
  { href: '/panel/admin-inbox', label: 'Inbox', icon: MessagesSquare },
  { href: '/panel/settings', label: 'Settings', icon: Settings },
] as const;

export function navItemsForRole(role: 'admin' | 'cs' | undefined) {
  if (role !== 'cs') return NAV;
  return NAV.filter((item) => item.href === '/panel' || item.href === '/panel/laporan' || item.href === '/panel/follow-up');
}

function PanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isQueen = pathname === '/panel/queen';
  const title = isQueen ? 'Queen Recap' : NAV.find((n) => n.href === pathname)?.label ?? 'Dashboard';
  const [navHidden, setNavHidden] = useState(false);
  const me = useMe();
  // CS staff only get Laporan + Follow-up in the menu; admins get everything. Middleware
  // enforces the same server-side — this just hides links CS can't reach anyway.
  const isCs = me?.role === 'cs';
  const navItems = navItemsForRole(me?.role);
  const organizationName = me?.orgName || 'Organisasi aktif';
  const roleLabel = isCs ? 'CS' : 'Owner';
  const isWorkspace = pathname === '/panel/follow-up' || pathname === '/panel/admin-inbox';

  // CS have no Settings access (where the admin logout lives) — give them one here.
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#panel-main" className="sr-only fixed left-3 top-3 z-50 rounded-lg bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only">
        Lewati navigasi
      </a>
      <div className="flex min-h-screen">
        <aside className={cn('hidden w-60 shrink-0 border-r border-ledger-rule bg-card md:flex md:flex-col', navHidden && 'md:hidden')}>
          <div className="border-b border-ledger-rule px-6 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/wafachat-wordmark.png"
              alt="WaFaChat"
              className="h-10 w-auto max-w-full object-contain object-left"
            />
          </div>
          <nav className="flex-1 py-4">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 border-y border-transparent px-6 text-left text-sm font-medium transition-colors',
                    active
                      ? 'border-ledger-rule bg-secondary text-ledger-ink'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="px-4 pb-2">
            <PwaInstallButton />
          </div>
          {isCs && (
            <div className="px-4 pb-6">
              <button
                type="button"
                onClick={logout}
                className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <LogOut className="size-4" />
                <span>Keluar</span>
              </button>
            </div>
          )}
        </aside>

        <main id="panel-main" className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-ledger-rule bg-card px-3 py-2.5 md:px-8 md:py-3">
            <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setNavHidden((v) => !v)}
                  className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 md:inline-flex"
                  aria-label={navHidden ? 'Tampilkan menu' : 'Sembunyikan menu'}
                >
                  {navHidden ? <PanelLeft className="size-5" /> : <PanelLeftClose className="size-5" />}
                </button>
                <h1 className="truncate text-lg font-semibold tracking-tight text-ledger-ink md:text-2xl">{title}</h1>
              </div>
              <p data-panel-mobile-role="true" className="shrink-0 text-xs font-medium text-muted-foreground md:hidden">
                {roleLabel}
              </p>
              <div data-panel-desktop-org="true" className="hidden min-w-0 text-right leading-tight md:block">
                <p className="truncate text-sm font-semibold text-ledger-ink">{organizationName}</p>
                <p className="text-xs text-muted-foreground">{roleLabel}</p>
              </div>
            </div>
          </header>
          <div className={cn('mx-auto w-full max-w-[1440px] space-y-6', isWorkspace ? 'p-2 pb-20 md:p-4 md:pb-4' : 'p-3 pb-24 sm:p-4 md:p-6 md:pb-8')}>{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav — thumb-reachable, app-like. Replaces the badge row. Hidden on md+. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-ledger-rule bg-card md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors active:scale-95',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span className={cn('flex size-9 items-center justify-center rounded-xl transition-colors', active && 'bg-accent')}>
                  <item.icon className="size-5" />
                </span>
                {item.label}
              </Link>
            );
          })}
          {isCs && (
            <button
              type="button"
              onClick={logout}
              className="flex min-h-11 flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors active:scale-95"
            >
              <span className="flex size-9 items-center justify-center rounded-xl">
                <LogOut className="size-5" />
              </span>
              Keluar
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}

// Child pages using useSearchParams must sit under a Suspense boundary for prerender.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
