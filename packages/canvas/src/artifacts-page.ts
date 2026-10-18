import { KIND_LABELS } from "./artifacts.js";
import { DEFAULT_COLORS_JSON, loadColors } from "./keys-page.js";

/**
 * /artifacts 产物索引页（M2 收尾）：全类型统一索引——网页在线看、文档/图片由
 * agent 桌面打开、数据/影音可下载。数据来自 /api/artifacts 实时扫描工作区，
 * 配色读 Noctalia colors.json（缺省降级），与 /keys 同一套页面骨架。
 */
export function artifactsPageHtml(colorsPath: string = DEFAULT_COLORS_JSON): string {
  const colors = loadColors(colorsPath);
  const cssVars = Object.entries(colors)
    .map(([k, v]) => `--${k.replace(/_/g, "-")}:${v}`)
    .join(";");
  const kindBadges = Object.entries(KIND_LABELS)
    .map(([k, label]) => `'${k}': '${label}'`)
    .join(",");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS 产物索引</title>
<style>
  :root{${cssVars};color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:var(--surface);color:var(--on-surface);
    font-family:system-ui,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}
  .topbar{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;
    align-items:center;gap:16px;padding:12px 22px;background:var(--surface);
    border-bottom:1px solid var(--outline-variant)}
  @supports (background:color-mix(in srgb,red 50%,transparent)){
    .topbar{background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(14px)}
  }
  .topbar h1{font-size:16px;margin:0;font-weight:650;letter-spacing:.02em}
  .topbar .sub{font-size:12px;color:var(--on-surface-variant);margin-top:2px}
  .nav{font-size:12px;color:var(--on-surface-variant)}
  .nav a{color:var(--primary);text-decoration:none;margin-left:12px}
  .nav a:hover{text-decoration:underline}
  #filter{background:var(--surface-container-high);border:1px solid var(--outline-variant);
    color:var(--on-surface);border-radius:999px;padding:8px 16px;font-size:13px;width:230px;
    outline:none;transition:border-color .15s}
  #filter:focus{border-color:var(--primary)}
  #filter::placeholder{color:var(--outline)}
  main{max-width:980px;margin:0 auto;padding:20px 20px 48px}
  .count{font-size:12px;color:var(--on-surface-variant);margin:0 4px 12px}
  .grp{background:var(--surface-container-low);border:1px solid var(--outline-variant);
    border-radius:14px;margin-bottom:18px}
  .grp h2{margin:0;padding:11px 18px;font-size:13px;font-weight:650;letter-spacing:.08em;
    color:var(--primary);background:var(--surface-container);
    border-bottom:1px solid var(--outline-variant);border-radius:14px 14px 0 0;
    display:flex;justify-content:space-between;align-items:center}
  .grp h2 .n{font-size:11px;color:var(--on-surface-variant);font-weight:400;letter-spacing:0}
  .row{display:grid;grid-template-columns:minmax(200px,1.6fr) 84px 76px 150px 168px;
    gap:12px;align-items:center;padding:8px 18px;border-top:1px solid var(--surface-container-high)}
  .grp .row:first-of-type{border-top:none}
  .name{font-size:13.5px;line-height:1.45;word-break:break-all}
  .name .dir{color:var(--outline);font-size:11.5px;font-family:ui-monospace,Menlo,monospace}
  .name a{color:var(--primary);text-decoration:none}
  .name a:hover{text-decoration:underline}
  .meta{font-size:12px;color:var(--on-surface-variant);font-variant-numeric:tabular-nums}
  .badge{display:inline-block;padding:1px 9px;border-radius:10px;font-size:11.5px;
    font-weight:500;background:var(--surface-container-highest);color:var(--on-surface-variant)}
  .badge.html{color:var(--primary)}
  .badge.document{color:var(--secondary-container)}
  .ops{font-size:12.5px;text-align:right;white-space:nowrap}
  .ops a{color:var(--primary);text-decoration:none;margin-left:10px}
  .ops a:hover{text-decoration:underline}
  .ops .hint{color:var(--outline);margin-left:10px;cursor:help;border-bottom:1px dotted var(--outline)}
  .empty{color:var(--on-surface-variant);text-align:center;padding:40px 0;font-size:14px}
  footer{max-width:980px;margin:0 auto;padding:0 20px 36px;font-size:12px;
    color:var(--outline);line-height:1.8}
  @media (max-width:720px){.row{grid-template-columns:1fr 84px;gap:4px 10px}
    .meta,.ops{text-align:left}.ops{grid-column:1/-1}}
</style></head><body>
<div class="topbar">
  <div>
    <h1>AgentOS 产物索引</h1>
    <div class="sub" id="sub">全类型扫描工作区 · 最新在前</div>
  </div>
  <div class="nav"><span id="ws"></span><a href="/">canvas 首页</a><a href="/keys">键位</a><a href="/replay">回放</a></div>
</div>
<main>
  <input id="filter" placeholder="过滤名称/类型/目录…（按 / 聚焦）" autocomplete="off" style="display:none;margin-bottom:14px">
  <p class="count" id="count"></p>
  <div id="groups"><p class="empty">加载中…</p></div>
</main>
<footer>
  呈现通道：网页/图片 → 在线看 · 文档（fodt/docx/pdf）→ 由 agent 用 desktop__open 桌面打开 ·
  数据/影音 → 下载。<br>
  扫描范围即 files 扩展的工作区（默认 ~/Agent，AGENTOS_WORKSPACE 可覆盖）；.trash 与隐藏文件不进索引。
</footer>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const KIND_LABELS = {${kindBadges}};
const fmtBytes = (n) => n >= 1048576 ? (n/1048576).toFixed(1) + "M" : n >= 1024 ? (n/1024).toFixed(0) + "K" : n + "B";
const fmtTime = (ts) => { const d = new Date(ts); return isNaN(d) ? "" : d.toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}); };
const fileUrl = (rel, mode) => "/api/artifacts/file?path=" + encodeURIComponent(rel) + (mode ? "&mode=" + mode : "");

async function load() {
  const box = document.getElementById("groups");
  let data;
  const r = await fetch("/api/artifacts");
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok || !Array.isArray(data.items)) {
    box.innerHTML = '<p class="empty">产物数据加载失败：HTTP ' + esc(r.status) + "</p>";
    return;
  }
  document.getElementById("sub").textContent = "全类型扫描 " + data.workspace + " · " + data.total + " 个产物";
  document.getElementById("ws").textContent = "";
  document.getElementById("filter").style.display = "";
  render(data.items, "");
  document.getElementById("filter").addEventListener("input", (e) => render(data.items, e.target.value.trim().toLowerCase()));
  document.addEventListener("keydown", (e) => {
    const f = document.getElementById("filter");
    if (e.key === "/" && document.activeElement !== f) { e.preventDefault(); f.focus(); }
    if (e.key === "Escape" && document.activeElement === f) { f.value = ""; render(data.items, ""); f.blur(); }
  });
}

function render(items, q) {
  const box = document.getElementById("groups");
  const matched = items.filter((a) => !q || a.rel.toLowerCase().includes(q) ||
    (KIND_LABELS[a.kind] || "").includes(q) || a.group.toLowerCase().includes(q));
  document.getElementById("count").textContent = q
    ? matched.length + " / " + items.length + " 个产物"
    : items.length + " 个产物 · 按目录分组";
  if (!matched.length) { box.innerHTML = '<p class="empty">（无匹配产物）</p>'; return; }
  const groups = new Map();
  for (const a of matched) {
    const key = a.group === "" ? "（工作区根）" : a.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  box.innerHTML = [...groups.entries()].map(([g, rows]) =>
    '<section class="grp"><h2>' + esc(g) + '<span class="n">' + rows.length + "</span></h2>" +
    rows.map(rowHtml).join("") + "</section>").join("");
}

function rowHtml(a) {
  // 主操作按呈现通道分：html/图片浏览器直接看；文档只有 agent 能打开（提示复制路径）；数据/影音下载
  let ops = '<a href="' + fileUrl(a.rel, "download") + '">下载</a>';
  let name;
  if (a.kind === "html" || a.kind === "image") {
    ops = '<a href="' + fileUrl(a.rel) + '">在线看</a>' + ops;
    name = '<a href="' + fileUrl(a.rel) + '">' + esc(a.name) + "</a>";
  } else {
    name = esc(a.name);
    if (a.kind === "document") {
      ops += '<span class="hint" title="对 agent 说：打开 ' + esc(a.rel) + '">agent 打开</span>';
    }
  }
  const dir = a.rel.includes("/") ? a.rel.slice(0, a.rel.lastIndexOf("/") + 1) : "";
  return '<div class="row"><div class="name">' + name +
    (dir ? ' <span class="dir">' + esc(dir) + "</span>" : "") + "</div>" +
    '<div><span class="badge ' + esc(a.kind) + '">' + esc(KIND_LABELS[a.kind] || a.kind) + "</span></div>" +
    '<div class="meta">' + fmtBytes(a.size) + "</div>" +
    '<div class="meta">' + esc(fmtTime(a.mtime)) + "</div>" +
    '<div class="ops">' + ops + "</div></div>";
}
load();
</script>
</body></html>`;
}
