'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { Upload, Trash2, Zap, MessageSquare, TrendingUp, Power, LogOut, Pencil } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { Switch } from '@/components/ui/switch';
import { resizeImage } from '@/lib/resize-image';
import { cn } from '@/lib/utils';
import type { Doc } from '@/convex/_generated/dataModel';

type CsRow = {
  csName: string;
  csPhone?: string;
  orderAutomationEnabled: boolean;
  aiAssistantEnabled: boolean;
  reportingEnabled: boolean;
  autoFollowUpEnabled?: boolean;
  isActive: boolean;
};

function TeamSection() {
  const [users, setUsers] = useState<Array<{ email: string; name: string; role: 'admin' | 'cs'; csName?: string; isActive: boolean }>>([]);
  const [form, setForm] = useState<{ email: string; name: string; role: 'admin' | 'cs'; password: string; csName: string }>({ email: '', name: '', role: 'cs', password: '', csName: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const csOptions = (useQuery(api.cs.listCs, {}) ?? []).map((c) => c.csName);

  async function load() {
    const r = await fetch('/api/admin/users');
    if (r.ok) setUsers((await r.json()).users);
  }
  useEffect(() => { load(); }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error || 'Gagal'); return false; }
    await load();
    return true;
  }
  async function addUser() {
    if (!form.email || !form.name || !form.password) { setErr('Lengkapi semua field'); return; }
    if (form.role === 'cs' && !form.csName) { setErr('Pilih CS untuk akun ini'); return; }
    if (await post({ action: 'create', ...form })) setForm({ email: '', name: '', role: 'cs', password: '', csName: '' });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Tim</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {err && <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{err}</div>}
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {u.name} <span className="text-xs text-muted-foreground">({u.role})</span>
                  {u.role === 'cs' && (
                    <span className={cn('ml-1 text-xs', u.csName ? 'text-primary' : 'text-amber-600')}>· {u.csName ? `CS ${u.csName}` : 'belum di-assign'}</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">{u.email}{!u.isActive && ' — nonaktif'}</div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {u.role === 'cs' && (
                  <select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={u.csName ?? ''} disabled={busy} onChange={(e) => post({ action: 'update', email: u.email, csName: e.target.value })} title="Assign akun ini ke CS tertentu">
                    <option value="">— pilih CS —</option>
                    {csOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { const n = prompt(`Nama baru untuk ${u.email}`, u.name); if (n && n.trim()) post({ action: 'update', email: u.email, name: n.trim() }); }}>Rename</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { const p = prompt(`Password baru untuk ${u.email}`); if (p) post({ action: 'reset', email: u.email, password: p }); }}>Reset</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => post({ action: 'setActive', email: u.email, isActive: !u.isActive })}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                <Button variant="outline" size="sm" disabled={busy} className="text-destructive hover:text-destructive" onClick={() => { if (confirm(`Hapus user ${u.email}? Tidak bisa dibatalkan.`)) post({ action: 'delete', email: u.email }); }}>Hapus</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'cs' })}>
            <option value="cs">CS</option>
            <option value="admin">Admin</option>
          </select>
          {form.role === 'cs' ? (
            <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={form.csName} onChange={(e) => setForm({ ...form, csName: e.target.value })} title="Akun ini cuma bisa liat CS ini">
              <option value="">— assign ke CS —</option>
              {csOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <div />
          )}
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Password awal" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button disabled={busy} onClick={addUser} className="sm:col-span-2">Tambah user</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsDashboard() {
  const router = useRouter();
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const genUrl = useMutation(api.cs.generateUploadUrl);
  const setAvatar = useMutation(api.cs.setCsAvatar);
  const clearAvatar = useMutation(api.cs.clearCsAvatar);
  const upsert = useMutation(api.csConfigs.upsert);
  const renameCs = useMutation(api.csConfigs.renameCs);
  const deleteCsConfig = useMutation(api.csConfigs.deleteCsConfig);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; role: 'admin' | 'cs' } | null>(null);
  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
  }, []);
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  async function onPick(file: File, csName: string) {
    setBusy(csName);
    setErr(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('Maksimal 8 MB');
      const blob = await resizeImage(file);
      const url = await genUrl({});
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      if (!res.ok) throw new Error('Upload gagal');
      const { storageId } = await res.json();
      await setAvatar({ csName, storageId });
    } catch (e) {
      setErr(`${csName}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onClear(csName: string) {
    setBusy(csName);
    setErr(null);
    try {
      await clearAvatar({ csName });
    } catch (e) {
      setErr(`${csName}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onRename(csName: string) {
    const next = window.prompt(`Ganti nama "${csName}" menjadi:`, csName)?.trim();
    if (!next || next === csName) return;
    setBusy(csName);
    setErr(null);
    try {
      const res = await renameCs({ fromCsName: csName, toCsName: next });
      if (!res.ok) setErr(res.error);
    } catch (e) {
      setErr(`${csName}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(csName: string) {
    if (!window.confirm(`Hapus CS "${csName}" dari registry? Data laporan lama tidak terhapus, hanya kartu pengaturan ini.`)) return;
    setBusy(csName);
    setErr(null);
    try {
      const res = await deleteCsConfig({ csName });
      if (!res.ok) setErr(res.error);
    } catch (e) {
      setErr(`${csName}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function onToggle(c: CsRow, field: keyof Omit<CsRow, 'csName' | 'csPhone'>, value: boolean) {
    upsert({
      csName: c.csName,
      csPhone: c.csPhone,
      orderAutomationEnabled: c.orderAutomationEnabled,
      aiAssistantEnabled: c.aiAssistantEnabled,
      reportingEnabled: c.reportingEnabled,
      autoFollowUpEnabled: c.autoFollowUpEnabled ?? undefined,
      isActive: c.isActive,
      [field]: value,
    });
  }

  return (
    <div className="space-y-6">
      {/* Akun — user identity + sign out (moved here from the header so it stays out of the way) */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Akun</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{me?.name ?? '—'}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{me?.role ?? ''}</div>
          </div>
          <Button variant="outline" onClick={logout} className="shrink-0">
            <LogOut className="size-4" /> Keluar
          </Button>
        </CardContent>
      </Card>

      {me?.role !== 'admin' ? null : (
        <>
          <TeamSection />

          {err && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              {err}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {csList.map((c) => (
          <Card key={c.key} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-2">
                <CsAvatar name={c.csName} size="md" src={c.avatarUrl ?? undefined} />
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base truncate">{c.csName}</CardTitle>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === c.csName}
                    onClick={() => onRename(c.csName)}
                    aria-label={`Ganti nama ${c.csName}`}
                    className="size-8 p-0 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === c.csName}
                    onClick={() => onDelete(c.csName)}
                    aria-label={`Hapus ${c.csName}`}
                    className="size-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 flex-1">
              {/* Upload / Hapus foto */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === c.csName}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) onPick(file, c.csName);
                    };
                    input.click();
                  }}
                  className="flex-1 gap-2"
                >
                  <Upload className="size-4" />
                  {busy === c.csName ? 'Memproses...' : c.avatarUrl ? 'Ganti foto' : 'Upload foto'}
                </Button>
                {c.avatarUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === c.csName}
                    onClick={() => onClear(c.csName)}
                    aria-label="Hapus foto"
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>

              {/* Phone (read-only) */}
              {c.csPhone && (
                <div className="rounded-lg bg-muted/40 px-3 py-2">
                  <div className="text-xs text-muted-foreground font-medium">WhatsApp</div>
                  <div className="text-sm font-mono text-foreground">{c.csPhone}</div>
                </div>
              )}

              {/* Toggles */}
              <div className="space-y-3 border-t border-border pt-4">
                {/* Order Automation */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">Otomasi Order</span>
                  </div>
                  <Switch
                    checked={c.orderAutomationEnabled}
                    onCheckedChange={(value) => onToggle(c, 'orderAutomationEnabled', value)}
                    disabled={busy === c.csName}
                  />
                </div>

                {/* AI Assistant */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">AI Assistant</span>
                  </div>
                  <Switch
                    checked={c.aiAssistantEnabled}
                    onCheckedChange={(value) => onToggle(c, 'aiAssistantEnabled', value)}
                    disabled={busy === c.csName}
                  />
                </div>

                {/* Reporting */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">Reporting</span>
                  </div>
                  <Switch
                    checked={c.reportingEnabled}
                    onCheckedChange={(value) => onToggle(c, 'reportingEnabled', value)}
                    disabled={busy === c.csName}
                  />
                </div>

                {/* Auto Follow-up */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground truncate block">Auto Follow-up</span>
                      <span className="text-xs text-muted-foreground truncate block">Kirim H+1/H+2 otomatis 08–14 WIB</span>
                    </div>
                  </div>
                  <Switch
                    checked={c.autoFollowUpEnabled ?? false}
                    onCheckedChange={(value) => onToggle(c, 'autoFollowUpEnabled', value)}
                    disabled={busy === c.csName}
                  />
                </div>

                {/* Aktif */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Power className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground truncate">Aktif</span>
                  </div>
                  <Switch
                    checked={c.isActive}
                    onCheckedChange={(value) => onToggle(c, 'isActive', value)}
                    disabled={busy === c.csName}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

          {csList.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">Belum ada CS terdaftar.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
