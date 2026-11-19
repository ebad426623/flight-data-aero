import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAllTurkeyGroups, useSettings, useStatus } from "../hooks/queries";
import { setAdminPassword, useAdminPassword } from "../lib/admin";
import { api, ApiError } from "../lib/api";
import type { AppSettings, ProviderMode } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onExpireAll?: () => void;
  onClearCache?: () => void;
}

/** Delay limits, matching backend validation (0.001–60 s). */
export const MIN_DELAY_MS = 1;
export const MAX_DELAY_MS = 60_000;

export function validateDelayMs(minMs: number, maxMs: number): string | null {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return "Enter both delays in milliseconds.";
  if (minMs < MIN_DELAY_MS) return `Minimum delay is ${MIN_DELAY_MS} ms.`;
  if (maxMs > MAX_DELAY_MS) return `Maximum delay is ${MAX_DELAY_MS} ms.`;
  if (maxMs < minMs) return "The 'to' delay must be at least the 'from' delay.";
  return null;
}

const toMs = (s: number) => Math.round(s * 1000);

const MODES: { value: ProviderMode; label: string; help: string }[] = [
  { value: "auto", label: "Auto", help: "fast-flights first; SerpApi for 30 min after 3 failures." },
  { value: "fast_flights", label: "fast-flights only", help: "Free, unofficial Google Flights scraper." },
  { value: "serpapi", label: "SerpApi only", help: "Uses the SerpApi quota, never beyond the cap." },
];

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="inline-block shrink-0">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={open ? "M8 11V7a4 4 0 0 1 7.5-2" : "M8 11V7a4 4 0 0 1 8 0v4"} />
    </svg>
  );
}

function AdminUnlock({ unlocked }: { unlocked: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (unlocked) {
    return (
      <div className="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <span className="flex items-center gap-1.5">
          <LockIcon open /> Admin mode: you can change settings.
        </span>
        <button type="button" className="text-xs underline" onClick={() => setAdminPassword(null)}>
          Lock
        </button>
      </div>
    );
  }

  const unlock = async () => {
    setChecking(true);
    setError(null);
    try {
      await api.adminCheck(password);
      setAdminPassword(password);
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Wrong password." : "Could not check the password.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-md bg-slate-100 px-3 py-2 text-sm">
      <p className="flex gap-1.5 text-slate-600">
        <span className="mt-0.5">
          <LockIcon />
        </span>
        Settings are shared by everyone using this site. Enter the admin password to change them.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          aria-label="Admin password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (password) void unlock();
            }
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1"
          placeholder="Admin password"
        />
        <button
          type="button"
          disabled={!password || checking}
          onClick={() => void unlock()}
          className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-50"
        >
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function SettingsDialog({ open, onClose, onExpireAll, onClearCache }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: status } = useStatus();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [delayMs, setDelayMs] = useState<[number, number]>([500, 1000]);
  const { data: allGroups } = useAllTurkeyGroups(open);
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(new Set());
  const adminPassword = useAdminPassword();
  const protectedSite = status?.admin_protected ?? false;
  const locked = protectedSite && !adminPassword;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (open && settings) {
      setDraft(settings);
      setDelayMs([toMs(settings.delay_seconds[0]), toMs(settings.delay_seconds[1])]);
    }
  }, [open, settings]);

  useEffect(() => {
    if (open && allGroups) setEnabledGroups(new Set(allGroups.filter((g) => g.enabled).map((g) => g.id)));
  }, [open, allGroups]);

  const delayError = validateDelayMs(delayMs[0], delayMs[1]);
  const groupsError = enabledGroups.size === 0 ? "Enable at least one Turkey airport." : null;
  const groupsChanged =
    !!allGroups && allGroups.some((g) => g.enabled !== enabledGroups.has(g.id));

  const save = useMutation({
    mutationFn: async (s: AppSettings) => {
      const saved = await api.putSettings({ ...s, delay_seconds: [delayMs[0] / 1000, delayMs[1] / 1000] });
      if (groupsChanged && allGroups) {
        await api.setGroups(allGroups.filter((g) => enabledGroups.has(g.id)).map((g) => g.id));
      }
      return saved;
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) setAdminPassword(null);
    },
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      void qc.invalidateQueries({ queryKey: ["groups"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
      void qc.invalidateQueries({ queryKey: ["week"] }); // expiry times / cities may have changed
      void qc.invalidateQueries({ queryKey: ["flights"] });
      onClose();
    },
  });

  const toggleGroup = (id: string) =>
    setEnabledGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const serpapiAvailable = status?.providers.serpapi.available ?? false;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto max-h-[90vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      {draft && (
        <form
          method="dialog"
          className="space-y-5 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <h2 className="text-lg font-semibold">Settings</h2>

          {protectedSite && <AdminUnlock unlocked={!locked} />}

          <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">

          <fieldset>
            <legend className="text-sm font-medium">Data provider</legend>
            <div className="mt-1 space-y-1">
              {MODES.map((m) => (
                <label key={m.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="provider_mode"
                    value={m.value}
                    checked={draft.provider_mode === m.value}
                    disabled={m.value === "serpapi" && !serpapiAvailable}
                    onChange={() => set("provider_mode", m.value)}
                    className="mt-1 accent-sky-600"
                  />
                  <span>
                    {m.label}
                    <span className="block text-xs text-slate-500">{m.help}</span>
                  </span>
                </label>
              ))}
            </div>
            {!serpapiAvailable && (
              <p className="mt-1 text-xs text-amber-700">
                SerpApi is unavailable: set SERPAPI_API_KEY (in .env, or the host's environment variables) and restart the server.
              </p>
            )}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="font-medium">SerpApi monthly cap</span>
              <input
                type="number"
                min={0}
                max={250}
                value={draft.serpapi_monthly_cap}
                onChange={(e) => set("serpapi_monthly_cap", Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
              {status && (
                <span className="text-xs text-slate-500">
                  SerpApi: {status.serpapi_usage.used} / 250 used this month
                </span>
              )}
            </label>
            <label className="block text-sm">
              <span className="font-medium">Concurrency</span>
              <input
                type="number"
                min={1}
                max={64}
                value={draft.concurrency}
                onChange={(e) => set("concurrency", Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              />
              <span className="text-xs text-slate-500">Parallel requests</span>
            </label>
            <div className="col-span-2 text-sm">
              <span className="font-medium">Delay between requests</span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_DELAY_MS}
                  max={MAX_DELAY_MS}
                  step={1}
                  aria-label="Minimum delay (ms)"
                  value={delayMs[0]}
                  onChange={(e) => setDelayMs([e.target.valueAsNumber, delayMs[1]])}
                  className="w-24 rounded border border-slate-300 px-2 py-1"
                />
                to
                <input
                  type="number"
                  min={MIN_DELAY_MS}
                  max={MAX_DELAY_MS}
                  step={1}
                  aria-label="Maximum delay (ms)"
                  value={delayMs[1]}
                  onChange={(e) => setDelayMs([delayMs[0], e.target.valueAsNumber])}
                  className="w-24 rounded border border-slate-300 px-2 py-1"
                />
                ms
              </span>
              <span className="block text-xs text-slate-500">
                A random delay in this range is used for each request (minimum {MIN_DELAY_MS} ms). It doubles
                after each fast-flights failure, up to 30 s.
              </span>
              {delayError && <span className="block text-xs text-rose-600">{delayError}</span>}
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Turkey airports</legend>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
              {allGroups?.map((g) => (
                <label key={g.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabledGroups.has(g.id)}
                    onChange={() => toggleGroup(g.id)}
                    className="mt-1 accent-sky-600"
                  />
                  <span>
                    {g.name}
                    <span className="block text-xs text-slate-500">{g.airports.join(", ")}</span>
                  </span>
                </label>
              ))}
            </div>
            {groupsError && <p className="mt-1 text-xs text-rose-600">{groupsError}</p>}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Cache</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => {
                  if (window.confirm("Mark all cached flights as expired and re-fetch the current view?")) {
                    onExpireAll?.();
                    onClose();
                  }
                }}
              >
                Refresh all cache
              </button>
              <button
                type="button"
                className="rounded border border-rose-300 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  if (window.confirm("Delete all cached flight data?")) {
                    onClearCache?.();
                    onClose();
                  }
                }}
              >
                Clear cache
              </button>
            </div>
            <span className="block text-xs text-slate-500">Applies to every route, not just this view.</span>
          </fieldset>

          </fieldset>

          {save.error && <p className="text-sm text-rose-600">Could not save: {save.error.message}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-slate-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={locked || save.isPending || !!delayError || !!groupsError}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
