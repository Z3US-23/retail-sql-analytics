// One entry per SQL file: how to draw its result and what sentence to write about it.
import {
  escapeHtml, int, pct, signedPct, gbp, gbpShort, compact,
  monthShort, monthLong, titleCase,
} from "./util.js";

// Palette: brand orange + blue pass the colour-blind checks on the dark surface.
export const C = {
  ink: "#f2efe8", soft: "#c6c0b4", mute: "#8f8a7e",
  grid: "#2a2823", axis: "#46433b", surface: "#171714",
  accent: "#f05423", accentHover: "#ff7a4d", blue: "#3987e5",
  // sequential blue, dark (near zero) -> light (high)
  seq: ["#1b2536", "#184f95", "#2a78d6", "#5598e7", "#9ec5f4", "#cde2fb"],
};

const FONT = "Inter Tight, -apple-system, Segoe UI, sans-serif";

const base = () => ({
  backgroundColor: "transparent",
  animationDuration: 700,
  animationDurationUpdate: 500,
  animationEasing: "cubicOut",
  textStyle: { fontFamily: FONT, color: C.soft },
  tooltip: {
    backgroundColor: "#1e1e1b",
    borderColor: "#46433b",
    borderWidth: 1,
    textStyle: { color: C.ink, fontSize: 13, fontFamily: FONT },
    extraCssText: "border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 12px;",
  },
});

const valueAxis = (formatter, extra = {}) => ({
  type: "value",
  axisLabel: { color: C.mute, fontSize: 11, formatter },
  splitLine: { lineStyle: { color: C.grid } },
  axisLine: { show: false },
  axisTick: { show: false },
  ...extra,
});

const categoryAxis = (data, extra = {}) => ({
  type: "category",
  data,
  axisLabel: { color: C.mute, fontSize: 11 },
  axisLine: { lineStyle: { color: C.axis } },
  axisTick: { show: false },
  ...extra,
});

const tipRow = (label, value) =>
  `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:${C.mute}">${label}</span><b style="font-weight:600">${value}</b></div>`;
const tipTitle = (t) => `<div style="font-weight:600;margin-bottom:6px;max-width:320px;white-space:normal">${escapeHtml(t)}</div>`;

// Horizontal ranked bar chart used by several cards.
function rankedBars({ labels, values, fmt, tooltip, color = C.accent, highlightFirst = false, labelWidth = 150 }) {
  return {
    ...base(),
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    xAxis: valueAxis((v) => fmt(v, true), { splitNumber: 4 }),
    yAxis: categoryAxis(labels, {
      inverse: true,
      axisLabel: { color: C.soft, fontSize: 12, width: labelWidth, overflow: "truncate" },
    }),
    tooltip: { ...base().tooltip, trigger: "item", formatter: tooltip },
    series: [{
      type: "bar",
      data: values.map((v, i) => ({
        value: v,
        itemStyle: { color: highlightFirst && i > 0 ? "rgba(240,84,35,0.55)" : color },
      })),
      barMaxWidth: 16,
      barCategoryGap: "38%",
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      emphasis: { itemStyle: { color: C.accentHover } },
      label: { show: true, position: "right", color: C.soft, fontSize: 11, formatter: (p) => fmt(p.value, true) },
    }],
  };
}

// ---------------------------------------------------------------------------
export const CARDS = [
  // ---------------------------------------------------------------- 02 trend
  {
    id: "trend",
    file: "02_monthly_trend.sql",
    controls: [{ key: "metric", options: [["revenue", "Revenue"], ["orders", "Orders"], ["customers", "Customers"]] }],
    option(rows, s) {
      const fmt = s.metric === "revenue" ? (v, short) => (short ? gbpShort(v) : gbp(v)) : (v, short) => (short ? compact(v) : int(v));
      return {
        ...base(),
        grid: { left: 8, right: 12, top: 20, bottom: 8, containLabel: true },
        xAxis: categoryAxis(rows.map((r) => monthShort(r.month)), { axisLabel: { color: C.mute, fontSize: 11, interval: "auto" } }),
        yAxis: valueAxis((v) => fmt(v, true)),
        tooltip: {
          ...base().tooltip,
          trigger: "axis",
          axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
          formatter: ([p]) => {
            const r = rows[p.dataIndex];
            return tipTitle(monthLong(r.month) + (r.is_partial ? " (partial: 1–9 Dec)" : ""))
              + tipRow(s.metric[0].toUpperCase() + s.metric.slice(1), fmt(r[s.metric]))
              + (s.metric === "revenue"
                ? tipRow("vs previous month", signedPct(r.mom_growth_pct)) + tipRow("vs same month last year", signedPct(r.yoy_growth_pct))
                : "");
          },
        },
        series: [{
          type: "bar",
          name: s.metric,
          data: rows.map((r) => ({
            value: r[s.metric],
            itemStyle: r.is_partial
              ? { color: "rgba(240,84,35,0.28)", borderColor: C.accent, borderWidth: 1, borderType: "dashed" }
              : undefined,
          })),
          barMaxWidth: 30,
          barCategoryGap: "22%",
          itemStyle: { color: C.accent, borderRadius: [4, 4, 0, 0] },
          emphasis: { itemStyle: { color: C.accentHover } },
        }],
      };
    },
    insight(rows, s) {
      const full = rows.filter((r) => !r.is_partial);
      if (!full.length) return "";
      const label = { revenue: "revenue", orders: "orders", customers: "active customers" }[s.metric];
      const fmt = s.metric === "revenue" ? gbpShort : int;
      const peak = full.reduce((a, b) => (b[s.metric] > a[s.metric] ? b : a));
      const avg = full.reduce((t, r) => t + r[s.metric], 0) / full.length;
      let text = `Peak month for ${label}: <strong>${monthLong(peak.month)}</strong> (${fmt(peak[s.metric])}), `
        + `${Math.round((peak[s.metric] / avg - 1) * 100)}% above the monthly average. Sales climb every autumn as shops stock up for Christmas.`;
      const yoy = full.filter((r) => r.yoy_growth_pct != null).at(-1);
      if (yoy && s.metric === "revenue") {
        text += ` Latest full month, ${monthLong(yoy.month)}, was <strong>${signedPct(yoy.yoy_growth_pct)}</strong> on a year earlier.`;
      }
      if (rows.some((r) => r.is_partial)) text += ` <span class="muted">The dashed bar is December 2011, which only has data up to the 9th.</span>`;
      return text;
    },
  },

  // ------------------------------------------------------------ 03 countries
  {
    id: "countries",
    file: "03_countries.sql",
    controls: [
      { key: "uk", options: [["without", "Without UK"], ["with", "With UK"]] },
      { key: "metric", options: [["revenue", "Revenue"], ["avg_order_value", "Avg order"]] },
    ],
    option(rows, s) {
      let list = rows.filter((r) => s.uk === "with" || r.country !== "United Kingdom");
      if (s.metric === "avg_order_value") list = list.filter((r) => r.orders >= 20);
      list = [...list].sort((a, b) => b[s.metric] - a[s.metric]).slice(0, 12);
      if (!list.length) return null;
      return rankedBars({
        labels: list.map((r) => r.country),
        values: list.map((r) => r[s.metric]),
        fmt: (v, short) => (short ? gbpShort(v) : gbp(v)),
        labelWidth: 110,
        tooltip: (p) => {
          const r = list[p.dataIndex];
          return tipTitle(r.country) + tipRow("Revenue", gbp(r.revenue)) + tipRow("Share of total", pct(r.share_pct, 2))
            + tipRow("Customers", int(r.customers)) + tipRow("Orders", int(r.orders)) + tipRow("Avg order", gbp(r.avg_order_value));
        },
      });
    },
    note: (rows, s) => (s.metric === "avg_order_value" ? "Countries with at least 20 orders, so a few huge orders can't top the list." : ""),
    insight(rows) {
      const uk = rows.find((r) => r.country === "United Kingdom");
      const abroad = rows.filter((r) => r.country !== "United Kingdom");
      const orders = abroad.reduce((t, r) => t + r.orders, 0);
      const aovAbroad = orders ? abroad.reduce((t, r) => t + r.avg_order_value * r.orders, 0) / orders : null;
      if (uk && abroad.length) {
        return `The UK brings in <strong>${pct(uk.share_pct)}</strong> of revenue. Orders from abroad are fewer but bigger: `
          + `<strong>${gbp(aovAbroad)}</strong> per order on average vs ${gbp(uk.avg_order_value)} in the UK, because overseas buyers are mostly wholesalers ordering in bulk.`;
      }
      const top = rows[0];
      if (rows.length === 1) {
        return `All revenue in this selection comes from <strong>${escapeHtml(top.country)}</strong>: ${gbp(top.revenue)} from ${int(top.customers)} customers, `
          + `with an average order of <strong>${gbp(top.avg_order_value)}</strong>.`;
      }
      return top ? `<strong>${escapeHtml(top.country)}</strong> leads this selection with ${gbp(top.revenue)}, ${pct(top.share_pct)} of the total.` : "";
    },
  },

  // ------------------------------------------------------------- 04 products
  {
    id: "products",
    file: "04_top_products.sql",
    option(rows) {
      return rankedBars({
        labels: rows.map((r) => titleCase(r.product)),
        values: rows.map((r) => r.net_revenue),
        fmt: (v, short) => (short ? gbpShort(v) : gbp(v)),
        labelWidth: 170,
        tooltip: (p) => {
          const r = rows[p.dataIndex];
          return tipTitle(titleCase(r.product)) + tipRow("Stock code", r.stock_code) + tipRow("Net revenue", gbp(r.net_revenue))
            + tipRow("Units (after returns)", int(r.net_units)) + tipRow("Orders", int(r.orders)) + tipRow("Avg unit price", `£${r.avg_unit_price?.toFixed(2)}`);
        },
      });
    },
    insight(rows, s, ctx) {
      if (!rows.length) return "";
      const top = rows[0];
      const mostUnits = rows.reduce((a, b) => (b.net_units > a.net_units ? b : a));
      const share = ctx.kpis ? rows.reduce((t, r) => t + r.net_revenue, 0) / ctx.kpis.net_revenue * 100 : null;
      let text = `<strong>${escapeHtml(titleCase(top.product))}</strong> earns the most`;
      if (mostUnits !== top) {
        text += `, even though <strong>${escapeHtml(titleCase(mostUnits.product))}</strong> sells ${(mostUnits.net_units / top.net_units).toFixed(1)}× more units. Price matters (£${top.avg_unit_price.toFixed(2)} vs £${mostUnits.avg_unit_price.toFixed(2)}).`;
      } else text += ".";
      if (share != null) text += ` These 15 products make up ${pct(share)} of net revenue, out of ${int(ctx.kpis.products_sold)} products sold.`;
      return text;
    },
  },

  // ---------------------------------------------------------------- 09 hours
  {
    id: "hours",
    file: "09_shopping_hours.sql",
    controls: [{ key: "metric", options: [["orders", "Orders"], ["revenue", "Revenue"]] }],
    option(rows, s) {
      if (!rows.length) return null;
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const hours = [];
      const hMin = Math.min(...rows.map((r) => r.hour));
      const hMax = Math.max(...rows.map((r) => r.hour));
      for (let h = hMin; h <= hMax; h++) hours.push(h);
      const max = Math.max(...rows.map((r) => r[s.metric]));
      const fmt = s.metric === "revenue" ? gbp : int;
      return {
        ...base(),
        grid: { left: 8, right: 8, top: 8, bottom: 52, containLabel: true },
        xAxis: categoryAxis(hours.map((h) => `${String(h).padStart(2, "0")}:00`), { splitArea: { show: false } }),
        yAxis: categoryAxis(days, { inverse: true, axisLine: { show: false }, axisLabel: { color: C.soft, fontSize: 12 } }),
        visualMap: {
          type: "continuous", min: 0, max, orient: "horizontal", left: "center", bottom: 0,
          itemWidth: 10, itemHeight: 160, calculable: false,
          text: [s.metric === "revenue" ? gbpShort(max) : int(max), "0"],
          textStyle: { color: C.mute, fontSize: 11 },
          inRange: { color: C.seq },
        },
        tooltip: {
          ...base().tooltip,
          formatter: (p) => {
            const [hi, di] = p.value;
            const r = rows.find((x) => x.day_number === di + 1 && x.hour === hours[hi]);
            return tipTitle(`${days[di]} ${String(hours[hi]).padStart(2, "0")}:00–${String(hours[hi] + 1).padStart(2, "0")}:00`)
              + tipRow("Orders", int(r?.orders)) + tipRow("Revenue", gbp(r?.revenue));
          },
        },
        series: [{
          type: "heatmap",
          data: rows.map((r) => [hours.indexOf(r.hour), r.day_number - 1, r[s.metric]]),
          itemStyle: { borderColor: C.surface, borderWidth: 2, borderRadius: 4 },
          emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1 } },
        }],
      };
    },
    insight(rows) {
      if (!rows.length) return "";
      const peak = rows.reduce((a, b) => (b.orders > a.orders ? b : a));
      const total = rows.reduce((t, r) => t + r.orders, 0);
      const sat = rows.filter((r) => r.day_number === 6).reduce((t, r) => t + r.orders, 0);
      const lunch = rows.filter((r) => r.hour >= 10 && r.hour <= 14).reduce((t, r) => t + r.orders, 0);
      return `Busiest slot: <strong>${peak.day} ${String(peak.hour).padStart(2, "0")}:00</strong> (${int(peak.orders)} orders). `
        + `${pct((lunch / total) * 100, 0)} of orders arrive between 10:00 and 15:00, during office hours. `
        + `Saturday is almost empty (<strong>${int(sat)}</strong> orders), which fits a business selling mainly to other shops, not to consumers.`;
    },
  },

  // --------------------------------------------------------------- 05 Lorenz
  {
    id: "lorenz",
    file: "05_customer_concentration.sql",
    option(rows) {
      if (!rows.length) return null;
      const pts = [[0, 0], ...rows.map((r) => [r.pct_customers, r.pct_revenue])];
      const at = (x) => pts.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a))[1];
      const top20 = rows[0].top20_pct;   // exact share from SQL; the plotted points are a sample
      return {
        ...base(),
        grid: { left: 8, right: 16, top: 16, bottom: 30, containLabel: true },
        xAxis: valueAxis((v) => `${v}%`, { min: 0, max: 100, interval: 20, name: "customers, smallest spenders first", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.mute, fontSize: 11 } }),
        yAxis: valueAxis((v) => `${v}%`, { min: 0, max: 100, interval: 20 }),
        tooltip: {
          ...base().tooltip,
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: C.axis } },
          formatter: (ps) => {
            const p = ps.find((x) => x.seriesName === "Lorenz curve");
            if (!p) return "";
            const [x, y] = p.value;
            return tipTitle(`Smallest ${pct(x, 0)} of customers`) + tipRow("Their share of revenue", pct(y)) + tipRow("Largest " + pct(100 - x, 0) + " bring", pct(100 - y));
          },
        },
        graphic: [{
          type: "group", left: 76, top: 26,
          children: [
            { type: "text", style: { text: "GINI", fill: C.mute, font: `500 10px JetBrains Mono, monospace` } },
            { type: "text", top: 14, style: { text: rows[0].gini.toFixed(2), fill: C.ink, font: `400 34px Fraunces, Georgia, serif` } },
          ],
        }],
        series: [
          {
            name: "Perfect equality", type: "line", data: [[0, 0], [100, 100]], symbol: "none", silent: true,
            lineStyle: { color: C.mute, type: "dashed", width: 1.5 },
            endLabel: { show: true, formatter: "equality", color: C.mute, fontSize: 11, offset: [-58, -10] },
          },
          {
            name: "Lorenz curve", type: "line", data: pts, symbol: "none", smooth: false,
            lineStyle: { color: C.accent, width: 2.5 },
            areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(240,84,35,0.28)" }, { offset: 1, color: "rgba(240,84,35,0.02)" }] } },
            markLine: {
              silent: true, symbol: "none", label: { show: false },
              lineStyle: { color: C.mute, type: "dotted" },
              data: [{ xAxis: 80 }],
            },
            markPoint: {
              silent: true, symbol: "circle", symbolSize: 9,
              itemStyle: { color: C.accent, borderColor: C.surface, borderWidth: 2 },
              label: {
                show: true, position: "left", distance: 10, offset: [0, -22], color: C.ink, fontSize: 12, lineHeight: 16,
                formatter: `top 20% of customers\n→ ${pct(top20, 0)} of revenue`, align: "right",
              },
              data: [{ coord: [80, at(80)] }],
            },
          },
        ],
      };
    },
    insight(rows) {
      if (!rows.length) return "";
      const { gini: g, top1_pct: top1, top10_pct: top10 } = rows[0];   // exact shares, computed in SQL
      return `The top 10% of customers bring in <strong>${pct(top10, 0)}</strong> of revenue, and the top 1% alone bring ${pct(top1, 0)}. `
        + `A Gini coefficient of <strong>${g.toFixed(2)}</strong> (0 = everyone spends the same, 1 = one customer buys everything) is higher than the income Gini of any country. `
        + `Keeping a few hundred large accounts happy matters more than anything else.`;
    },
  },

  // ------------------------------------------------------------------ 06 RFM
  {
    id: "rfm",
    file: "06_rfm_segments.sql",
    option(rows) {
      if (!rows.length) return null;
      const labels = rows.map((r) => r.segment);
      const lbl = { show: true, position: "right", color: C.soft, fontSize: 11, formatter: (p) => `${p.value}%` };
      return {
        ...base(),
        legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, icon: "roundRect", textStyle: { color: C.soft, fontSize: 12 } },
        grid: { left: 8, right: 44, top: 34, bottom: 8, containLabel: true },
        xAxis: valueAxis((v) => `${v}%`, { splitNumber: 4 }),
        yAxis: categoryAxis(labels, { inverse: true, axisLabel: { color: C.soft, fontSize: 12 } }),
        tooltip: {
          ...base().tooltip,
          trigger: "axis",
          axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.04)" } },
          formatter: ([p]) => {
            const r = rows[p.dataIndex];
            return tipTitle(r.segment) + tipRow("Customers", `${int(r.customers)} (${pct(r.pct_customers)})`)
              + tipRow("Revenue", `${gbp(r.revenue)} (${pct(r.pct_revenue)})`) + tipRow("Avg spend", gbp(r.avg_spend))
              + tipRow("Avg orders", r.avg_orders) + tipRow("Days since last order", int(r.avg_days_since_order));
          },
        },
        series: [
          { name: "% of customers", type: "bar", data: rows.map((r) => r.pct_customers), itemStyle: { color: C.blue, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 11, barGap: "25%", label: lbl },
          { name: "% of revenue", type: "bar", data: rows.map((r) => r.pct_revenue), itemStyle: { color: C.accent, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 11, label: lbl },
        ],
      };
    },
    insight(rows) {
      const champ = rows.find((r) => r.segment === "Champions");
      const cant = rows.find((r) => r.segment === "Can't lose them");
      const risk = rows.find((r) => r.segment === "At risk");
      let text = "";
      if (champ) text += `<strong>Champions</strong> are ${pct(champ.pct_customers, 0)} of customers but bring <strong>${pct(champ.pct_revenue, 0)}</strong> of revenue. `;
      if (cant) text += `The <strong>${int(cant.customers)}</strong> "Can't lose them" customers used to order often (${cant.avg_orders} orders on average) but have been silent for about ${int(cant.avg_days_since_order)} days. They are the first people a win-back email should go to.`;
      else if (risk) text += `${int(risk.customers)} customers are "At risk": they bought before but not for about ${int(risk.avg_days_since_order)} days.`;
      return text;
    },
  },

  // -------------------------------------------------------------- 07 cohorts
  {
    id: "cohorts",
    file: "07_cohort_retention.sql",
    tall: true,
    option(rows) {
      const cohorts = [...new Set(rows.map((r) => +r.cohort_month))].sort((a, b) => a - b);
      if (!cohorts.length) return null;
      const size = new Map(rows.filter((r) => r.month_number === 0).map((r) => [+r.cohort_month, r.active_customers]));
      const later = rows.filter((r) => r.month_number > 0);
      const maxM = Math.max(1, ...later.map((r) => r.month_number));
      const months = Array.from({ length: maxM }, (_, i) => i + 1);
      const cap = Math.min(60, Math.ceil(Math.max(10, ...later.map((r) => r.retention_pct)) / 10) * 10);
      return {
        ...base(),
        grid: { left: 8, right: 8, top: 8, bottom: 70, containLabel: true },
        xAxis: categoryAxis(months.map(String), {
          name: "months after first purchase", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.mute, fontSize: 11 },
        }),
        yAxis: categoryAxis(cohorts.map((c) => `${monthShort(new Date(c))} · ${int(size.get(c))}`), {
          inverse: true, axisLine: { show: false }, axisLabel: { color: C.soft, fontSize: 11 },
        }),
        visualMap: {
          type: "continuous", min: 0, max: cap, orient: "horizontal", left: "center", bottom: 0,
          itemWidth: 10, itemHeight: 180, calculable: false, text: [`${cap}%+`, "0%"],
          textStyle: { color: C.mute, fontSize: 11 }, inRange: { color: C.seq },
        },
        tooltip: {
          ...base().tooltip,
          formatter: (p) => {
            const [mi, ci] = p.value;
            const c = cohorts[ci];
            const r = later.find((x) => +x.cohort_month === c && x.month_number === months[mi]);
            return tipTitle(`Customers who started in ${monthLong(new Date(c))}`)
              + tipRow(`Still buying after ${months[mi]} month${months[mi] > 1 ? "s" : ""}`, pct(r.retention_pct))
              + tipRow("Customers", `${int(r.active_customers)} of ${int(size.get(c))}`);
          },
        },
        series: [{
          type: "heatmap",
          data: later.map((r) => [r.month_number - 1, cohorts.indexOf(+r.cohort_month), r.retention_pct]),
          itemStyle: { borderColor: C.surface, borderWidth: 1.5, borderRadius: 3 },
          emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1 } },
        }],
      };
    },
    insight(rows) {
      const m1 = rows.filter((r) => r.month_number === 1);
      if (!m1.length) return "";
      const avg = m1.reduce((t, r) => t + r.retention_pct, 0) / m1.length;
      const later = rows.filter((r) => r.month_number > 0);
      // calendar month of a cell = cohort month + months elapsed; November = 10
      const isNov = (r) => (new Date(+r.cohort_month).getUTCMonth() + r.month_number) % 12 === 10;
      const nov = later.filter(isNov);
      const other = later.filter((r) => !isNov(r));
      const avgOf = (a) => a.reduce((t, r) => t + r.retention_pct, 0) / (a.length || 1);
      let text = `On average only <strong>${pct(avg, 0)}</strong> of new customers order again the next month. `;
      if (nov.length && avgOf(nov) > avgOf(other) * 1.15) {
        text += `The brighter diagonal stripes are each <strong>November</strong>, when lapsed customers return for Christmas stock (${pct(avgOf(nov), 0)} active vs ${pct(avgOf(other), 0)} in other months). `;
      }
      if (rows.some((r) => monthShort(r.cohort_month) === "Dec 09")) {
        text += `<span class="muted">The Dec 2009 cohort is unusually loyal because the data starts then, so it also contains every long-standing customer.</span>`;
      }
      return text;
    },
  },

  // --------------------------------------------------------------- 08 basket
  {
    id: "basket",
    file: "08_market_basket.sql",
    html(rows) {
      if (!rows.length) return '<div class="empty">Not enough orders in this selection to find pairs.</div>';
      const max = Math.max(...rows.map((r) => r.lift));
      return `<ol class="pairs">${rows.map((r, i) => `
        <li class="pair">
          <span class="pair-rank">${String(i + 1).padStart(2, "0")}</span>
          <div class="pair-names">
            <span title="${escapeHtml(r.product_a)}">${escapeHtml(titleCase(r.product_a))}</span>
            <span title="${escapeHtml(r.product_b)}"><span class="plus">+</span>${escapeHtml(titleCase(r.product_b))}</span>
            <div class="pair-meta">${int(r.orders_together)} orders together · ${pct(r.confidence_pct, 0)} confidence</div>
          </div>
          <div class="pair-lift"><b>${r.lift.toFixed(1)}×</b><small>lift</small><div class="lift-bar"><i style="width:${(r.lift / max) * 100}%"></i></div></div>
        </li>`).join("")}</ol>`;
    },
    insight(rows) {
      if (!rows.length) return "";
      const t = rows[0];
      return `<strong>${escapeHtml(titleCase(t.product_a))}</strong> and <strong>${escapeHtml(titleCase(t.product_b))}</strong> are bought together `
        + `<strong>${t.lift.toFixed(0)}×</strong> more often than chance would predict. Most top pairs are colour or design variants of the same item: customers buy whole sets, so a "complete the set" suggestion at checkout should work well.`;
    },
  },

  // -------------------------------------------------------------- 10 returns
  {
    id: "returns",
    file: "10_returns.sql",
    option(rows) {
      if (!rows.length) return null;
      const list = rows.slice(0, 12);
      return rankedBars({
        labels: list.map((r) => titleCase(r.product)),
        values: list.map((r) => r.return_rate_pct),
        fmt: (v) => `${Number(v).toFixed(v >= 10 ? 0 : 1)}%`,
        labelWidth: 170,
        highlightFirst: list[0]?.return_rate_pct > 2 * (list[1]?.return_rate_pct ?? Infinity),
        tooltip: (p) => {
          const r = list[p.dataIndex];
          return tipTitle(titleCase(r.product)) + tipRow("Sold", gbp(r.sold_value)) + tipRow("Returned", gbp(r.returned_value))
            + tipRow("Return rate", pct(r.return_rate_pct)) + tipRow("Orders", int(r.orders));
        },
      });
    },
    insight(rows, s, ctx) {
      if (!rows.length) return "";
      const [a, b] = rows;
      let text = "";
      if (a.stock_code === "23166") {
        text = `The <strong>Medium Ceramic Top Storage Jar</strong> looks like a disaster (${pct(a.return_rate_pct, 0)} returned), but it is really one order of 74,215 jars (£77k) that was cancelled 16 minutes after it was placed, which looks like a data-entry error. `
          + (b ? `Leaving it out, the highest is <strong>${escapeHtml(titleCase(b.product))}</strong> at ${pct(b.return_rate_pct, 0)}.` : "");
      } else {
        text = `<strong>${escapeHtml(titleCase(a.product))}</strong> has the highest return rate: ${pct(a.return_rate_pct, 0)} of its sales value came back.`;
      }
      if (ctx.kpis) text += ` Across all products, ${pct(ctx.kpis.return_rate_pct)} of sales value is returned.`;
      return text;
    },
    note: () => "Products with at least 100 orders.",
  },
];

// ---------------------------------------------------------------- KPI tiles
export const KPI_TILES = [
  { key: "net_revenue", label: "Net revenue", sub: "after returns", fmt: gbpShort },
  { key: "orders", label: "Orders", sub: "invoices, excl. returns", fmt: int },
  { key: "customers", label: "Customers", sub: "with a customer ID", fmt: int },
  { key: "avg_order_value", label: "Avg order", sub: "gross value per invoice", fmt: (v) => `£${int(v)}` },
  { key: "units_sold", label: "Units sold", sub: "items shipped", fmt: compact },
  { key: "return_rate_pct", label: "Return rate", sub: "of sales value", fmt: (v) => pct(v, 1) },
];

export function funnelHTML(rep) {
  const step = (cls, val, lbl) => `<div class="fn-step ${cls}"><div class="fn-val">${val}</div><div class="fn-lbl">${lbl}</div></div>`;
  return step("", int(rep.raw_rows), "raw rows in the Excel file")
    + step("is-minus", `−${int(rep.sheet_overlap)}`, "rows repeated in both sheets")
    + step("is-minus", `−${int(rep.non_product_or_invalid)}`, "postage, fees, write-offs, bad prices")
    + step("is-minus", `−${int(rep.exact_duplicates)}`, "exact duplicate lines")
    + step("is-total", int(rep.clean_rows), `clean sales lines · ${int(rep.products)} products`);
}
