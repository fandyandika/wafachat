'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bot, LayoutDashboard, CheckCircle2, BarChart3 } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePanelFilters, type DateRangeKey } from '@/components/panel/use-panel-filters';

const NAV = [
  { href: '/panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/panel/rekap', label: 'Rekap Pengiriman', icon: CheckCircle2 },
  { href: '/panel/performance', label: 'Performance', icon: BarChart3 },
] as const;

const RANGES: Array<{ label: string; value: DateRangeKey }> = [
  { label: 'Hari ini', value: 'today' },
  { label: 'Kemarin', value: 'yesterday' },
  { label: '7 hari', value: '7d' },
  { label: '30 hari', value: '30d' },
  { label: 'Bulan ini', value: 'month' },
];

function PanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const { range, cs } = usePanelFilters();
  const csConfigs = useQuery(api.csConfigs.list, {}) ?? [];
  const title = NAV.find((n) => n.href === pathname)?.label ?? 'Dashboard';

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(sp.toString());
    if (!value || (key === 'range' && value === 'today') || (key === 'cs' && value === 'all')) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card/60 md:flex md:flex-col">
          <div className="px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Bot className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none text-foreground">WaFaChat</div>
                <div className="mt-1 text-xs text-muted-foreground">CS Automation</div>
              </div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 px-4">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={`${item.href}?${sp.toString()}`}
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
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-4 backdrop-blur md:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
                <Badge variant="secondary">pustakaislam.net</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setParam('range', r.value)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        range === r.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <Select value={cs} onValueChange={(v) => setParam('cs', v ?? 'all')}>
                  <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Semua CS" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua CS</SelectItem>
                    {csConfigs.map((c: { csName: string }) => (
                      <SelectItem key={c.csName} value={c.csName}>{c.csName.replace(/^CS\s+/i, '')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {NAV.map((item) => (
                <Link key={item.href} href={`${item.href}?${sp.toString()}`}>
                  <Badge variant={pathname === item.href ? 'default' : 'secondary'}>{item.label}</Badge>
                </Link>
              ))}
            </div>
          </header>
          <div className="space-y-6 p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

// useSearchParams (in PanelShell + child pages) must sit under a Suspense
// boundary for Next.js prerender; this single boundary covers the whole subtree.
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <PanelShell>{children}</PanelShell>
    </Suspense>
  );
}
