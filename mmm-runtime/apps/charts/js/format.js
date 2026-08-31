/* 数字与期间怎么写出来 —— 全部跟着 metricMeta 走，不跟着感觉走。
 *
 * 百分比带 %，金额带 ¥，其余压成 k / 万 / 亿。单位和格式来自登记表，不是从数值大小
 * 猜的：一个写着 68 的指标，是 68 元还是 68% 决定了图上那根柱子说的是两件事。
 *
 * 取整只在这里发生（契约 R4）。归约返回的是原始 float64，两端比对比的也是原始值，
 * 所以一次显示上的取整永远不可能盖住一次真实的差异。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.Fmt = api; }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MONTH_LABEL = ["", "1月", "2月", "3月", "4月", "5月", "6月",
                     "7月", "8月", "9月", "10月", "11月", "12月"];

  /** 桶键 → 人念得出来的写法。`202401` → `2024-01`，`2024Q1` → `2024 Q1`。 */
  function period(key) {
    key = String(key);
    if (/^\d{6}$/.test(key)) { return key.slice(0, 4) + "-" + key.slice(4); }
    if (/^\d{4}[QH]\d$/.test(key)) { return key.slice(0, 4) + " " + key.slice(4); }
    return key;
  }

  function monthName(n) { return MONTH_LABEL[n | 0] || ""; }

  /** 一个值，按它自己的格式。空是「—」，不是 0 —— 图上是断开，表里也得是断开。 */
  function value(v, meta) {
    if (v === null || v === undefined) { return "—"; }
    meta = meta || {};
    var kind = String(meta.numberFormat || "number");
    if (kind === "percent") { return trim(v, 2) + "%"; }
    if (kind === "money") { return (meta.unit || "¥") + compact(v); }
    if (kind === "integer") { return compact(v); }
    if (kind === "index") { return trim(v, 2) + (meta.unit || ""); }
    return compact(v);
  }

  /** 轴刻度：比单元格短，不带单位 —— 单位写在轴标题上，写两遍会把刻度挤没。 */
  function tick(v, meta) {
    if (v === null || v === undefined) { return ""; }
    var kind = String((meta || {}).numberFormat || "number");
    if (kind === "percent") { return trim(v, 1) + "%"; }
    return compact(v);
  }

  /** 压缩写法。**万 / 亿 保留一位小数**，整数位加千分位 —— `300.0万`、`1,200.0万`。
   *
   * 不修剪末尾的零：一列刻度里 `300万` 和 `312.5万` 并排，宽度与小数位都在跳，
   * 读的人要重新对一次位。保留一位之后整列对齐，也和产品一致。 */
  function compact(v) {
    var n = Number(v), sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n >= 1e8) { return sign + group(n / 1e8, 1) + "亿"; }
    if (n >= 1e4) { return sign + group(n / 1e4, 1) + "万"; }
    if (n >= 1000) { return sign + group(n, 0); }
    if (n >= 1) { return sign + trim(n, 1); }
    return sign + trim(n, 2);
  }

  function group(v, digits) {
    var text = Number(v).toFixed(digits);
    var dot = text.indexOf(".");
    var whole = dot < 0 ? text : text.slice(0, dot);
    var rest = dot < 0 ? "" : text.slice(dot);
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
  }

  function trim(v, digits) {
    var text = Number(v).toFixed(digits);
    if (text.indexOf(".") >= 0) {
      text = text.replace(/0+$/, "").replace(/\.$/, "");
    }
    return text;
  }

  /** 同比：正负号永远显式，因为 +3% 和 3% 在一张表里读起来不是一件事。 */
  function pct(v) {
    if (v === null || v === undefined) { return "—"; }
    return (v >= 0 ? "+" : "") + trim(v, 1) + "%";
  }

  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { period: period, monthName: monthName, value: value, tick: tick,
           pct: pct, compact: compact, esc: esc };
}));
