"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Stage = 1 | 2 | 3;
type Variable = "customer_name" | "product_name" | "order_id";
type Draft = {
  label: string;
  templateName: string;
  language: string;
  variables: Variable[];
  matchPatterns: string;
  isActive: boolean;
};

const STAGES: Stage[] = [1, 2, 3];
const VARIABLE_OPTIONS: Array<{ value: Variable; label: string }> = [
  { value: "customer_name", label: "Nama customer" },
  { value: "product_name", label: "Nama produk" },
  { value: "order_id", label: "ID order" },
];

const emptyDraft = (stage: Stage): Draft => ({
  label: stage === 3 ? "Follow-up terakhir" : `Follow-up H+${stage}`,
  templateName: "",
  language: "id",
  variables: ["customer_name", "product_name", "order_id"],
  matchPatterns: "",
  isActive: false,
});

type FollowUpTemplateSetup = {
  templates: Array<Omit<Draft, "matchPatterns"> & { stage: Stage; matchPatterns: string[] }>;
};

function draftsFromSetup(setup: FollowUpTemplateSetup | undefined) {
  const drafts: Record<Stage, Draft> = { 1: emptyDraft(1), 2: emptyDraft(2), 3: emptyDraft(3) };
  for (const row of setup?.templates ?? []) {
    drafts[row.stage] = {
      label: row.label,
      templateName: row.templateName,
      language: row.language,
      variables: [...row.variables],
      matchPatterns: (row.matchPatterns ?? []).join("\n"),
      isActive: row.isActive,
    };
  }
  return drafts;
}

export function FollowUpTemplateSettings() {
  const setup = useQuery(api.followUpTemplates.getFollowUpTemplateSetup, {});
  const upsert = useMutation(api.followUpTemplates.upsertFollowUpTemplate);
  const [drafts, setDrafts] = useState<Record<Stage, Draft>>(() => draftsFromSetup(setup));
  const [busy, setBusy] = useState<Stage | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!setup) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const row of setup.templates) {
        next[row.stage] = {
          label: row.label,
          templateName: row.templateName,
          language: row.language,
          variables: [...row.variables],
          matchPatterns: (row.matchPatterns ?? []).join("\n"),
          isActive: row.isActive,
        };
      }
      return next;
    });
  }, [setup]);

  function patchDraft(stage: Stage, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [stage]: { ...current[stage], ...patch } }));
  }

  async function save(stage: Stage) {
    const draft = drafts[stage];
    setBusy(stage);
    setFeedback(null);
    try {
      await upsert({
        stage,
        ...draft,
        matchPatterns: draft.matchPatterns.split("\n"),
      });
      setFeedback({ kind: "ok", message: `Template H+${stage} tersimpan.` });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Template gagal disimpan." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Template Follow-up</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Pengiriman manual hanya aktif bila H+1, H+2, dan H+3 memakai template KirimDev yang sudah disetujui.</p>
          <p className={setup?.ready ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>
            {setup?.ready ? "Siap digunakan" : `Belum siap${setup ? ` · lengkapi ${setup.missingStages.map((stage) => `H+${stage}`).join(", ")}` : ""}`}
          </p>
          {feedback && (
            <p role={feedback.kind === "error" ? "alert" : "status"} className={feedback.kind === "error" ? "text-destructive" : "text-emerald-700"}>
              {feedback.message}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {STAGES.map((stage) => {
          const draft = drafts[stage];
          return (
            <Card key={stage}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">H+{stage}{stage === 3 ? " · Follow-up terakhir" : ""}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor={`follow-up-label-${stage}`} className="text-sm font-medium">Label internal</label>
                  <input id={`follow-up-label-${stage}`} value={draft.label} onChange={(event) => patchDraft(stage, { label: event.target.value })} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`follow-up-template-${stage}`} className="text-sm font-medium">Nama template KirimDev</label>
                  <input id={`follow-up-template-${stage}`} placeholder="contoh: follow_up_h1" value={draft.templateName} onChange={(event) => patchDraft(stage, { templateName: event.target.value })} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`follow-up-language-${stage}`} className="text-sm font-medium">Kode bahasa</label>
                  <input id={`follow-up-language-${stage}`} value={draft.language} onChange={(event) => patchDraft(stage, { language: event.target.value })} className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={`follow-up-patterns-${stage}`} className="text-sm font-medium">Pola pesan manual H+{stage}</label>
                  <textarea id={`follow-up-patterns-${stage}`} value={draft.matchPatterns} onChange={(event) => patchDraft(stage, { matchPatterns: event.target.value })} placeholder="Satu pola per baris" className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                  <p className="text-xs text-muted-foreground">Satu pola per baris, 8–200 karakter, maksimal 10 pola.</p>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Urutan variabel</legend>
                  {draft.variables.map((variable, index) => (
                    <select
                      key={index}
                      aria-label={`Variabel ${index + 1} H+${stage}`}
                      value={variable}
                      onChange={(event) => {
                        const variables = [...draft.variables];
                        variables[index] = event.target.value as Variable;
                        patchDraft(stage, { variables });
                      }}
                      className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      {VARIABLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{index + 1}. {option.label}</option>)}
                    </select>
                  ))}
                </fieldset>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 text-sm">
                  <input type="checkbox" checked={draft.isActive} onChange={(event) => patchDraft(stage, { isActive: event.target.checked })} />
                  Aktifkan template H+{stage}
                </label>
                <Button className="min-h-11 w-full" disabled={busy !== null || !draft.label.trim() || !draft.templateName.trim() || !draft.language.trim()} onClick={() => save(stage)}>
                  {busy === stage ? "Menyimpan…" : `Simpan H+${stage}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
