'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Upload, Trash2, Zap, MessageSquare, TrendingUp, Power } from 'lucide-react';
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
  isActive: boolean;
};

function TeamSection() {
  const [users, setUsers] = useState<Array<{ email: string; name: string; role: 'admin' | 'cs'; isActive: boolean }>>([]);
  const [form, setForm] = useState({ email: '', name: '', role: 'cs', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (await post({ action: 'create', ...form })) setForm({ email: '', name: '', role: 'cs', password: '' });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Tim</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {err && <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{err}</div>}
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.email} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{u.name} <span className="text-xs text-muted-foreground">({u.role})</span></div>
                <div className="truncate text-xs text-muted-foreground">{u.email}{!u.isActive && ' — nonaktif'}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { const p = prompt(`Password baru untuk ${u.email}`); if (p) post({ action: 'reset', email: u.email, password: p }); }}>Reset</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => post({ action: 'setActive', email: u.email, isActive: !u.isActive })}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="cs">CS</option>
            <option value="admin">Admin</option>
          </select>
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Password awal" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button disabled={busy} onClick={addUser} className="sm:col-span-2">Tambah user</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsDashboard() {
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const genUrl = useMutation(api.cs.generateUploadUrl);
  const setAvatar = useMutation(api.cs.setCsAvatar);
  const clearAvatar = useMutation(api.cs.clearCsAvatar);
  const upsert = useMutation(api.csConfigs.upsert);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  function onToggle(c: CsRow, field: keyof Omit<CsRow, 'csName' | 'csPhone'>, value: boolean) {
    upsert({
      csName: c.csName,
      csPhone: c.csPhone,
      orderAutomationEnabled: c.orderAutomationEnabled,
      aiAssistantEnabled: c.aiAssistantEnabled,
      reportingEnabled: c.reportingEnabled,
      isActive: c.isActive,
      [field]: value,
    });
  }

  return (
    <div className="space-y-6">
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
    </div>
  );
}
