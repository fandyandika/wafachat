'use client';

import { useState, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Upload, Zap, MessageSquare, TrendingUp, Power } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CsAvatar } from '@/components/ui/cs-avatar';
import { Switch } from '@/components/ui/switch';
import { resizeImage } from '@/lib/resize-image';
import { cn } from '@/lib/utils';

export function SettingsDashboard() {
  const csList = useQuery(api.cs.listCs, {}) ?? [];
  const genUrl = useMutation(api.cs.generateUploadUrl);
  const setAvatar = useMutation(api.cs.setCsAvatar);
  const upsert = useMutation(api.csConfigs.upsert);

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function onToggle(c: any, field: string, value: boolean) {
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
              {/* Upload Button */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) {
                      onPick(file, c.csName);
                      e.currentTarget.value = '';
                    }
                  }}
                />
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
                  className="w-full gap-2"
                >
                  <Upload className="size-4" />
                  {busy === c.csName ? 'Uploading...' : 'Upload foto'}
                </Button>
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
