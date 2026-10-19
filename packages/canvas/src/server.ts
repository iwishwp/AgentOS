import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { CommandRunner } from "@agentos/proc";
import { ShellRunner } from "@agentos/proc";
import {
  DEFAULT_AUDIT_PATH,
  DEFAULT_RECORDINGS_DIR,
  listRecordings,
  readAudit,
} from "./replay.js";
import { replayPageHtml } from "./replay-page.js";
import { DEFAULT_NIRI_CONFIG, readKeys } from "./keys.js";
import { DEFAULT_COLORS_JSON, keysPageHtml, loadColors } from "./keys-page.js";
import { DEFAULT_WORKSPACE, listArtifacts, resolveInsideWorkspace } from "./artifacts.js";
import { artifactsPageHtml } from "./artifacts-page.js";
import { settingsPageHtml } from "./settings-page.js";
import {
  AGENTOS_UNITS,
  applyAppearance,
  listSnapshots,
  probeSettingsDaemon,
  readSettingsState,
  readUnitStates,
  runStateExport,
  settingsPaths,
  type AppearanceVariant,
} from "./settings.js";
import {
  DEFAULT_CRED_POLICY_PATH,
  listCredentials,
  registerGuide,
  revokeCredential,
} from "./credentials.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".fodt": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".zip": "application/zip",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

/**
 * canvas 静态服务：托管 ~/Agent/canvas 下 agent 生成的页面，附带 M4 回放面：
 *   /api/audit?tool=&ext=&decision=&tier=&since=&limit=  审计时间轴 JSON（出口侧打码兜底）
 *   /api/recordings                                        会话录像清单
 *   /recordings/<name>                                     录像播放（Range 支持）
 *   /replay                                                回放页（时间轴 + 录像）
 *   /api/keys                                              键位表 JSON（实时解析 niri config.kdl binds 段）
 *   /keys                                                  键位速查页（Super+K 的落点，莫兰迪配色）
 *   /api/artifacts                                         全类型产物索引 JSON（扫描整个工作区，M2）
 *   /api/artifacts/file?path=&mode=view|download           产物在线看/下载（工作区 realpath 沙箱）
 *   /artifacts                                             产物索引页（网页在线看/文档 agent 打开/数据下载）
 *   /api/settings/appearance   [GET/POST]                   外观状态快照 / 切换（POST 经 settings-daemon CLI）
 *   /api/settings/system                                    systemd user 单元状态 + snapper 快照列表
 *   /api/credentials           [GET]                        凭据清单（零明文：只有引用/策略/存在性/最近使用）
 *   /api/credentials/revoke    [POST]                       吊销（keyring clear + 策略摘除 + 审计）
 *   /api/settings/migrate/export[POST]                      状态导出（scripts/agentos-state-export.sh）
 *   /settings                                               AgentOS 系统设置页（外观/凭据/系统/迁移）
 * 只绑 127.0.0.1；所有文件路径经 realpath 越界检查（与 files-mcp 同款沙箱纪律）。
 * agent 的使用方式：files__write_file("canvas/<名字>/index.html", ...) 然后
 * desktop__open("http://127.0.0.1:7788/<名字>/")。
 */
export function createCanvasServer(
  rootRaw: string,
  opts: {
    auditPath?: string;
    recordingsDir?: string;
    niriConfigPath?: string;
    colorsPath?: string;
    workspaceDir?: string;
    /** /settings 面的注入点（缺省走 settingsPaths() 的 env/约定解析） */
    runner?: CommandRunner;
    stateFile?: string;
    settingsSocket?: string;
    settingsCli?: string;
    snapshotScript?: string;
    exportScript?: string;
    credPolicyPath?: string;
    secretToolBin?: string;
  } = {},
): http.Server {
  fs.mkdirSync(rootRaw, { recursive: true });
  const root = fs.realpathSync(rootRaw);
  const auditPath = opts.auditPath ?? process.env["AGENTOS_AUDIT_PATH"] ?? DEFAULT_AUDIT_PATH;
  const recordingsDir = opts.recordingsDir ?? DEFAULT_RECORDINGS_DIR;
  const niriConfigPath = opts.niriConfigPath ?? process.env["AGENTOS_NIRI_CONFIG"] ?? DEFAULT_NIRI_CONFIG;
  const colorsPath = opts.colorsPath ?? process.env["AGENTOS_COLORS_JSON"] ?? DEFAULT_COLORS_JSON;
  // 产物索引的扫描范围 = files 扩展的工作区（同一 AGENTOS_WORKSPACE 约定）
  const workspaceDir = opts.workspaceDir ?? process.env["AGENTOS_WORKSPACE"] ?? DEFAULT_WORKSPACE;
  // /settings 面：读状态 + 起子进程（编排仍在 settings-daemon/scripts，canvas 只是壳）
  const runner = opts.runner ?? new ShellRunner();
  const paths = settingsPaths();
  const stateFile = opts.stateFile ?? paths.stateFile;
  const settingsSocket = opts.settingsSocket ?? paths.socketPath;
  const settingsCli = opts.settingsCli ?? paths.settingsCli;
  const snapshotScript = opts.snapshotScript ?? paths.snapshotScript;
  const exportScript = opts.exportScript ?? paths.exportScript;
  const credPolicyPath = opts.credPolicyPath ?? DEFAULT_CRED_POLICY_PATH;
  const secretToolBin = opts.secretToolBin ?? process.env["SECRET_TOOL_BIN"] ?? "secret-tool";

  const safe = (relUrl: string): string | null => {
    // URL 路径以 / 开头，path.resolve 会把它当绝对路径丢弃 root，必须先剥掉
    const rel = relUrl.replace(/^\/+/, "");
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) return null;
    const real = fs.realpathSync(abs);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    return real;
  };

  return http.createServer(async (req, res) => {
    // ---- 写操作（/settings 面的按钮）：POST 白名单，其余方法照旧 405 ----
    if (req.method === "POST") {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      } catch {
        res.writeHead(400).end("bad url");
        return;
      }
      if (pathname === "/api/settings/appearance") {
        handleAppearanceApply(req, res);
        return;
      }
      if (pathname === "/api/credentials/revoke") {
        handleCredentialRevoke(req, res);
        return;
      }
      if (pathname === "/api/settings/migrate/export") {
        handleMigrateExport(req, res);
        return;
      }
      res.writeHead(405).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    let pathname: string;
    let query: URLSearchParams;
    try {
      const u = new URL(req.url ?? "/", "http://localhost");
      pathname = decodeURIComponent(u.pathname);
      query = u.searchParams;
    } catch {
      res.writeHead(400).end("bad url");
      return;
    }

    // ---- 回放面（内置路由，先于静态文件） ----
    if (pathname === "/api/audit") {
      const num = (k: string) => (query.get(k) ? Number(query.get(k)) : undefined);
      const entries = readAudit(auditPath, {
        tool: query.get("tool") ?? undefined,
        ext: query.get("ext") ?? undefined,
        decision: query.get("decision") ?? undefined,
        tier: query.get("tier") ?? undefined,
        since: query.get("since") ?? undefined,
        limit: num("limit"),
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(entries));
      return;
    }
    if (pathname === "/api/recordings") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(listRecordings(recordingsDir)));
      return;
    }
    if (pathname === "/replay" || pathname === "/replay/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(replayPageHtml());
      return;
    }
    if (pathname.startsWith("/recordings/")) {
      serveRecording(pathname, req, res);
      return;
    }

    // ---- 键位速查面（Super+K 的落点；数据实时解析 niri 配置，无手工副本） ----
    if (pathname === "/api/keys") {
      try {
        const sections = readKeys(niriConfigPath);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(sections));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (pathname === "/keys" || pathname === "/keys/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(keysPageHtml(loadColors(colorsPath)));
      return;
    }

    // ---- 产物索引面（M2 收尾：全类型统一索引，不只 canvas 的 HTML） ----
    if (pathname === "/api/artifacts") {
      try {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(listArtifacts(workspaceDir)));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (pathname.startsWith("/api/artifacts/file")) {
      serveArtifactFile(pathname, query, req, res);
      return;
    }
    if (pathname === "/artifacts" || pathname === "/artifacts/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(artifactsPageHtml(colorsPath));
      return;
    }

    // ---- 设置面（AgentOS 自己的系统设置：外观/凭据/系统/迁移） ----
    if (pathname === "/api/settings/appearance") {
      const state = readSettingsState(stateFile);
      const daemon = await probeSettingsDaemon(settingsSocket);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ state, stateFile, daemon }));
      return;
    }
    if (pathname === "/api/settings/system") {
      try {
        const units = await readUnitStates(runner, AGENTOS_UNITS);
        const snaps = await listSnapshots(runner, snapshotScript);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ units, snapshots: snaps.snapshots, snapshotsError: snaps.error }));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (pathname === "/api/credentials") {
      try {
        const credentials = await listCredentials({ runner, policyPath: credPolicyPath, auditPath, secretTool: secretToolBin });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        // 零明文：这里只有引用/标签/通道/白名单/存在性/最近使用，永远没有值
        res.end(JSON.stringify({ credentials, policyPath: credPolicyPath, registerGuide: registerGuide("~/AgentOS/scripts/cred-store.sh") }));
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (pathname === "/settings" || pathname === "/settings/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(settingsPageHtml(loadColors(colorsPath)));
      return;
    }

    if (pathname === "/" || pathname === "") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(indexPage(root));
      return;
    }
    let file = safe(pathname);
    if (file && fs.statSync(file).isDirectory()) {
      file = safe(path.posix.join(pathname, "index.html"));
    }
    if (!file || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    serveFile(file, req, res);

    /** 产物沙箱：工作区内任意类型文件的在线看/下载（realpath 越界检查 + .trash 排除） */
    function serveArtifactFile(
      p: string,
      query: URLSearchParams,
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void {
      const rel = query.get("path") ?? "";
      const abs = resolveInsideWorkspace(workspaceDir, rel);
      // 只服务真实存在的普通文件（目录/socket/不存在一律 404，不泄漏存在性差异）
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      // .trash 里的东西是"已删除待恢复"，不作出网产物（隐藏文件同理）
      const relInside = path.relative(fs.realpathSync(workspaceDir), abs);
      if (relInside.split(path.sep).some((seg) => seg.startsWith(".") || seg === "node_modules")) {
        response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        response.end("forbidden");
        return;
      }
      const name = path.basename(abs);
      const type = MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      const disposition =
        query.get("mode") === "download"
          ? `attachment; filename="${asciiSafe(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
          : "inline";
      response.writeHead(200, { "content-type": type, "content-disposition": disposition, "cache-control": "no-cache" });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(abs).pipe(response);
    }

    /** 录像沙箱：仅 recordings 目录内的媒体文件（同样的 realpath 纪律） */
    function serveRecording(p: string, request: http.IncomingMessage, response: http.ServerResponse): void {
      const name = path.basename(p.replace(/^\/+/, ""));
      const abs = path.resolve(recordingsDir, name);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
        return;
      }
      const real = fs.realpathSync(abs);
      const dirReal = fs.realpathSync(recordingsDir);
      if (real !== dirReal && !real.startsWith(dirReal + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      if (!/\.(mkv|webm|mp4)$/i.test(name)) {
        response.writeHead(403).end();
        return;
      }
      serveFile(real, request, response);
    }

    /** POST body：小 JSON（上限 64KB——写面只有 variant/ref/withSecrets 几个键） */
    function readJsonBody(request: http.IncomingMessage, limit = 65536): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (d: Buffer) => {
          body += d.toString("utf8");
          if (body.length > limit) {
            request.destroy();
            reject(new Error("body 超限"));
          }
        });
        request.on("end", () => {
          try {
            const parsed = body ? (JSON.parse(body) as unknown) : {};
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new Error("body 必须是 JSON 对象");
            }
            resolve(parsed as Record<string, unknown>);
          } catch (e) {
            reject(e instanceof Error ? e : new Error("body 不是合法 JSON"));
          }
        });
        request.on("error", reject);
      });
    }

    /** 外观切换：canvas 只起 settings-daemon CLI 子进程，编排（五桥+热重载）仍在 daemon */
    async function handleAppearanceApply(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch (e) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, detail: e instanceof Error ? e.message : "bad body" }));
        return;
      }
      const variant = body["variant"];
      if (variant !== "dark" && variant !== "light") {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, detail: "variant 须为 dark|light" }));
        return;
      }
      const r = await applyAppearance(runner, settingsCli, stateFile, variant as AppearanceVariant);
      const daemon = await probeSettingsDaemon(settingsSocket);
      response.writeHead(r.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ ...r, daemon }));
    }

    /** 凭据吊销：keyring 条目 + 策略条目 + 审计（顺序见 credentials.ts，全程零明文） */
    async function handleCredentialRevoke(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(request);
      } catch (e) {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "bad body" }));
        return;
      }
      const ref = body["ref"];
      if (typeof ref !== "string" || ref === "") {
        response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false, error: "ref 不能为空" }));
        return;
      }
      const r = await revokeCredential(
        { runner, policyPath: credPolicyPath, auditPath, secretTool: secretToolBin },
        ref,
      );
      response.writeHead(r.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(r));
    }

    /** 迁移导出：复用 scripts/agentos-state-export.sh（only-if-absent 导入在目标机跑脚本） */
    async function handleMigrateExport(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
      let body: Record<string, unknown> = {};
      try {
        body = await readJsonBody(request);
      } catch {
        body = {}; // 空体/空 body 即默认导出
      }
      const withSecrets = body["withSecrets"] === true;
      const r = await runStateExport(runner, exportScript, withSecrets);
      response.writeHead(r.ok ? 200 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify(r));
    }
  });

  /** 静态文件 + 视频 Range 支持（HTML5 video 拖动进度条需要 206） */
  function serveFile(file: string, request: http.IncomingMessage, response: http.ServerResponse): void {
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const size = fs.statSync(file).size;
    const range = request.headers.range;
    if (range && /^video\//.test(type)) {
      const m = /bytes=(\d*)-(\d*)/.exec(String(range));
      if (m) {
        let start = m[1] ? Number(m[1]) : 0;
        let end = m[2] ? Number(m[2]) : size - 1;
        if (Number.isNaN(start) || start >= size) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        response.writeHead(206, {
          "content-type": type,
          "content-range": `bytes ${start}-${end}/${size}`,
          "accept-ranges": "bytes",
          "content-length": end - start + 1,
          "cache-control": "no-cache",
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        fs.createReadStream(file, { start, end }).pipe(response);
        return;
      }
    }
    response.writeHead(200, {
      "content-type": type,
      "cache-control": "no-cache",
      ...(type.startsWith("video/") ? { "accept-ranges": "bytes" } : {}),
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(file).pipe(response);
  }
}

interface ArtifactRow {
  name: string;
  mtime: Date;
  size: number;
  href: string;
}

/** 索引页：列出 canvas 下的目录型 artifacts 与散装 html 文件。 */
function indexPage(root: string): string {
  const rows: ArtifactRow[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      const idx = path.join(full, "index.html");
      if (fs.existsSync(idx)) {
        rows.push({
          name: e.name,
          mtime: fs.statSync(idx).mtime,
          size: fs.statSync(idx).size,
          href: `/${encodeURIComponent(e.name)}/`,
        });
      }
    } else if (e.isFile() && e.name.endsWith(".html")) {
      rows.push({
        name: e.name,
        mtime: fs.statSync(full).mtime,
        size: fs.statSync(full).size,
        href: `/${encodeURIComponent(e.name)}`,
      });
    }
  }
  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const items = rows
    .map(
      (r) =>
        `<tr><td><a href="${r.href}">${escapeHtml(r.name)}</a></td><td>${r.size} B</td><td>${r.mtime.toLocaleString("zh-CN")}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS Canvas</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111318;color:#e6e6e6;max-width:720px;margin:40px auto;padding:0 16px}
  h1{font-size:20px;color:#8ab4f8} table{width:100%;border-collapse:collapse;margin-top:16px}
  td,th{padding:8px 10px;border-bottom:1px solid #262a33;text-align:left;font-size:14px}
  a{color:#8ab4f8;text-decoration:none} a:hover{text-decoration:underline}
  th{color:#9aa0aa;font-weight:500} .empty{color:#777;margin-top:24px}
  nav{font-size:13px;color:#9aa0aa;margin-top:8px} nav a{margin-right:14px}
</style></head><body>
<h1>AgentOS Canvas</h1>
<nav>
  <a href="/artifacts">产物索引（全类型）</a><a href="/keys">键位速查</a><a href="/replay">审计回放</a><a href="/settings">AgentOS 设置</a>
</nav>
<p style="color:#9aa0aa;font-size:13px">agent 生成的页面会出现在这里。写入方式：canvas/&lt;名字&gt;/index.html</p>
${rows.length === 0 ? '<p class="empty">还没有任何 artifact。</p>' : `<table><tr><th>名称</th><th>大小</th><th>更新时间</th></tr>${items}</table>`}
</body></html>`;
}

/** RFC 6266 兜底文件名（非 ASCII 置空，filename* 才是主通道） */
function asciiSafe(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
