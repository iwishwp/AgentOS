/** /replay 回放页（自包含 HTML，无外部依赖；数据来自 /api/audit 与 /api/recordings） */
export function replayPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgentOS 回放</title>
<style>
  :root{color-scheme:dark}
  body{font-family:system-ui,sans-serif;background:#111318;color:#e6e6e6;margin:0;padding:24px}
  h1{font-size:20px;color:#8ab4f8;margin:0 0 4px}
  .sub{color:#9aa0aa;font-size:13px;margin-bottom:20px}
  section{margin-bottom:32px}
  h2{font-size:15px;color:#c9d1e0;margin:0 0 10px;font-weight:600}
  .filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .filters input,.filters select{background:#1b1f27;border:1px solid #2a2f3a;color:#e6e6e6;border-radius:6px;padding:6px 10px;font-size:13px}
  .filters input[type=datetime-local]{color-scheme:dark}
  table{width:100%;border-collapse:collapse;font-size:13px}
  td,th{padding:7px 10px;border-bottom:1px solid #23272f;text-align:left;vertical-align:top}
  th{color:#9aa0aa;font-weight:500;position:sticky;top:0;background:#111318}
  tr.row{cursor:pointer}
  tr.row:hover{background:#171b22}
  tr.detail-row>td{background:#161a21;padding:12px 16px}
  .badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:500}
  .b-allow{background:#12351f;color:#7ee2a8}
  .b-deny{background:#3d1620;color:#ff9db0}
  .b-confirm{background:#3a2f12;color:#ffd479}
  .b-t2{outline:1px solid #ffd47955}
  .muted{color:#8b919d}
  pre{margin:0;white-space:pre-wrap;word-break:break-all;font-size:12px;color:#b8bfcc}
  .vwrap{display:flex;flex-wrap:wrap;gap:16px}
  .vcard{width:340px}
  .vcard video{width:100%;border-radius:8px;background:#000}
  .vcard .cap{font-size:12px;color:#9aa0aa;margin-top:4px;display:flex;justify-content:space-between}
  .empty{color:#777}
  .confirm-line{font-size:12px;color:#ffd479;margin-top:4px}
  .snapshot-line{font-size:12px;color:#7ee2a8;margin-top:2px}
</style></head><body>
<h1>AgentOS 回放 — 审计时间轴与会话录像</h1>
<p class="sub">数据源：~/.local/state/agentos/audit.jsonl（出口侧打码兜底）与 ~/Agent/recordings/。点行展开参数与结果摘要。</p>

<section>
<h2>审计时间轴</h2>
<div class="filters">
  <input id="f-tool" placeholder="工具名（子串）">
  <select id="f-ext"><option value="">全部扩展</option></select>
  <select id="f-decision">
    <option value="">全部决策</option>
    <option>allow</option><option>confirm</option><option>deny</option>
  </select>
  <select id="f-tier"><option value="">全部档位</option><option>t1</option><option>t2</option></select>
  <input id="f-since" type="datetime-local">
  <button id="f-go">刷新</button>
</div>
<table id="audit-table">
  <thead><tr><th style="width:170px">时间</th><th>扩展.工具</th><th style="width:80px">决策</th><th style="width:110px">用户选择</th><th style="width:80px">耗时</th></tr></thead>
  <tbody id="audit-body"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody>
</table>
<p id="audit-count" class="muted"></p>
</section>

<section>
<h2>会话录像（水族馆录制）</h2>
<div id="recordings" class="vwrap"><span class="empty">加载中…</span></div>
</section>

<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtTime = (ts) => { if (!ts) return ""; const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleString("zh-CN", {hour12:false}); };
const fmtBytes = (n) => n > 1048576 ? (n/1048576).toFixed(1)+"M" : (n/1024).toFixed(0)+"K";

async function loadAudit() {
  const p = new URLSearchParams();
  const tool = document.getElementById("f-tool").value.trim();
  if (tool) p.set("tool", tool);
  if (document.getElementById("f-ext").value) p.set("ext", document.getElementById("f-ext").value);
  if (document.getElementById("f-decision").value) p.set("decision", document.getElementById("f-decision").value);
  if (document.getElementById("f-tier").value) p.set("tier", document.getElementById("f-tier").value);
  if (document.getElementById("f-since").value) p.set("since", new Date(document.getElementById("f-since").value).toISOString());
  const r = await fetch("/api/audit?" + p.toString());
  const entries = await r.json();
  const body = document.getElementById("audit-body");
  const exts = new Set();
  document.querySelectorAll("#f-ext option").length === 1 && entries.forEach(e => exts.add(e.extension));
  const sel = document.getElementById("f-ext");
  const cur = sel.value;
  [...exts].sort().forEach(x => sel.add(new Option(x, x)));
  sel.value = cur;
  document.getElementById("audit-count").textContent = entries.length + " 条（最新在前，上限 500）";
  if (!entries.length) { body.innerHTML = '<tr><td colspan="5" class="empty">（无匹配条目）</td></tr>'; return; }
  body.innerHTML = "";
  for (const e of entries) {
    const tr = document.createElement("tr");
    tr.className = "row";
    const c = e.confirm || {};
    const resp = c.response_ms != null ? (c.response_ms/1000).toFixed(1)+"s" : "";
    tr.innerHTML =
      "<td>" + esc(fmtTime(e.ts)) + "</td>" +
      "<td>" + esc(e.extension) + "." + esc(e.tool) + (e.tier ? ' <span class="badge b-' + esc(e.decision) + ' b-t2">' + esc(e.tier) + "</span>" : "") + "</td>" +
      '<td><span class="badge b-' + esc(e.decision) + '">' + esc(e.decision) + "</span></td>" +
      "<td>" + esc(c.result || "") + (c.by ? '<div class="muted" style="font-size:11px">' + esc(c.by) + "</div>" : "") + "</td>" +
      '<td class="muted">' + esc(resp) + "</td>";
    tr.onclick = () => toggleDetail(tr, e);
    body.appendChild(tr);
  }
}

function toggleDetail(tr, e) {
  const next = tr.nextElementSibling;
  if (next && next.className === "detail-row") { next.remove(); return; }
  document.querySelectorAll("tr.detail-row").forEach((x) => x.remove());
  const dr = document.createElement("tr");
  dr.className = "detail-row";
  const c = e.confirm || {};
  const lines = [];
  if (c.asked !== undefined) lines.push("confirm: asked=" + c.asked + " result=" + (c.result || "-") + " by=" + (c.by || "-") + " response_ms=" + (c.response_ms ?? "-"));
  if (e.snapshot) lines.push("snapshot: #" + e.snapshot + "（回滚: scripts/snapshot.sh rollback " + e.snapshot + "）");
  if (e.detail) lines.push("detail: " + e.detail);
  dr.innerHTML = '<td colspan="5"><pre>' + esc(lines.join("\\n") || "（无扩展信息）") + "</pre>" +
    (e.snapshot ? '<div class="snapshot-line">系统级变更已留快照 #' + esc(e.snapshot) + "</div>" : "") + "</td>";
  tr.after(dr);
}

async function loadRecordings() {
  const r = await fetch("/api/recordings");
  const list = await r.json();
  const el = document.getElementById("recordings");
  if (!list.length) { el.innerHTML = '<span class="empty">（暂无录像——scripts/record-session.sh start 开始录制）</span>'; return; }
  el.innerHTML = "";
  for (const v of list) {
    const card = document.createElement("div");
    card.className = "vcard";
    card.innerHTML = '<video controls preload="metadata" src="/recordings/' + encodeURIComponent(v.name) + '"></video>' +
      '<div class="cap"><span>' + esc(v.name) + "</span><span>" + fmtBytes(v.size) + "</span></div>";
    el.appendChild(card);
  }
}

document.getElementById("f-go").onclick = loadAudit;
document.querySelectorAll(".filters input").forEach((i) => i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") loadAudit(); }));
document.querySelectorAll(".filters select").forEach((s) => s.addEventListener("change", loadAudit));
loadAudit();
loadRecordings();
</script>
</body></html>`;
}
