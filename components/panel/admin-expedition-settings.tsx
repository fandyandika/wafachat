"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

type VariableDraft = { key: string; label: string; required: boolean };

const EMPTY_VARIABLE: VariableDraft = { key: "", label: "", required: true };

export function AdminExpeditionSettings() {
  const setup = useQuery(api.adminInbox.getSetup, {});
  const upsertChannel = useMutation(api.adminInbox.upsertChannel);
  const upsertTemplate = useMutation(api.adminInbox.upsertTemplate);
  const removeTemplate = useMutation(api.adminInbox.removeTemplate);
  const [channelName, setChannelName] = useState("Admin Ekspedisi");
  const [displayPhone, setDisplayPhone] = useState("");
  const [providerNumberId, setProviderNumberId] = useState("");
  const [channelActive, setChannelActive] = useState(false);
  const [templateLabel, setTemplateLabel] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [language, setLanguage] = useState("id");
  const [variables, setVariables] = useState<VariableDraft[]>([{ ...EMPTY_VARIABLE }]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!setup?.channel) return;
    setChannelName(setup.channel.name);
    setDisplayPhone(setup.channel.displayPhone ?? "");
    setProviderNumberId(setup.channel.providerNumberId ?? "");
    setChannelActive(setup.channel.isActive);
  }, [setup?.channel]);

  async function run(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setStatus(null);
    try {
      await task();
      setStatus({ kind: "ok", message: success });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Gagal menyimpan." });
    } finally {
      setBusy(false);
    }
  }

  function updateVariable(index: number, patch: Partial<VariableDraft>) {
    setVariables((current) => current.map((variable, itemIndex) => (
      itemIndex === index ? { ...variable, ...patch } : variable
    )));
  }

  function resetTemplateDraft() {
    setTemplateLabel("");
    setTemplateName("");
    setLanguage("id");
    setVariables([{ ...EMPTY_VARIABLE }]);
  }

  if (setup === undefined) {
    return <div role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Memuat konfigurasi ekspedisi…</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">WhatsApp Admin Ekspedisi</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Nomor khusus admin untuk menghubungi dan membalas customer terkait pengiriman.</p>
            </div>
            <div className={`inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold ${
              setup.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
            }`}>
              {setup.ready ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
              {setup.ready ? "Siap digunakan" : "Pengiriman belum aktif"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!setup.ready && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Lengkapi konfigurasi:</p>
              <ul className="mt-1 list-disc pl-5">
                {setup.missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {status && (
            <div role={status.kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${
              status.kind === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}>{status.message}</div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-channel-name">
              Nama channel
              <input id="admin-channel-name" className="min-h-11 rounded-lg border border-input bg-background px-3" value={channelName} onChange={(event) => setChannelName(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-display-phone">
              Nomor WhatsApp admin
              <input id="admin-display-phone" inputMode="tel" placeholder="08xxx / 62xxx" className="min-h-11 rounded-lg border border-input bg-background px-3" value={displayPhone} onChange={(event) => setDisplayPhone(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-provider-number-id">
              KirimDev phone_number_id
              <input id="admin-provider-number-id" placeholder="Diisi setelah nomor terdaftar" className="min-h-11 rounded-lg border border-input bg-background px-3 font-mono text-sm" value={providerNumberId} onChange={(event) => setProviderNumberId(event.target.value)} />
            </label>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 self-end rounded-lg border border-border px-3" htmlFor="admin-channel-active">
              <span className="text-sm font-medium">Channel aktif</span>
              <Switch id="admin-channel-active" checked={channelActive} onCheckedChange={setChannelActive} />
            </label>
          </div>
          <Button
            className="min-h-11"
            disabled={busy || !channelName.trim()}
            onClick={() => void run(() => upsertChannel({
              name: channelName,
              displayPhone: displayPhone || undefined,
              providerNumberId: providerNumberId || undefined,
              isActive: channelActive,
            }), "Channel disimpan.")}
          >
            Simpan channel
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Template ekspedisi approved</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            {setup.templates.map((template) => (
              <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{template.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{template.templateName} · {template.language}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 text-destructive"
                  disabled={busy}
                  onClick={() => void run(() => removeTemplate({ templateId: template.id }), "Template dihapus.")}
                >
                  <Trash2 className="size-4" /> Hapus
                </Button>
              </div>
            ))}
            {setup.templates.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Belum ada template ekspedisi.</p>}
          </div>

          <div className="space-y-4 border-t border-border pt-4">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-template-label">
                Label
                <input id="admin-template-label" className="min-h-11 rounded-lg border border-input bg-background px-3" value={templateLabel} onChange={(event) => setTemplateLabel(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-template-name">
                Template name
                <input id="admin-template-name" placeholder="expedition_status_v1" className="min-h-11 rounded-lg border border-input bg-background px-3 font-mono text-sm" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium" htmlFor="admin-template-language">
                Bahasa
                <input id="admin-template-language" className="min-h-11 rounded-lg border border-input bg-background px-3" value={language} onChange={(event) => setLanguage(event.target.value)} />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Variabel template</p>
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setVariables((current) => [...current, { ...EMPTY_VARIABLE }])}>
                  <Plus className="size-4" /> Tambah variabel
                </Button>
              </div>
              {variables.map((variable, index) => (
                <div key={index} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                  <label className="grid gap-1 text-xs font-medium" htmlFor={`admin-variable-key-${index}`}>
                    Key
                    <input id={`admin-variable-key-${index}`} className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm" value={variable.key} onChange={(event) => updateVariable(index, { key: event.target.value })} />
                  </label>
                  <label className="grid gap-1 text-xs font-medium" htmlFor={`admin-variable-label-${index}`}>
                    Label
                    <input id={`admin-variable-label-${index}`} className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm" value={variable.label} onChange={(event) => updateVariable(index, { label: event.target.value })} />
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm" htmlFor={`admin-variable-required-${index}`}>
                    <Switch id={`admin-variable-required-${index}`} checked={variable.required} onCheckedChange={(value) => updateVariable(index, { required: value })} />
                    Wajib
                  </label>
                  <Button variant="outline" size="icon" className="size-11 text-destructive" aria-label={`Hapus variabel ${index + 1}`} disabled={variables.length === 1} onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              className="min-h-11"
              disabled={busy || !setup.channel || !templateLabel.trim() || !templateName.trim()}
              onClick={() => void run(async () => {
                if (!setup.channel) throw new Error("Simpan channel terlebih dahulu.");
                await upsertTemplate({
                  channelId: setup.channel.id,
                  label: templateLabel,
                  templateName,
                  language,
                  variables,
                  isActive: true,
                });
                resetTemplateDraft();
              }, "Template ditambahkan.")}
            >
              Tambah template
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
