'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, BarChart3, ClipboardList, Send, PanelLeft, PanelLeftClose, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMe } from '@/components/panel/use-me';
import { PwaInstallButton } from '@/components/panel/pwa-install';

const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
  { href: '/panel/laporan', label: 'Laporan', icon: ClipboardList },
  { href: '/panel/follow-up', label: 'Follow-up', icon: Send },
  { href: '/panel/settings', label: 'Settings', icon: Settings },
] as const;

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
  const navItems = isCs
    ? NAV.filter((n) => n.href === '/panel/laporan' || n.href === '/panel/follow-up')
    : NAV;
  const isFollowUp = pathname === '/panel/follow-up'; // CRM page: hide header filters + tighten padding for more room.

  // CS have no Settings access (where the admin logout lives) — give them one here.
  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className={cn('hidden w-64 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col', navHidden && 'md:hidden')}>
          <div className="px-6 py-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/wafachat-wordmark.png"
              alt="WaFaChat"
              className="h-10 w-auto max-w-full object-contain object-left"
            />
          </div>
          <nav className="flex-1 space-y-1 px-4">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors',
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="mx-auto flex w-full max-w-6xl items-center">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNavHidden((v) => !v)}
                  className="hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 md:inline-flex"
                  aria-label={navHidden ? 'Tampilkan menu' : 'Sembunyikan menu'}
                >
                  {navHidden ? <PanelLeft className="size-5" /> : <PanelLeftClose className="size-5" />}
                </button>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                <span className="hidden h-6 w-px bg-border sm:block" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/wafachat-wordmark.png"
                  alt="WaFaChat"
                  className="hidden h-6 w-auto max-w-[140px] object-contain sm:block"
                />
              </div>
            </div>
          </header>
          <div className={cn('mx-auto w-full max-w-6xl space-y-6', isFollowUp ? 'p-2 pb-20 md:p-4 md:pb-4' : 'p-4 pb-24 md:p-6 md:pb-8')}>{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav — thumb-reachable, app-like. Replaces the badge row. Hidden on md+. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors active:scale-95',
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
              className="flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground transition-colors active:scale-95"
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
