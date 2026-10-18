/** ipc.test.ts —— unix socket JSON 通道（D-Bus 的降级/并行通道）+ 信号广播不崩 */
import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveIpc, socketCall, DBUS_NAME, DBUS_PATH } from "../src/ipc.js";

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe("IPC", () => {
  it("socket 通道 Get/Apply/Reload 往返；D-Bus 起不来时如实降级 socket-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentos-ipc-"));
    tmps.push(dir);
    const sock = join(dir, "agentos-settings.sock");
    let appliedVariant = "";
    const ipc = await serveIpc(
      {
        getDarkMode: () => true,
        getPaletteVariant: () => "dark",
        apply: async (v) => {
          appliedVariant = v;
          return { ok: true };
        },
        reload: async () => ({ ok: true }),
      },
      sock,
    );
    expect(["dbus+socket", "socket-only"]).toContain(ipc.transport);

    const got = (await socketCall(sock, "Get")) as { ok: boolean; darkMode: boolean; paletteVariant: string };
    expect(got).toEqual({ ok: true, darkMode: true, paletteVariant: "dark" });

    const applied = (await socketCall(sock, "Apply", { variant: "light" })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    expect(appliedVariant).toBe("light");

    const reloaded = (await socketCall(sock, "Reload")) as { ok: boolean };
    expect(reloaded.ok).toBe(true);

    ipc.emitChanged("dark"); // D-Bus 不可用时 no-op，不应抛
    await ipc.close();
    await expect(socketCall(sock, "Get")).rejects.toThrow();
  });

  it("D-Bus 常量即规格（org.agentos.Settings @ /org/agentos/settings）", () => {
    expect(DBUS_NAME).toBe("org.agentos.Settings");
    expect(DBUS_PATH).toBe("/org/agentos/settings");
  });
});
