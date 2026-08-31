/* 年度表 —— 行是响应加每个选中指标，列是每一年，每格右上角带自己的同比。
 *
 * 每一行标着自己的汇总符号（Σ / avg）与单位，因为一张把求和的花费和取平均的铺货率
 * 放在一起的表，不标口径就没法读。
 *
 * **同月对比**：选 3 月，每一年就只取 3 月，同比变成「今年三月对去年三月」。
 * 季节性生意里整年对整年既盖住了季节，又会因为今年还没走完而无端惩罚它。这个选择器
 * 放在表上而不是放在筛选里，是因为它只改这张表，不改上面那张图。
 *
 * 这张表还兼着一件事：色板里 aqua / yellow / magenta 在浅色底下低于 3:1，补偿规则是
 * 可见的直接标签**或**表格视图。所以每张图都必须留着它，这不是可选项。
 */
(function (root, factory) {
  var api = factory(root.Fold, root.Fmt);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.Table = api; }
}(typeof self !== "undefined" ? self : this, function (Fold, Fmt) {
  "use strict";

  function yearly(panel, state) {
    var compare = state.compareMonth | 0;
    var table = Fold.yearly(panel, state, compare);
    var head = '<th scope="col">指标</th><th scope="col">口径</th>';
    table.years.forEach(function (year) {
      head += '<th scope="col">' + year + "</th>";
    });

    var body = "";
    table.rows.forEach(function (row) {
      var meta = metaFor(panel, row.metric);
      body += '<tr><th scope="row">' + Fmt.esc(row.metric) + "</th>";
      body += '<td class="agg-cell" title="' + Fmt.esc(aggWhy(meta)) + '">'
        + Fmt.esc(row.agg === "average" ? "avg" : "Σ")
        + (meta.unit ? " " + Fmt.esc(meta.unit) : "") + "</td>";
      row.values.forEach(function (value, i) {
        var change = row.yoy[i];
        body += "<td>" + Fmt.esc(Fmt.value(value, meta));
        if (change !== null && change !== undefined) {
          body += '<span class="yoy ' + (change >= 0 ? "up" : "down") + '">'
            + Fmt.esc(Fmt.pct(change)) + "</span>";
        }
        body += "</td>";
      });
      body += "</tr>";
    });

    return '<div class="yearly">' + picker(compare)
      + '<div class="scroll"><table><caption>'
      + Fmt.esc(caption(compare))
      + "</caption><thead><tr>" + head + "</tr></thead><tbody>"
      + body + "</tbody></table></div></div>";
  }

  function caption(compare) {
    if (!compare) {
      return "整年对整年。同比是和列表里的上一年比，不一定是上一个自然年 —— "
        + "中间缺年时看年份标签。";
    }
    return "每一年只取 " + Fmt.monthName(compare)
      + "，所以同比是今年这个月对去年同一个月。";
  }

  function picker(compare) {
    var out = '<label class="compare">同比口径 '
      + '<select data-role="compare-month"><option value="0"'
      + (compare ? "" : " selected") + ">整年</option>";
    for (var m = 1; m <= 12; m++) {
      out += '<option value="' + m + '"' + (compare === m ? " selected" : "") + ">"
        + Fmt.monthName(m) + "</option>";
    }
    return out + "</select></label>";
  }

  function metaFor(panel, metric) {
    if (metric === ((panel.response || {}).metric)) {
      return (panel.response || {}).meta || {};
    }
    return (panel.metricMeta || {})[metric] || {};
  }

  // 汇总口径的三个来源，从权威到推断。页面把它写进提示框，因为一个求和的花费和一个
  // 求和的摄氏度在图上长得一模一样 —— 区别只在这句话里。
  var AGG_SOURCE = {
    tree: "因子树里人定的",
    coverage: "指标登记表里的（那一列本身是按名字推断出来的）",
    classifier: "按名字推断的，没有人定过",
    conflict: "两个因子定得不一致，本轮按取平均"
  };

  function aggWhy(meta) {
    var how = meta.agg === "average" ? "跨期与跨切片取平均"
      : (meta.agg === "min" ? "取最小值"
         : (meta.agg === "max" ? "取最大值" : "跨期与跨切片求和"));
    var line = how + " · " + (AGG_SOURCE[meta.source] || "来源不明");
    return meta.aggNote ? line + " · " + meta.aggNote : line;
  }

  return { yearly: yearly };
}));
