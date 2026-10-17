import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  DEFAULT_AUDIT_PATH,
  DEFAULT_RECORDINGS_DIR,
  listRecordings,
  readAudit,
} from "./replay.js";
import { replayPageHtml } from "./replay-page.js";

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
 * 只绑 127.0.0.1；所有文件路径经 realpath 越界检查（与 files-mcp 同款沙箱纪律）。
 * agent 的使用方式：files__write_file("canvas/<名字>/index.html", ...) 然后
 * desktop__open("http://127.0.0.1:7788/<名字>/")。
 */
export function createCanvasServer(
  rootRaw: string,
  opts: { auditPath?: string; recordingsDir?: string } = {},
): http.Server {
  fs.mkdirSync(rootRaw, { recursive: true });
  const root = fs.realpathSync(rootRaw);
  const auditPath = opts.auditPath ?? process.env["AGENTOS_AUDIT_PATH"] ?? DEFAULT_AUDIT_PATH;
  const recordingsDir = opts.recordingsDir ?? DEFAULT_RECORDINGS_DIR;

  const safe = (relUrl: string): string | null => {
    // URL 路径以 / 开头，path.resolve 会把它当绝对路径丢弃 root，必须先剥掉
    const rel = relUrl.replace(/^\/+/, "");
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) return null;
    const real = fs.realpathSync(abs);
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    return real;
  };

  return http.createServer((req, res) => {
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
</style></head><body>
<h1>AgentOS Canvas</h1>
<p style="color:#9aa0aa;font-size:13px">agent 生成的页面会出现在这里。写入方式：canvas/&lt;名字&gt;/index.html</p>
${rows.length === 0 ? '<p class="empty">还没有任何 artifact。</p>' : `<table><tr><th>名称</th><th>大小</th><th>更新时间</th></tr>${items}</table>`}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
