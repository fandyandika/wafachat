"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import {
  LogOut,
  MessageSquare,
  Pencil,
  Power,
  Trash2,
  TrendingUp,
  Upload,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CsAvatar } from "@/components/ui/cs-avatar";
import { Switch } from "@/components/ui/switch";
import { resizeImage } from "@/lib/resize-image";
import { cn } from "@/lib/utils";

type SettingsSection = "account" | "organization" | "team" | "cs";
const SETTINGS_SECTIONS: Array<{ value: SettingsSection; label: string }> = [
  { value: "account", label: "Akun" },
  { value: "organization", label: "Organisasi" },
  { value: "team", label: "Tim" },
  { value: "cs", label: "Konfigurasi CS" },
];

type CsRow = {
  csName: string;
  csPhone?: string;
  orderAutomationEnabled: boolean;
  aiAssistantEnabled: boolean;
  reportingEnabled: boolean;
  autoFollowUpEnabled?: boolean;
  isActive: boolean;
  berduStaffIds?: string[];
  registryKey?: string;
  nameAliases?: string[];
  key: string;
};

const CS_TOGGLES: Array<{
  icon: LucideIcon;
  label: string;
  field: keyof Pick<
    CsRow,
    | "orderAutomationEnabled"
    | "aiAssistantEnabled"
    | "reportingEnabled"
    | "autoFollowUpEnabled"
    | "isActive"
  >;
}> = [
  { icon: Zap, label: "Otomasi Order", field: "orderAutomationEnabled" },
  { icon: MessageSquare, label: "AI Assistant", field: "aiAssistantEnabled" },
  { icon: TrendingUp, label: "Reporting", field: "reportingEnabled" },
  {
    icon: MessageSquare,
    label: "Auto Follow-up",
    field: "autoFollowUpEnabled",
  },
  { icon: Power, label: "Aktif", field: "isActive" },
];

function Failure({ children }: { children: string | null }) {
  return children ? (
    <div
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {children}
    </div>
  ) : null;
}

function OrgSection() {
  const org = useQuery(api.orgSettings.get, {});
  const update = useMutation(api.orgSettings.update);
  const [name, setName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [removingPhone, setRemovingPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (org) setName(org.orgName);
  }, [org]);

  async function save(patch: { orgName?: string; internalPhones?: string[] }) {
    setBusy(true);
    setErr(null);
    try {
      await update(patch);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  if (!org) return null;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisasi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Failure>{err}</Failure>
          <div className="space-y-1.5">
            <label htmlFor="organization-name" className="text-sm font-medium">
              Nama organisasi
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="organization-name"
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !name.trim() || name.trim() === org.orgName}
                onClick={() => save({ orgName: name.trim() })}
              >
                Simpan nama
              </Button>
            </div>
          </div>
          <div className="space-y-2 border-t border-border pt-4">
            <label htmlFor="internal-phone" className="text-sm font-medium">
              Nomor internal
            </label>
            <p className="text-xs text-muted-foreground">
              Nomor owner/admin/line CS tidak dihitung dalam metrik lead dan
              omzet.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {org.internalPhones.map((phone) => (
                <span
                  key={phone}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 font-mono text-xs"
                >
                  {phone}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    aria-label={`Hapus ${phone}`}
                    onClick={() => setRemovingPhone(phone)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                id="internal-phone"
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="08xxx / 62xxx"
                value={newPhone}
                onChange={(event) => setNewPhone(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !newPhone.trim()}
                onClick={async () => {
                  await save({
                    internalPhones: [...org.internalPhones, newPhone.trim()],
                  });
                  setNewPhone("");
                }}
              >
                Tambah
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      <AlertDialog
        open={Boolean(removingPhone)}
        onOpenChange={(open) => {
          if (!open) setRemovingPhone(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus nomor internal?</AlertDialogTitle>
            <AlertDialogDescription>
              Nomor ini akan mulai dihitung dalam metrik setelah dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={() => {
                if (removingPhone)
                  void save({
                    internalPhones: org.internalPhones.filter(
                      (phone) => phone !== removingPhone,
                    ),
                  });
                setRemovingPhone(null);
              }}
            >
              Hapus nomor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CsvField({
  csName,
  initial,
  disabled,
  label,
  placeholder,
  save,
}: {
  csName: string;
  initial: string[];
  disabled: boolean;
  label: string;
  placeholder: string;
  save: (value: string[]) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setValue(initial.join(", ")), [initial]);
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const dirty = parsed.join(",") !== initial.join(",");
  const id = `${label}-${csName}`;
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs"
          placeholder={placeholder}
          value={value}
          disabled={disabled || busy}
          onChange={(event) => setValue(event.target.value)}
        />
        {dirty && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={disabled || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await save(parsed);
              } catch (error) {
                setErr(
                  error instanceof Error ? error.message : "Gagal menyimpan",
                );
                setValue(initial.join(", "));
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan
          </Button>
        )}
      </div>
      <Failure>{err}</Failure>
    </div>
  );
}

function TeamSection() {
  const [users, setUsers] = useState<
    Array<{
      email: string;
      name: string;
      role: "admin" | "cs";
      csName?: string;
      isActive: boolean;
    }>
  >([]);
  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "cs" as "admin" | "cs",
    password: "",
    csName: "",
  });
  const [editing, setEditing] = useState<{
    email: string;
    action: "rename" | "reset";
    value: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const csOptions = (useQuery(api.cs.listCs, {}) ?? []).map((cs) => cs.csName);
  async function load() {
    const response = await fetch("/api/admin/users");
    if (response.ok) setUsers((await response.json()).users);
  }
  useEffect(() => {
    void load();
  }, []);
  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setErr((await response.json()).error || "Gagal");
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function addUser() {
    if (!form.email || !form.name || !form.password) {
      setErr("Lengkapi semua field");
      return;
    }
    if (form.role === "cs" && !form.csName) {
      setErr("Pilih CS untuk akun ini");
      return;
    }
    if (await post({ action: "create", ...form }))
      setForm({ email: "", name: "", role: "cs", password: "", csName: "" });
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tim</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Failure>{err}</Failure>
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.email}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {user.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({user.role})
                      </span>
                      {user.role === "cs" && (
                        <span
                          className={cn(
                            "ml-1 text-xs",
                            user.csName ? "text-primary" : "text-amber-600",
                          )}
                        >
                          ·{" "}
                          {user.csName
                            ? `CS ${user.csName}`
                            : "belum di-assign"}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.email}
                      {!user.isActive && " — nonaktif"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {user.role === "cs" && (
                      <>
                        <label
                          htmlFor={`assign-${user.email}`}
                          className="sr-only"
                        >
                          Assign CS untuk {user.email}
                        </label>
                        <select
                          id={`assign-${user.email}`}
                          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                          value={user.csName ?? ""}
                          disabled={busy}
                          onChange={(event) =>
                            void post({
                              action: "update",
                              email: user.email,
                              csName: event.target.value,
                            })
                          }
                        >
                          <option value="">— pilih CS —</option>
                          {csOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          email: user.email,
                          action: "rename",
                          value: user.name,
                        })
                      }
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setEditing({
                          email: user.email,
                          action: "reset",
                          value: "",
                        })
                      }
                    >
                      Reset
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void post({
                          action: "setActive",
                          email: user.email,
                          isActive: !user.isActive,
                        })
                      }
                    >
                      {user.isActive ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(user.email)}
                    >
                      Hapus
                    </Button>
                  </div>
                </div>
                {editing?.email === user.email && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <div className="min-w-48 flex-1 space-y-1">
                      <label
                        htmlFor={`edit-${user.email}`}
                        className="text-xs font-medium"
                      >
                        {editing.action === "rename"
                          ? "Nama baru"
                          : "Password baru"}
                      </label>
                      <input
                        id={`edit-${user.email}`}
                        type={editing.action === "reset" ? "password" : "text"}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        value={editing.value}
                        onChange={(event) =>
                          setEditing({ ...editing, value: event.target.value })
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      disabled={busy || !editing.value.trim()}
                      onClick={async () => {
                        const ok = await post(
                          editing.action === "rename"
                            ? {
                                action: "update",
                                email: user.email,
                                name: editing.value.trim(),
                              }
                            : {
                                action: "reset",
                                email: user.email,
                                password: editing.value,
                              },
                        );
                        if (ok) setEditing(null);
                      }}
                    >
                      Simpan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Batal
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="new-user-name" className="text-sm font-medium">
                Nama
              </label>
              <input
                id="new-user-name"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-user-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="new-user-email"
                type="email"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-user-role" className="text-sm font-medium">
                Peran
              </label>
              <select
                id="new-user-role"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={form.role}
                onChange={(event) =>
                  setForm({
                    ...form,
                    role: event.target.value as "admin" | "cs",
                  })
                }
              >
                <option value="cs">CS</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {form.role === "cs" && (
              <div className="space-y-1">
                <label htmlFor="new-user-cs" className="text-sm font-medium">
                  CS
                </label>
                <select
                  id="new-user-cs"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={form.csName}
                  onChange={(event) =>
                    setForm({ ...form, csName: event.target.value })
                  }
                >
                  <option value="">— assign ke CS —</option>
                  {csOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <label
                htmlFor="new-user-password"
                className="text-sm font-medium"
              >
                Password awal
              </label>
              <input
                id="new-user-password"
                type="password"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
              />
            </div>
            <Button
              disabled={busy}
              onClick={() => void addUser()}
              className="sm:col-span-2"
            >
              Tambah user
            </Button>
          </div>
        </CardContent>
      </Card>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus user?</AlertDialogTitle>
            <AlertDialogDescription>
              User yang dihapus tidak dapat dipulihkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={() => {
                if (deleting) void post({ action: "delete", email: deleting });
                setDeleting(null);
              }}
            >
              Hapus user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const setBerduStaffIds = useMutation(api.csConfigs.setBerduStaffIds);
  const setNameAliases = useMutation(api.agents.setNameAliases);
  const [section, setSection] = useState<SettingsSection>("account");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    name: string;
    value: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; role: "admin" | "cs" } | null>(
    null,
  );
  useEffect(() => {
    fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  const isCs = me?.role === "cs";
  const sections = isCs ? SETTINGS_SECTIONS.slice(0, 1) : SETTINGS_SECTIONS;
  useEffect(() => {
    if (isCs) setSection("account");
  }, [isCs]);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }
  async function withCsBusy(csName: string, task: () => Promise<unknown>) {
    setBusy(csName);
    setErr(null);
    try {
      await task();
    } catch (error) {
      setErr(
        `${csName}: ${error instanceof Error ? error.message : "Gagal menyimpan"}`,
      );
    } finally {
      setBusy(null);
    }
  }
  async function onPick(file: File, csName: string) {
    await withCsBusy(csName, async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("Maksimal 8 MB");
      const blob = await resizeImage(file);
      const url = await genUrl({});
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!response.ok) throw new Error("Upload gagal");
      await setAvatar({ csName, storageId: (await response.json()).storageId });
    });
  }
  async function saveRename() {
    if (
      !renaming ||
      !renaming.value.trim() ||
      renaming.value.trim() === renaming.name
    )
      return;
    const current = renaming;
    await withCsBusy(current.name, async () => {
      const result = await renameCs({
        fromCsName: current.name,
        toCsName: current.value.trim(),
      });
      if (!result.ok) throw new Error(result.error);
      setRenaming(null);
    });
  }
  async function saveDelete() {
    if (!deleting) return;
    const csName = deleting;
    await withCsBusy(csName, async () => {
      const result = await deleteCsConfig({ csName });
      if (!result.ok) throw new Error(result.error);
      setDeleting(null);
    });
  }
  function onToggle(
    cs: CsRow,
    field: keyof Omit<CsRow, "csName" | "csPhone">,
    value: boolean,
  ) {
    void withCsBusy(cs.csName, async () => {
      await upsert({
        csName: cs.csName,
        csPhone: cs.csPhone,
        orderAutomationEnabled: cs.orderAutomationEnabled,
        aiAssistantEnabled: cs.aiAssistantEnabled,
        reportingEnabled: cs.reportingEnabled,
        autoFollowUpEnabled: cs.autoFollowUpEnabled ?? undefined,
        isActive: cs.isActive,
        [field]: value,
      });
    });
  }
  return (
    <div className="space-y-6">
      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        aria-label="Bagian pengaturan"
      >
        {sections.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={section === item.value}
            onClick={() => setSection(item.value)}
            className={cn(
              "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors",
              section === item.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === "account" && (
        <section aria-labelledby="settings-account">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle id="settings-account" className="text-base">
                Akun
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {me?.name ?? "—"}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {me?.role ?? ""}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => void logout()}
                className="shrink-0"
              >
                <LogOut className="size-4" /> Keluar
              </Button>
            </CardContent>
          </Card>
        </section>
      )}
      {!isCs && section === "organization" && (
        <section aria-labelledby="settings-organization">
          <h2 id="settings-organization" className="sr-only">
            Organisasi
          </h2>
          <OrgSection />
        </section>
      )}
      {!isCs && section === "team" && (
        <section aria-labelledby="settings-team">
          <h2 id="settings-team" className="sr-only">
            Tim
          </h2>
          <TeamSection />
        </section>
      )}
      {!isCs && section === "cs" && (
        <section aria-labelledby="settings-cs" className="space-y-4">
          <h2 id="settings-cs" className="sr-only">
            Konfigurasi CS
          </h2>
          <Failure>{err}</Failure>
          {csList.map((cs) => (
            <details
              key={cs.key}
              className="rounded-xl border border-border bg-card"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-3">
                <CsAvatar
                  name={cs.csName}
                  size="md"
                  src={cs.avatarUrl ?? undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {cs.csName}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    #{cs.registryKey ?? cs.key}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Atur</span>
              </summary>
              <div className="space-y-4 border-t border-border p-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === cs.csName}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (event) => {
                        const file = (event.target as HTMLInputElement)
                          .files?.[0];
                        if (file) void onPick(file, cs.csName);
                      };
                      input.click();
                    }}
                  >
                    <Upload className="size-4" />
                    {busy === cs.csName
                      ? "Memproses..."
                      : cs.avatarUrl
                        ? "Ganti foto"
                        : "Upload foto"}
                  </Button>
                  {cs.avatarUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === cs.csName}
                      onClick={() =>
                        void withCsBusy(cs.csName, () =>
                          clearAvatar({ csName: cs.csName }),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                      Hapus foto
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === cs.csName}
                    onClick={() =>
                      setRenaming({ name: cs.csName, value: cs.csName })
                    }
                  >
                    <Pencil className="size-4" />
                    Ganti nama
                  </Button>
                </div>
                {cs.csPhone && (
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      WhatsApp
                    </div>
                    <div className="font-mono text-sm">{cs.csPhone}</div>
                  </div>
                )}
                <div className="grid gap-3 lg:grid-cols-2">
                  <CsvField
                    csName={cs.csName}
                    initial={cs.berduStaffIds ?? []}
                    disabled={busy === cs.csName}
                    label="Berdu Staff IDs"
                    placeholder="B-xxxxx, B-yyyyy"
                    save={(berduStaffIds) =>
                      setBerduStaffIds({ csName: cs.csName, berduStaffIds })
                    }
                  />
                  <CsvField
                    csName={cs.csName}
                    initial={cs.nameAliases ?? []}
                    disabled={busy === cs.csName}
                    label="Alias nama"
                    placeholder="CS Aisyah, Kak Aisyah"
                    save={(nameAliases) =>
                      setNameAliases({ csName: cs.csName, nameAliases })
                    }
                  />
                </div>
                <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  {CS_TOGGLES.map(({ icon: Icon, label, field }) => (
                    <div
                      key={field}
                      className="flex min-h-11 items-center justify-between gap-3"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="size-4 text-muted-foreground" />
                        {label}
                      </span>
                      <Switch
                        checked={Boolean(cs[field])}
                        onCheckedChange={(value) => onToggle(cs, field, value)}
                        disabled={busy === cs.csName}
                      />
                    </div>
                  ))}
                </div>
                <div className="border-t border-destructive/20 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === cs.csName}
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(cs.csName)}
                  >
                    <Trash2 className="size-4" />
                    Hapus CS
                  </Button>
                </div>
              </div>
            </details>
          ))}
          {csList.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Belum ada CS terdaftar.
            </div>
          )}
        </section>
      )}
      <AlertDialog
        open={Boolean(renaming)}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ganti nama CS</AlertDialogTitle>
            <AlertDialogDescription>
              Nama baru akan dipakai untuk konfigurasi CS ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label htmlFor="rename-cs" className="text-sm font-medium">
            Nama CS
          </label>
          <input
            id="rename-cs"
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            value={renaming?.value ?? ""}
            onChange={(event) =>
              setRenaming((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busy) || !renaming?.value.trim()}
              onClick={() => void saveRename()}
            >
              Simpan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus CS?</AlertDialogTitle>
            <AlertDialogDescription>
              Data laporan lama tidak terhapus, tetapi konfigurasi ini tidak
              dapat dipulihkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={Boolean(busy)}
              onClick={() => void saveDelete()}
            >
              Hapus CS
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
