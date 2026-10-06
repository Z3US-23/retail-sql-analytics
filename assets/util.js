// Small helpers shared by the dashboard: formatting, SQL highlighting, tables.

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- numbers ----------
const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

export const int = (v) => (v == null || Number.isNaN(v) ? "—" : nf0.format(v));
export const num = (v) => (v == null || Number.isNaN(v) ? "—" : nf2.format(v));
export const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : `${Number(v).toFixed(d)}%`);
export const signedPct = (v) => (v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`);

/** £1,394,454 */
export const gbp = (v) => (v == null || Number.isNaN(v) ? "—" : `£${nf0.format(v)}`);
/** £18.9M, £603k, £497 */
export function gbpShort(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `£${parseFloat((v / 1e6).toFixed(a >= 1e7 ? 1 : 2))}M`;
  if (a >= 1e4) return `£${Math.round(v / 1e3)}k`;
  if (a >= 1e3) return `£${(v / 1e3).toFixed(1)}k`;
  return `£${Math.round(v)}`;
}
export function compact(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
  return nf0.format(v);
}

// ---------- dates (DuckDB dates arrive as UTC midnight) ----------
export const monthShort = (d) =>
  d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
export const monthLong = (d) =>
  d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
export const isoDay = (d) => d.toISOString().slice(0, 10);

/** "WHITE HANGING HEART T-LIGHT HOLDER" -> "White Hanging Heart T-Light Holder" */
export const titleCase = (s) =>
  s == null ? "Unknown product" : String(s).toLowerCase().replace(/(^|[\s\-/(+])([a-z])/g, (m, p, c) => p + c.toUpperCase()).trim();

export const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- SQL syntax highlighting (for read-only code blocks) ----------
const KEYWORDS = new Set(
  `select from where group by order having limit with as and or not in is null join left right inner outer
   on using distinct case when then else end over partition rows range unbounded preceding following current
   row between interval create replace view table cross union all filter desc asc true false date timestamp
   cast exclude like into values set`.split(/\s+/)
);
const TOKEN = /(--[^\n]*)|('(?:''|[^'])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

export function highlightSQL(sql) {
  let out = "";
  let last = 0;
  for (const m of sql.matchAll(TOKEN)) {
    out += escapeHtml(sql.slice(last, m.index));
    const [tok, comment, str, number, word] = m;
    if (comment) out += `<span class="c">${escapeHtml(comment)}</span>`;
    else if (str) out += `<span class="s">${escapeHtml(str)}</span>`;
    else if (number) out += `<span class="n">${number}</span>`;
    else if (KEYWORDS.has(word.toLowerCase())) out += `<span class="k">${word}</span>`;
    else if (/^\s*\(/.test(sql.slice(m.index + tok.length))) out += `<span class="f">${word}</span>`;
    else out += escapeHtml(word);
    last = m.index + tok.length;
  }
  return out + escapeHtml(sql.slice(last));
}

/** Read the "-- title: / -- question: / -- skills:" header of a .sql file. */
export function parseHeader(sql) {
  const meta = {};
  for (const line of sql.split("\n")) {
    const m = line.match(/^--\s*(title|question|skills):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
    else if (line.trim() && !line.startsWith("--")) break;
  }
  meta.skills = meta.skills ? meta.skills.split(/,\s*(?![^()]*\))/) : [];   // ignore commas inside (...)
  return meta;
}

// ---------- result tables ----------
function cell(v) {
  if (v == null) return { html: '<span class="muted">null</span>', num: false };
  if (v instanceof Date) {
    const iso = v.toISOString();
    return { html: iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " "), num: false };
  }
  if (typeof v === "number") return { html: num(v), num: true };
  if (typeof v === "boolean") return { html: String(v), num: false };
  return { html: escapeHtml(v), num: false };
}

export function tableHTML(columns, rows, maxRows = 1000) {
  const head = columns.map((c) => {
    const isNum = rows.length && typeof rows[0][c] === "number";
    return `<th class="${isNum ? "num" : ""}">${escapeHtml(c)}</th>`;
  }).join("");
  const body = rows.slice(0, maxRows).map((r) =>
    `<tr>${columns.map((c) => {
      const { html, num: isNum } = cell(r[c]);
      return `<td class="${isNum ? "num" : ""}" title="${isNum ? "" : escapeHtml(r[c] ?? "")}">${html}</td>`;
    }).join("")}</tr>`
  ).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function toCSV(columns, rows) {
  const esc = (v) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
