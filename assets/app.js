// Retail SQL Analytics — runs DuckDB (WebAssembly) in the browser and draws
// one card per .sql file in /sql. No server: every query runs in this tab.
import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";
import { CARDS, KPI_TILES, funnelHTML } from "./charts.js";
import { escapeHtml, highlightSQL, parseHeader, tableHTML, toCSV, download, int, monthShort } from "./util.js";

const REPO = "https://github.com/Z3US-23/retail-sql-analytics/blob/main/";
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let db;
let conn;
let runToken = 0;
const filters = { market: "all", from: null, to: null };
let monthsAvailable = [];   // ["2009-12", ..., "2011-12"]
let kpiSQL = "";
let lastKpis = null;

// ===================================================================== loader
const steps = ["engine", "data", "tables", "queries"];
function setStep(name, progress) {
  const idx = steps.indexOf(name);
  $$(".loader-steps li").forEach((li, i) => {
    li.classList.toggle("is-done", i < idx);
    li.classList.toggle("is-active", i === idx);
  });
  $("#loader-fill").style.width = `${Math.round(((idx + (progress ?? 0)) / steps.length) * 100)}%`;
}
function finishLoader() {
  $$(".loader-steps li").forEach((li) => { li.classList.remove("is-active"); li.classList.add("is-done"); });
  $("#loader-fill").style.width = "100%";
  setTimeout(() => $("#loader").classList.add("is-done"), 250);
}
function loaderError(err) {
  const box = $("#loader-error");
  box.hidden = false;
  box.textContent = `Something went wrong: ${err.message || err}. Please try a recent version of Chrome, Edge, Firefox or Safari.`;
  console.error(err);
}

// ===================================================================== engine
async function startEngine() {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const worker = new Worker(workerUrl);
  const instance = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await instance.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  await instance.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
  return instance;
}

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not download ${url} (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(received, total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return bytes;
}

/** Run SQL and return plain JS rows (numbers, strings, Dates). */
async function query(sql) {
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const isTime = fields.map((f) => /^(Date|Timestamp)/i.test(String(f.type)));
  const columns = fields.map((f) => f.name);
  const rows = table.toArray().map((r) => {
    const o = {};
    columns.forEach((c, i) => {
      let v = r[c];
      if (typeof v === "bigint") v = Number(v);
      if (isTime[i] && v != null && !(v instanceof Date)) v = new Date(Number(v));
      o[c] = v;
    });
    return o;
  });
  return { columns, rows };
}

// ==================================================================== filters
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;
function nextMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function viewSQL() {
  const where = [
    `invoice_ts >= DATE '${filters.from}-01'`,
    `invoice_ts <  DATE '${nextMonth(filters.to)}-01'`,
  ];
  if (filters.market === "uk") where.push(`country = 'United Kingdom'`);
  else if (filters.market === "intl") where.push(`country <> 'United Kingdom'`);
  else if (filters.market.startsWith("c:")) where.push(`country = ${sqlString(filters.market.slice(2))}`);
  return `CREATE OR REPLACE VIEW sales AS\nSELECT *\nFROM sales_all\nWHERE ${where.join("\n  AND ")};`;
}

const labelYM = (ym) => monthShort(new Date(`${ym}-01T00:00:00Z`));

async function setupFilters() {
  const { rows: months } = await query(
    `SELECT DISTINCT strftime(invoice_ts, '%Y-%m') AS ym FROM sales_all ORDER BY ym`
  );
  monthsAvailable = months.map((r) => r.ym);
  filters.from = monthsAvailable[0];
  filters.to = monthsAvailable.at(-1);
  const opts = monthsAvailable.map((ym) => `<option value="${ym}">${labelYM(ym)}</option>`).join("");
  $("#f-from").innerHTML = opts;
  $("#f-to").innerHTML = opts;

  const { rows: countries } = await query(
    `SELECT country FROM sales_all WHERE country <> 'United Kingdom'
     GROUP BY country ORDER BY sum(revenue) DESC`
  );
  $("#f-market").insertAdjacentHTML(
    "beforeend",
    `<optgroup label="Single country">${countries
      .map((c) => `<option value="c:${escapeHtml(c.country)}">${escapeHtml(c.country)}</option>`)
      .join("")}</optgroup>`
  );
  syncFilterControls();

  $("#f-market").addEventListener("change", (e) => { filters.market = e.target.value; runAll(); });
  $("#f-from").addEventListener("change", (e) => {
    filters.from = e.target.value;
    if (filters.from > filters.to) filters.to = filters.from;
    syncFilterControls(); runAll();
  });
  $("#f-to").addEventListener("change", (e) => {
    filters.to = e.target.value;
    if (filters.to < filters.from) filters.from = filters.to;
    syncFilterControls(); runAll();
  });
  $$(".presets .chip").forEach((b) => b.addEventListener("click", () => {
    const p = b.dataset.preset;
    if (p === "all") { filters.from = monthsAvailable[0]; filters.to = monthsAvailable.at(-1); }
    else { filters.from = `${p}-01`; filters.to = `${p}-12`; }
    syncFilterControls(); runAll();
  }));
  $("#view-sql-btn").addEventListener("click", (e) => {
    const box = $("#view-sql");
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!box.hidden));
  });
  $$(".ctl select").forEach((s) => (s.disabled = false));
}

function syncFilterControls() {
  $("#f-from").value = filters.from;
  $("#f-to").value = filters.to;
  const presetOf = () => {
    if (filters.from === monthsAvailable[0] && filters.to === monthsAvailable.at(-1)) return "all";
    for (const y of ["2010", "2011"]) if (filters.from === `${y}-01` && filters.to === `${y}-12`) return y;
    return null;
  };
  const p = presetOf();
  $$(".presets .chip").forEach((b) => b.classList.toggle("is-on", b.dataset.preset === p));
}

// ====================================================================== cards
const cardState = new Map();   // id -> { def, el, chart, state, result, sql, ms }

function buildCard(def, sql) {
  const meta = parseHeader(sql);
  const state = Object.fromEntries((def.controls || []).map((c) => [c.key, c.options[0][0]]));
  const el = document.createElement("article");
  el.className = "card reveal";
  el.id = `card-${def.id}`;
  el.innerHTML = `
    <div class="card-top">
      <div>
        <p class="card-id">${def.file.replace(".sql", "").replace("_", " · ").replace(/_/g, " ")}</p>
        <h3>${escapeHtml(meta.title || def.id)}</h3>
        <p class="card-q">${escapeHtml(meta.question || "")}</p>
      </div>
      <div class="tabs" role="tablist" aria-label="View">
        <button class="tab is-on" role="tab" data-tab="chart">Chart</button>
        <button class="tab" role="tab" data-tab="table">Table</button>
        <button class="tab" role="tab" data-tab="sql">SQL</button>
      </div>
    </div>
    ${(def.controls || []).length ? `<div class="card-controls">${def.controls.map((c) =>
      c.options.map(([v, label], i) => `<button type="button" class="chip ${i === 0 ? "is-on" : ""}" data-key="${c.key}" data-value="${v}">${label}</button>`).join("")
    ).join('<span style="width:10px"></span>')}</div>` : ""}
    <div class="pane" data-pane="chart">${def.html ? '<div class="html-pane"><div class="skeleton"></div></div>' : `<div class="chart ${def.tall ? "tall" : ""}"><div class="skeleton"></div></div>`}</div>
    <div class="pane" data-pane="table" hidden></div>
    <div class="pane" data-pane="sql" hidden>
      <pre class="code">${highlightSQL(sql.trim())}</pre>
      <div class="sql-actions">
        <button type="button" class="btn-ghost" data-act="copy">Copy SQL</button>
        <button type="button" class="btn-ghost" data-act="play">Open in playground ↓</button>
        <a class="btn-ghost" href="${REPO}sql/${def.file}" target="_blank" rel="noopener">View on GitHub ↗</a>
      </div>
    </div>
    <div class="skills">${meta.skills.map((s) => `<span class="skill">${escapeHtml(s)}</span>`).join("")}</div>
    <div class="insight" hidden></div>
    <div class="card-foot"><span class="foot-note"></span><span class="foot-stats"></span></div>`;

  const card = { def, el, state, sql, chart: null, result: null, ms: 0 };
  cardState.set(def.id, card);

  $$(".tab", el).forEach((t) => t.addEventListener("click", () => {
    $$(".tab", el).forEach((x) => x.classList.toggle("is-on", x === t));
    $$(".pane", el).forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
    if (t.dataset.tab === "chart") card.chart?.resize();
  }));
  $$(".card-controls .chip", el).forEach((b) => b.addEventListener("click", () => {
    card.state[b.dataset.key] = b.dataset.value;
    $$(`.card-controls .chip[data-key="${b.dataset.key}"]`, el).forEach((x) => x.classList.toggle("is-on", x === b));
    drawCard(card);
  }));
  $('[data-act="copy"]', el).addEventListener("click", async () => {
    await navigator.clipboard.writeText(sql.trim());
    toast("SQL copied");
  });
  $('[data-act="play"]', el).addEventListener("click", () => openInPlayground(sql.trim()));
  return card;
}

function drawCard(card) {
  const { def, el, result } = card;
  if (!result) return;
  const ctx = { kpis: lastKpis };
  const pane = $('[data-pane="chart"]', el);

  if (def.html) {
    $(".html-pane", pane).innerHTML = def.html(result.rows, card.state, ctx);
  } else {
    const box = $(".chart", pane);
    const option = result.rows.length ? def.option(result.rows, card.state, ctx) : null;
    if (!option) {
      card.chart?.dispose();
      card.chart = null;
      box.innerHTML = '<div class="empty">No data for this selection. Try a wider period or another market.</div>';
    } else {
      if (!card.chart) {
        box.innerHTML = "";
        card.chart = echarts.init(box, null, { renderer: "canvas" });
        new ResizeObserver(() => card.chart?.resize()).observe(box);
      }
      card.chart.setOption(option, { notMerge: true });
    }
  }

  $('[data-pane="table"]', el).innerHTML = result.rows.length
    ? `${tableHTML(result.columns, result.rows)}<div class="sql-actions"><button type="button" class="btn-ghost" data-act="csv">Download CSV</button></div>`
    : '<div class="empty">No rows.</div>';
  $('[data-act="csv"]', el)?.addEventListener("click", () => download(def.file.replace(".sql", ".csv"), toCSV(result.columns, result.rows)));

  const insight = result.rows.length ? def.insight?.(result.rows, card.state, ctx) : "";
  const box = $(".insight", el);
  box.hidden = !insight;
  box.innerHTML = insight ? `→ ${insight}` : "";
  $(".foot-note", el).textContent = def.note?.(result.rows, card.state) || "";
  $(".foot-stats", el).textContent = `${int(result.rows.length)} rows · ${Math.round(card.ms)} ms`;
}

// ======================================================================= KPIs
function renderKpis(k) {
  const wrap = $("#kpis");
  if (!wrap.children.length) {
    wrap.innerHTML = KPI_TILES.map((t) => `
      <div class="kpi reveal"><div class="kpi-label">${t.label}</div>
        <div class="kpi-value" data-kpi="${t.key}">—</div><div class="kpi-sub">${t.sub}</div></div>`).join("");
    observeReveals();
  }
  for (const t of KPI_TILES) {
    const el = $(`[data-kpi="${t.key}"]`, wrap);
    const to = k[t.key] ?? 0;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    const start = performance.now();
    const dur = 700;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = t.fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Background tabs pause animations, so make sure the final value always lands.
    setTimeout(() => { if (el.dataset.v === String(to)) el.textContent = t.fmt(to); }, dur + 100);
  }
}

// ================================================================== run all
async function runAll(onFirstPaint) {
  const token = ++runToken;
  const view = viewSQL();
  $("#view-sql-code").innerHTML = highlightSQL(view);
  await conn.query(view);
  const t0 = performance.now();
  $("#run-stats").textContent = "running…";

  const kpi = await query(kpiSQL);
  if (token !== runToken) return;
  lastKpis = kpi.rows[0];
  renderKpis(lastKpis);

  let t;
  for (const card of cardState.values()) {
    if (token !== runToken) return;
    card.el.classList.add("is-busy");
    t = performance.now();
    try {
      card.result = await query(card.sql);
      card.ms = performance.now() - t;
      if (token !== runToken) return;
      drawCard(card);
      onFirstPaint?.();          // hide the loader once the top of the page is ready
      onFirstPaint = null;
    } catch (err) {
      console.error(card.def.file, err);
      $('[data-pane="chart"]', card.el).innerHTML = `<div class="pg-error">${escapeHtml(err.message)}</div>`;
    }
    card.el.classList.remove("is-busy");
  }
  const total = performance.now() - t0;
  $("#run-stats").innerHTML = `<b>●</b> ${cardState.size + 1} queries re-ran in ${(total / 1000).toFixed(1)} s`;
  return total;
}

// ================================================================= playground
let editor;
let pgResult = null;
const SAMPLES = [
  ["Top customers", `-- Top 10 customers by net revenue
SELECT
    customer_id,
    country,
    count(DISTINCT invoice) AS orders,
    round(sum(revenue))     AS net_revenue
FROM sales
WHERE customer_id IS NOT NULL
GROUP BY ALL
ORDER BY net_revenue DESC
LIMIT 10;`],
  ["Running total", `-- Cumulative revenue through the year, with a window function
SELECT
    date_trunc('month', invoice_ts)::DATE              AS month,
    round(sum(revenue))                                 AS revenue,
    round(sum(sum(revenue)) OVER (
        PARTITION BY year(invoice_ts) ORDER BY date_trunc('month', invoice_ts)
    ))                                                  AS running_total_this_year
FROM sales
GROUP BY ALL
ORDER BY month;`],
  ["Basket size", `-- How many different products are in a typical order, by country?
WITH baskets AS (
    SELECT invoice, country, count(DISTINCT stock_code) AS items
    FROM sales
    WHERE NOT is_return
    GROUP BY ALL
)
SELECT
    country,
    count(*)                       AS orders,
    round(avg(items), 1)           AS avg_items,
    median(items)                  AS median_items
FROM baskets
GROUP BY country
HAVING count(*) >= 50
ORDER BY avg_items DESC;`],
  ["Price bands", `-- Revenue by unit-price band
SELECT
    CASE
        WHEN unit_price < 1  THEN '1. under £1'
        WHEN unit_price < 3  THEN '2. £1–3'
        WHEN unit_price < 10 THEN '3. £3–10'
        ELSE                      '4. £10+'
    END                          AS price_band,
    count(*)                     AS lines,
    sum(quantity)                AS units,
    round(sum(revenue))          AS revenue
FROM sales
WHERE NOT is_return
GROUP BY price_band
ORDER BY price_band;`],
  ["Product search", `-- Find products by name
SELECT p.stock_code, p.description,
       round(sum(s.revenue)) AS net_revenue
FROM products p
JOIN sales s USING (stock_code)
WHERE p.description ILIKE '%teacup%'
GROUP BY ALL
ORDER BY net_revenue DESC;`],
];

function setupPlayground() {
  editor = CodeMirror.fromTextArea($("#pg-input"), {
    mode: "text/x-sql",
    lineNumbers: true,
    indentUnit: 4,
    smartIndent: true,
    viewportMargin: Infinity,
    extraKeys: { "Ctrl-Enter": runPlayground, "Cmd-Enter": runPlayground },
  });
  editor.setValue(SAMPLES[0][1]);

  $("#pg-samples").innerHTML = SAMPLES.map(([name], i) =>
    `<button type="button" class="chip ${i === 0 ? "is-on" : ""}" data-i="${i}">${name}</button>`).join("");
  $$("#pg-samples .chip").forEach((b) => b.addEventListener("click", () => {
    $$("#pg-samples .chip").forEach((x) => x.classList.toggle("is-on", x === b));
    editor.setValue(SAMPLES[b.dataset.i][1]);
    runPlayground();
  }));
  $("#pg-run").addEventListener("click", runPlayground);
  $("#pg-run").disabled = false;
  $("#pg-csv").addEventListener("click", () => pgResult && download("query_result.csv", toCSV(pgResult.columns, pgResult.rows)));
}

async function renderSchema() {
  const { rows } = await query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_name IN ('sales', 'products')
    ORDER BY table_name DESC, ordinal_position`);
  const { rows: counts } = await query(`SELECT (SELECT count(*) FROM sales) AS s, (SELECT count(*) FROM products) AS p`);
  const n = { sales: counts[0].s, products: counts[0].p };
  const byTable = Object.groupBy ? Object.groupBy(rows, (r) => r.table_name) : rows.reduce((a, r) => ((a[r.table_name] ||= []).push(r), a), {});
  const shortType = (t) => t.replace("TIMESTAMP", "TIMESTAMP").replace("VARCHAR", "TEXT").replace("DOUBLE", "NUM").replace("INTEGER", "INT").replace("BOOLEAN", "BOOL");
  $("#pg-schema").innerHTML = Object.entries(byTable).map(([table, cols]) => `
    <h4><button type="button" data-insert="${table}" style="padding:0;font:inherit;color:inherit;width:auto">${table}</button><small>${int(n[table])} rows</small></h4>
    ${cols.map((c) => `<button type="button" data-insert="${c.column_name}">${c.column_name}<i>${shortType(c.data_type)}</i></button>`).join("")}`).join("")
    + `<h4>sales_all<small>unfiltered</small></h4><p class="muted" style="font-size:12px">Same columns as <code>sales</code>, ignoring the filters.</p>`;
  $$("#pg-schema [data-insert]").forEach((b) => b.addEventListener("click", () => {
    editor.replaceSelection(b.dataset.insert);
    editor.focus();
  }));
}

async function runPlayground() {
  const sql = editor.getValue();
  const meta = $("#pg-meta");
  const out = $("#pg-result");
  meta.classList.remove("is-error");
  meta.textContent = "running…";
  const t = performance.now();
  try {
    pgResult = await query(sql);
    const ms = performance.now() - t;
    const shown = Math.min(pgResult.rows.length, 1000);
    meta.textContent = `${int(pgResult.rows.length)} rows · ${Math.round(ms)} ms${pgResult.rows.length > shown ? ` · showing first ${shown}` : ""}`;
    out.innerHTML = pgResult.rows.length ? tableHTML(pgResult.columns, pgResult.rows) : '<div class="empty">The query ran but returned no rows.</div>';
    $("#pg-csv").hidden = !pgResult.rows.length;
  } catch (err) {
    pgResult = null;
    meta.textContent = "error";
    meta.classList.add("is-error");
    out.innerHTML = `<div class="pg-error">${escapeHtml(err.message)}</div>`;
    $("#pg-csv").hidden = true;
  }
}

function openInPlayground(sql) {
  editor.setValue(sql);
  $$("#pg-samples .chip").forEach((x) => x.classList.remove("is-on"));
  $("#playground").scrollIntoView({ behavior: "smooth" });
  setTimeout(() => { editor.refresh(); runPlayground(); }, 400);
}

// ===================================================================== misc UI
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 1600);
}

const revealer = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); revealer.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" })
  : null;
function observeReveals() {
  $$(".reveal:not(.is-in)").forEach((el) => (revealer ? revealer.observe(el) : el.classList.add("is-in")));
}

function trackSections() {
  const links = new Map($$(".topnav a").map((a) => [a.getAttribute("href").slice(1), a]));
  const obs = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle("is-current", id === e.target.id));
  }), { rootMargin: "-45% 0px -50% 0px" });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) obs.observe(s); });
}

// ======================================================================= main
async function main() {
  try {
    setStep("engine");
    // Fetch the SQL files and cleaning report while DuckDB starts.
    const sqlFiles = ["01_kpis.sql", ...CARDS.map((c) => c.file)];
    const textsPromise = Promise.all(sqlFiles.map((f) => fetch(`sql/${f}`).then((r) => r.text())));
    const reportPromise = fetch("data/cleaning_report.json").then((r) => r.json()).catch(() => null);
    db = await startEngine();
    conn = await db.connect();

    setStep("data");
    const mb = (b) => (b / 1e6).toFixed(1);
    const [sales, products] = await Promise.all([
      fetchBytes("data/sales.parquet", (got, total) => {
        $("#loader-mb").textContent = total ? `${mb(got)} / ${mb(total)} MB` : `${mb(got)} MB`;
        if (total) setStep("data", got / total);
      }),
      fetchBytes("data/products.parquet"),
    ]);
    await db.registerFileBuffer("sales.parquet", sales);
    await db.registerFileBuffer("products.parquet", products);

    setStep("tables");
    const t = performance.now();
    await conn.query(`CREATE TABLE sales_all AS SELECT * FROM 'sales.parquet'`);
    await conn.query(`CREATE TABLE products AS SELECT * FROM 'products.parquet'`);
    const loadMs = performance.now() - t;
    await setupFilters();

    const [texts, report] = await Promise.all([textsPromise, reportPromise]);
    kpiSQL = texts[0];
    if (report) $("#funnel").innerHTML = funnelHTML(report);

    for (const [i, def] of CARDS.entries()) {
      const card = buildCard(def, texts[i + 1]);
      const slot = $(`[data-cards~="${def.id}"]`);
      slot.appendChild(card.el);
    }
    observeReveals();

    setStep("queries");
    setupPlayground();
    const total = await runAll(finishLoader);
    await renderSchema();
    await runPlayground();
    const { rows } = await query("SELECT count(*) AS n FROM sales_all");
    $("#engine-pill").classList.add("is-ready");
    $("#engine-text").textContent =
      `DuckDB ready · ${int(rows[0].n)} rows loaded in ${(loadMs / 1000).toFixed(1)} s · 10 queries in ${(total / 1000).toFixed(1)} s`;
    trackSections();
    // Refresh the table counts when filters change.
    ["#f-market", "#f-from", "#f-to"].forEach((s) => $(s).addEventListener("change", () => setTimeout(renderSchema, 50)));
    $$(".presets .chip").forEach((b) => b.addEventListener("click", () => setTimeout(renderSchema, 50)));
  } catch (err) {
    loaderError(err);
  }
}

main();
