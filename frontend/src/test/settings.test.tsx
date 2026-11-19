import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SettingsDialog, validateDelayMs } from "../components/SettingsDialog";
import { setAdminPassword } from "../lib/admin";

describe("validateDelayMs", () => {
  it("accepts 100 ms and up, with from <= to", () => {
    expect(validateDelayMs(1, 250)).toBeNull();
    expect(validateDelayMs(500, 1000)).toBeNull();
    expect(validateDelayMs(0, 1000)).toMatch(/1 ms/);
    expect(validateDelayMs(800, 500)).toMatch(/at least/);
    expect(validateDelayMs(NaN, 500)).toMatch(/Enter/);
    expect(validateDelayMs(100, 70_000)).toMatch(/60000/);
  });
});

describe("SettingsDialog", () => {
  const groups = [
    { id: "LON", name: "London", airports: ["LHR", "LGW"], enabled: true },
    { id: "LPL", name: "Liverpool", airports: ["LPL"], enabled: false },
  ];
  const settings = {
    ttl_days: 2,
    provider_mode: "auto",
    serpapi_monthly_cap: 230,
    concurrency: 2,
    delay_seconds: [0.5, 1],
  };
  const status = {
    admin_protected: false,
    providers: { serpapi: { available: true }, fast_flights: {} },
    serpapi_usage: { used: 16, cap: 230 },
  };
  const calls: { url: string; method: string; body?: unknown; admin?: string }[] = [];

  beforeAll(() => {
    // jsdom has no <dialog> modal support.
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  });

  afterEach(() => {
    calls.length = 0;
    setAdminPassword(null);
    vi.unstubAllGlobals();
  });

  function setup({ adminProtected = false, password = "s3cret" } = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        const admin = (init?.headers as Record<string, string> | undefined)?.["X-Admin-Password"];
        calls.push({ url, method, body, admin });
        if (url.includes("admin/check")) {
          return new Response(JSON.stringify({ detail: "wrong admin password" }), {
            status: admin === password ? 200 : 401,
          });
        }
        if (url.includes("status")) {
          return new Response(JSON.stringify({ ...status, admin_protected: adminProtected }), { status: 200 });
        }
        const data = url.includes("/groups")
          ? groups
          : url.includes("status")
            ? status
            : method === "PUT"
              ? { ...settings, ...body }
              : settings;
        return new Response(JSON.stringify(data), { status: 200 });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SettingsDialog open onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("shows delays in ms and saves them in seconds along with city changes", async () => {
    setup();
    const min = await screen.findByLabelText("Minimum delay (ms)");
    expect(min).toHaveValue(500);
    expect(screen.getByLabelText("Maximum delay (ms)")).toHaveValue(1000);

    fireEvent.change(min, { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Maximum delay (ms)"), { target: { value: "300" } });
    fireEvent.click(await screen.findByLabelText(/Liverpool/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/groups"))).toBe(true));
    const put = calls.find((c) => c.url.endsWith("/settings") && c.method === "PUT");
    expect((put?.body as { delay_seconds: number[] }).delay_seconds).toEqual([0.1, 0.3]);
    const groupsPut = calls.find((c) => c.url.endsWith("/groups") && c.method === "PUT");
    expect(groupsPut?.body).toEqual({ enabled: ["LON", "LPL"] });
  });

  it("blocks saving an invalid delay or no cities", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("Minimum delay (ms)"), { target: { value: "0" } });
    expect(screen.getByText(/Minimum delay is 1 ms/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Minimum delay (ms)"), { target: { value: "500" } });
    fireEvent.click(await screen.findByLabelText(/London/));
    expect(screen.getByText(/at least one Turkey airport/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("is read-only on a password-protected site until unlocked", async () => {
    setup({ adminProtected: true });
    await screen.findByLabelText("Admin password");
    const min = await screen.findByLabelText("Minimum delay (ms)");
    expect(min).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Wrong password.")).toBeInTheDocument();
    expect(min).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Admin password"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText(/Admin mode/);
    expect(min).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.admin).toBe("s3cret");
  });
});
