/* 归约内核 —— 与 mmm_engine/charts/fold.py 是同一份契约的两个实现。
 *
 * 契约在 shared/fold-contract.md。四百个枚举出来的筛选态会在生成页面之前跨两端
 * 重放比对，比不过就不写页面。所以下面每一条规则都不是偏好：它们都是两个讲道理的
 * 实现会给出不同答案的地方，所以每一条都被钉死了。
 *
 * 这个文件里没有任何判断。哪些行在范围内、哪个指标求和哪个取平均、哪条是响应、
 * 单位是什么、画成什么形状，全部由 payload 带过来。这里只做掩码和归约。
 *
 * 页面内联它，node 也 import 它 —— 同一批字节，所以比对才有意义。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.Fold = api; }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 粒度：id → 中文叙述标签 / 控件标签 / 月数。**这是一张查找表，不是顺序。**
  // 下面两个顺序是有意分开的，必须保持分开。
  var GRAINS = [
    { id: "month", label: "月", en: "Month", months: 1 },
    { id: "quarter", label: "季", en: "Quarter", months: 3 },
    { id: "half", label: "半年", en: "Half-year", months: 6 },
    { id: "year", label: "年", en: "Year", months: 12 }
  ];

  // 按钮顺序，粗 → 细。纯展示。
  var GRAIN_DISPLAY = ["year", "half", "quarter", "month"];

  // R7 降级顺序，**细 → 粗**。撑不起的粒度降到最细可用的那一档。
  //
  // 这不是按钮顺序，也永远不能改成跟着按钮顺序走。从显示数组里读降级顺序，会把
  // 「十二个月撑不起一年」变成「十二个月就是一年」—— 本来是一条趋势的地方变成一根柱子，
  // 正是 R6 要露出来的那个假象。这两个数组在按钮需要按产品重排之前看起来像重复，
  // 重排之后才发现其中一个回答的是另一个问题。
  var GRAIN_FALLBACK = ["month", "quarter", "half", "year"];

  var GRAIN_BY_ID = {};
  GRAINS.forEach(function (g) { GRAIN_BY_ID[g.id] = g; });

  var LEVELS = ["l4", "l5", "l6", "l7", "l8"];

  // 作用于全图的列：动它们，销量底图跟着动。其余只动叠加层 —— 不管你在看哪个文件、
  // 哪个子因子，判断投入产出的那条基准必须站住不动。
  var SCOPE_BOTH = ["brand", "channelType", "region"];
  var SCOPE_OVERLAY = ["source"];

  var CODE = {
    brand: "b", channelType: "ct", region: "r", source: "s",
    l4: "l4", l5: "l5", l6: "l6", l7: "l7", l8: "l8", metric: "m"
  };

  var FULL = 1.0;

  // ── 时间桶 ─────────────────────────────────────────────────────────

  function bucketOf(month, grain) {
    month = month | 0;
    var year = Math.floor(month / 100), mm = month % 100;
    if (grain === "month") { return pad4(year) + pad2(mm); }
    if (grain === "quarter") { return pad4(year) + "Q" + (Math.floor((mm - 1) / 3) + 1); }
    if (grain === "half") { return pad4(year) + "H" + (mm <= 6 ? 1 : 2); }
    if (grain === "year") { return pad4(year); }
    throw new Error("unknown grain " + grain);
  }

  // 覆盖率是对着日历算的，不是对着交付了什么算的：装了两个月的季度就是三分之二个
  // 季度，在它上面求和得到的就是三分之二个数。对着交付的月份算，每个桶都会报成
  // 完整的，而 R6 存在的意义正是把这个假象露出来。
  function bucketMonths(key, grain) {
    if (grain === "month") { return [parseInt(key, 10)]; }
    var year = parseInt(key.slice(0, 4), 10), out = [], i;
    if (grain === "quarter") {
      var first = (parseInt(key[5], 10) - 1) * 3 + 1;
      for (i = 0; i < 3; i++) { out.push(year * 100 + first + i); }
      return out;
    }
    if (grain === "half") {
      var start = parseInt(key[5], 10) === 1 ? 1 : 7;
      for (i = 0; i < 6; i++) { out.push(year * 100 + start + i); }
      return out;
    }
    if (grain === "year") {
      for (i = 1; i <= 12; i++) { out.push(year * 100 + i); }
      return out;
    }
    throw new Error("unknown grain " + grain);
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pad4(n) { return ("000" + n).slice(-4); }

  function axis(periods, grain) {
    var order = [], members = {}, i, key;
    for (i = 0; i < periods.length; i++) {
      key = bucketOf(periods[i], grain);
      if (!members.hasOwnProperty(key)) { members[key] = []; order.push(key); }
      members[key].push(periods[i] | 0);
    }
    return { order: order, members: members };
  }

  // ── 筛选 ───────────────────────────────────────────────────────────

  // 名字对不上的取值选中的是空集，而不是「不筛选」。反过来会把一个拼写错误变成
  // 「没有筛选」，而读的人永远不会发现这件事发生过。
  function codesFor(panel, column, values) {
    var table = (panel.dict || {})[column] || [], out = {}, i, at;
    for (i = 0; i < values.length; i++) {
      at = table.indexOf(values[i]);
      if (at >= 0) { out[at] = true; }
    }
    return out;
  }

  function cardIndex(panel, path) {
    var cards = panel.cards || [], i;
    for (i = 0; i < cards.length; i++) { if (cards[i].path === path) { return i; } }
    return -1;
  }

  function cardOf(panel, path) {
    var i = cardIndex(panel, path);
    return i >= 0 ? (panel.cards || [])[i] : null;
  }

  function blankState(panel, cardPath) {
    var cards = panel.cards || [], levels = {}, i;
    for (i = 0; i < LEVELS.length; i++) { levels[LEVELS[i]] = ""; }
    if (cardPath === undefined || cardPath === null) {
      cardPath = cards.length ? cards[0].path : "";
    }
    return {
      card: cardPath, grain: "month", brand: [], channelType: [], region: [],
      source: [], levels: levels, indicators: [], compareMonth: 0
    };
  }

  // 空 = 这张卡自己的默认六条，不是全部。这是唯一一个「空表示默认」而不是
  // 「空表示不筛选」的控件，两端都写明白：空的指标选择器不可能表示「画四十条」——
  // 色板只有八个位，图会没法看。
  function selectedMetrics(panel, state) {
    var chosen = (state.indicators || []).filter(function (m) { return !!m; });
    if (chosen.length) { return chosen.slice(); }
    var card = cardOf(panel, state.card);
    return ((card || {}).defaultMetrics || []).slice();
  }

  // 空格（编码 -1）只有在该列完全没有筛选时才通过。这是 R5：没有渠道也没有区域的
  // 全国口径行，在不筛选的总量里，在任何一次具体选择之外。
  function matches(record, wanted) {
    for (var code in wanted) {
      if (!wanted.hasOwnProperty(code)) { continue; }
      var value = record.hasOwnProperty(code) ? record[code] : -1;
      if (!wanted[code][value]) { return false; }
    }
    return true;
  }

  function mask(panel, state, scope) {
    var wanted = {}, i, column, values, level;
    for (i = 0; i < SCOPE_BOTH.length; i++) {
      column = SCOPE_BOTH[i];
      values = state[column] || [];
      if (values.length) { wanted[CODE[column]] = codesFor(panel, column, values); }
    }
    if (scope === "overlay") {
      for (i = 0; i < SCOPE_OVERLAY.length; i++) {
        column = SCOPE_OVERLAY[i];
        values = state[column] || [];
        if (values.length) { wanted[CODE[column]] = codesFor(panel, column, values); }
      }
      for (i = 0; i < LEVELS.length; i++) {
        level = LEVELS[i];
        var picked = (state.levels || {})[level] || "";
        if (picked) { wanted[CODE[level]] = codesFor(panel, level, [picked]); }
      }
    }
    return wanted;
  }

  // ── 归约 ───────────────────────────────────────────────────────────

  // 封闭的算子集。就这四个，不再多：让页面的算术可重放的，正是「没有任何一个分支
  // 能对同一份 payload 给出不同答案」。因子树允许人定的、而这里做不了的规则
  //（weighted_average、distinct_count），由 validation.panel **在工具里**替换掉，
  // 并把替换记在这个指标上。绝不在这里替换。
  var OPS = ["sum", "average", "min", "max"];

  // R2 · 求和跳过空值；取平均的除数是有贡献的格子数，不是期数。
  // 十二个月里观测到八个月的指标，它的平均是那八个值的平均。除以十二等于把
  // 「没有」读成零，而这正是 R3 在别处禁止的那件事。
  //
  // min / max 在这里，是因为因子树允许人定它们，而一条库存水位真的是 min 不是 sum。
  // 它们与顺序无关，所以跨端保持精确不需要额外代价。
  function reduce(cells, how) {
    var seen = [], i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i] !== null && cells[i] !== undefined) { seen.push(cells[i]); }
    }
    if (!seen.length) { return null; }        // R3 · 缺口还是缺口
    if (how === "min" || how === "max") {
      var best = Number(seen[0]);
      for (i = 1; i < seen.length; i++) {
        var value = Number(seen[i]);
        if (how === "min" ? value < best : value > best) { best = value; }
      }
      return best;
    }
    var total = 0.0;
    for (i = 0; i < seen.length; i++) { total += Number(seen[i]); }  // R1 · 固定顺序
    return how === "average" ? total / seen.length : total;
  }

  function aggOf(panel, metric) {
    var meta = (panel.metricMeta || {})[metric] || {};
    var how = String(meta.agg || "sum");
    return OPS.indexOf(how) >= 0 ? how : "sum";
  }

  function fold(panel, state) {
    var grain = state.grain || "month";
    var periods = (panel.periods || []).map(function (p) { return p | 0; });
    var built = axis(periods, grain);
    var keys = built.order, members = built.members;
    var slot = {}, i, j, k;
    for (i = 0; i < periods.length; i++) { slot[periods[i]] = i; }

    var cardAt = cardIndex(panel, state.card);
    var metrics = selectedMetrics(panel, state);
    var names = (panel.dict || {}).metric || [];
    var wantedNames = {};
    for (i = 0; i < metrics.length; i++) { wantedNames[metrics[i]] = true; }

    var overlay = mask(panel, state, "overlay");
    var both = mask(panel, state, "both");

    var buckets = {};
    for (i = 0; i < metrics.length; i++) {
      buckets[metrics[i]] = {};
      for (j = 0; j < keys.length; j++) { buckets[metrics[i]][keys[j]] = []; }
    }

    var records = panel.series || [], dropped = 0;
    for (i = 0; i < records.length; i++) {
      var record = records[i];
      if ((record.c === undefined ? -1 : record.c) !== cardAt) { continue; }
      var code = record.m === undefined ? -1 : record.m;
      var metric = (code >= 0 && code < names.length) ? names[code] : "";
      if (!wantedNames[metric]) { continue; }
      if (!matches(record, overlay)) {
        // 被具体筛选排除掉的空格是 R5 在起作用，读的人必须被告知：图上看起来
        // 只是线变短了。
        for (var column in overlay) {
          if (overlay.hasOwnProperty(column)
              && (record[column] === undefined ? -1 : record[column]) === -1) {
            dropped += 1;
            break;
          }
        }
        continue;
      }
      var values = record.v || [];
      for (j = 0; j < keys.length; j++) {
        var pool = buckets[metric][keys[j]], span = members[keys[j]];
        for (k = 0; k < span.length; k++) {
          var at = slot[span[k]];
          if (at !== undefined && at < values.length) { pool.push(values[at]); }
        }
      }
    }

    var series = {};
    for (i = 0; i < metrics.length; i++) {
      var how = aggOf(panel, metrics[i]);
      var line = [];
      for (j = 0; j < keys.length; j++) {
        line.push(reduce(buckets[metrics[i]][keys[j]], how));
      }
      series[metrics[i]] = { agg: how, v: line };
    }

    var backdrop = foldResponse(panel, both, keys, members, slot);

    // R6 · 日历说没铺满的桶就说出来，不管里面装的是什么
    var partial = {}, bounds = {};
    for (j = 0; j < keys.length; j++) {
      var span2 = bucketMonths(keys[j], grain), have = 0;
      for (k = 0; k < span2.length; k++) {
        if (slot[span2[k]] !== undefined) { have += 1; }
      }
      var cover = have / span2.length;
      if (cover < FULL) { partial[keys[j]] = cover; }
      bounds[keys[j]] = [members[keys[j]][0], members[keys[j]][members[keys[j]].length - 1]];
    }

    return {
      periods: keys, bounds: bounds,
      response: backdrop.values, responseMetric: backdrop.metric,
      series: series, partial: partial, dropped: dropped
    };
  }

  // 底图跟着品牌 / 渠道 / 区域动，永远不跟着叠加层动。
  // 「MT 的销量」和「EC 的销量」本来就是两条不同的曲线，所以渠道筛选必须动它；
  // 一条花费来自哪个文件、屏幕上是哪个子因子，则必须不动它 —— 底图的全部意义就是
  // 你四处看的时候，被拿来判断投入的那个东西站在原地。
  function foldResponse(panel, both, keys, members, slot) {
    var info = panel.response || {};
    var blank = keys.map(function () { return null; });
    if (!info.present) { return { values: blank, metric: "" }; }
    var how = String(((info.meta || {}).agg)) === "average" ? "average" : "sum";
    var pools = {}, i, j, k;
    for (j = 0; j < keys.length; j++) { pools[keys[j]] = []; }
    var records = panel.responseSeries || [];
    for (i = 0; i < records.length; i++) {
      if (!matches(records[i], both)) { continue; }
      var values = records[i].v || [];
      for (j = 0; j < keys.length; j++) {
        var span = members[keys[j]];
        for (k = 0; k < span.length; k++) {
          var at = slot[span[k]];
          if (at !== undefined && at < values.length) { pools[keys[j]].push(values[at]); }
        }
      }
    }
    return {
      values: keys.map(function (key) { return reduce(pools[key], how); }),
      metric: String(info.metric || "")
    };
  }

  // ── 哪些粒度按钮是活的 ─────────────────────────────────────────────

  // R7 · 按筛选态实时重算，不是一页算一次。选了只有十二个月的区域，「年」必须
  // 当场置灰。按钮只置灰不删：一行会变长短的控件读起来像出了 bug，而且读的人
  // 分不清「这里不适用」和「没有了」。
  // 这个筛选态下真的有数的那些月份。不是面板的整条轴：一个去年才开始报数的区域
  // 只有十二个月，粒度按钮要反映的是**它**，不是整张表跨的三年。
  function livePeriods(panel, state) {
    var scoped = shallow(state);
    scoped.grain = "month";
    var folded = fold(panel, scoped);
    var names = Object.keys(folded.series);
    var out = [];
    folded.periods.forEach(function (key, i) {
      if (folded.response[i] !== null && folded.response[i] !== undefined) {
        out.push(parseInt(key, 10));
        return;
      }
      for (var j = 0; j < names.length; j++) {
        var v = folded.series[names[j]].v[i];
        if (v !== null && v !== undefined) { out.push(parseInt(key, 10)); return; }
      }
    });
    return out;
  }

  function grainsFor(panel, state) {
    var periods = livePeriods(panel, state);
    return GRAIN_DISPLAY.map(function (gid) {   // 按钮顺序，粗 -> 细
      var g = GRAIN_BY_ID[gid];
      var keys = axis(periods, gid).order;
      if (keys.length >= 2) {
        return { id: gid, label: g.label, en: g.en, supported: true, why: "" };
      }
      return {
        id: gid, label: g.label, en: g.en, supported: false,
        why: "这一片只有 " + periods.length + " 个月，按" + g.label
             + "只有 " + keys.length + " 个点"
      };
    });
  }

  function resolveGrain(panel, state) {
    var wanted = state.grain || "month";
    var live = {}, i;
    grainsFor(panel, state).forEach(function (g) { live[g.id] = g.supported; });
    if (live[wanted]) { return { grain: wanted, fellBackFrom: "" }; }
    for (i = 0; i < GRAIN_FALLBACK.length; i++) {   // 降级顺序，细 -> 粗。不是按钮顺序。
      if (live[GRAIN_FALLBACK[i]]) {
        return { grain: GRAIN_FALLBACK[i], fellBackFrom: wanted };
      }
    }
    return { grain: "month", fellBackFrom: wanted };
  }

  // ── 年度表 ─────────────────────────────────────────────────────────

  // compareMonth 为 0 是整年；1–12 把每一年都限制到那个自然月，于是同比变成
  // 「今年三月对去年三月」。季节性生意里整年对整年既盖住了季节，又会因为今年
  // 还没走完而无端惩罚它；同月对同月才是干净的那一种。
  function yearly(panel, state, compareMonth) {
    compareMonth = compareMonth | 0;
    var months = (panel.periods || []).map(function (p) { return p | 0; });
    if (compareMonth) {
      months = months.filter(function (m) { return m % 100 === compareMonth; });
    }
    var years = [], seenYear = {};
    months.forEach(function (m) {
      var y = Math.floor(m / 100);
      if (!seenYear[y]) { seenYear[y] = true; years.push(y); }
    });
    years.sort(function (a, b) { return a - b; });

    var scoped = shallow(state);
    scoped.grain = "month";
    var folded = fold(panel, scoped);
    var index = {};
    folded.periods.forEach(function (key, i) { index[parseInt(key, 10)] = i; });

    function row(name, values, how) {
      var cells = years.map(function (year) {
        var pool = [];
        months.forEach(function (m) {
          if (Math.floor(m / 100) === year && index[m] !== undefined) {
            pool.push(values[index[m]]);
          }
        });
        return reduce(pool, how);
      });
      return { metric: name, agg: how, values: cells, yoy: yoy(cells) };
    }

    var rows = [];
    if (folded.responseMetric) {
      var how = String((((panel.response || {}).meta) || {}).agg) === "average"
        ? "average" : "sum";
      rows.push(row(folded.responseMetric, folded.response, how));
    }
    selectedMetrics(panel, state).forEach(function (metric) {
      var block = folded.series[metric] || { agg: "sum", v: [] };
      rows.push(row(metric, block.v, block.agg));
    });
    return { years: years, rows: rows, compareMonth: compareMonth };
  }

  // 和前一列比，而前一列不一定是前一年。中间缺了一年，「上一列」和「去年」就是
  // 两件事。调用方会把年份标出来，所以对比是看得懂的；它绝不能做的是把缺掉的
  // 那一年悄悄补上。
  function yoy(cells) {
    var out = [null], i;
    for (i = 1; i < cells.length; i++) {
      var now = cells[i], before = cells[i - 1];
      if (now === null || before === null || before === 0) { out.push(null); }
      else { out.push((now - before) / Math.abs(before) * 100.0); }
    }
    return out;
  }

  // ── L4–L8 的梯子 ───────────────────────────────────────────────────

  // 在已选路径下什么都没有的那一层返回空数组 —— 调用方画成虚线灰框而不是藏起来，
  // 梯子的长度才不变，读的人也才看得见「这个因子就是没有报到那么深」。
  function cascadeOptions(panel, cardPath, chosen) {
    var cardAt = cardIndex(panel, cardPath);
    var tables = panel.dict || {};
    chosen = chosen || {};
    var out = {};
    LEVELS.forEach(function (level, depth) {
      var above = {}, i;
      for (i = 0; i < depth; i++) {
        var higher = LEVELS[i], value = chosen[higher] || "";
        if (value) { above[CODE[higher]] = codesFor(panel, higher, [value]); }
      }
      var codes = {}, records = panel.series || [];
      for (i = 0; i < records.length; i++) {
        var record = records[i];
        if ((record.c === undefined ? -1 : record.c) !== cardAt) { continue; }
        if (!matches(record, above)) { continue; }
        var code = record[CODE[level]] === undefined ? -1 : record[CODE[level]];
        if (code >= 0) { codes[code] = true; }
      }
      var names = tables[level] || [];
      out[level] = Object.keys(codes)
        .map(Number).sort(function (a, b) { return a - b; })
        .filter(function (c) { return c < names.length; })
        .map(function (c) { return names[c]; });
    });
    return out;
  }

  // 这张卡在某一列上真正能给出的取值，按当前路径收窄。该列自己的筛选先摘掉 ——
  // 一个把你还没选的选项藏起来的控件，是一个你没法改主意的控件。
  //
  // 收窄对 `source` 最要紧：一个项目有五六个数据来源，一个因子通常只来自其中一个。
  // 在只有一个来源的卡上摆出六个，等于其中五个一点就把图清空，读的人从中学到的
  // 只有不信任。
  //
  // **两端都动的那三列还要读销量底图。** 品牌、渠道、区域切的是底图和驱动两边，而区域
  // 通常只出现在底图上 —— 驱动大多按全国报。只数驱动的话，每张卡的区域列表都是空的，
  // 读的人到不了一个归约、黄金集、`validation.read --region` 全都支持的视角。选中之后
  // 驱动会按 R5 全部退出画面，那本身就是关于这个因子怎么报数的一个真答案，页面会把
  // 退出的条数写出来。
  function optionsFor(panel, state, column) {
    var cardAt = cardIndex(panel, state.card);
    var wanted = mask(panel, state, "overlay");
    delete wanted[CODE[column]];
    var names = (panel.dict || {})[column] || [], codes = {}, i;
    var records = panel.series || [];
    for (i = 0; i < records.length; i++) {
      var record = records[i];
      if ((record.c === undefined ? -1 : record.c) !== cardAt) { continue; }
      if (!matches(record, wanted)) { continue; }
      var code = record[CODE[column]] === undefined ? -1 : record[CODE[column]];
      if (code >= 0) { codes[code] = true; }
    }
    if (SCOPE_BOTH.indexOf(column) >= 0) {
      var base = panel.responseSeries || [];
      for (i = 0; i < base.length; i++) {
        var got = base[i][CODE[column]] === undefined ? -1 : base[i][CODE[column]];
        if (got >= 0) { codes[got] = true; }
      }
    }
    return Object.keys(codes).map(Number).sort(function (a, b) { return a - b; })
      .filter(function (c) { return c < names.length; })
      .map(function (c) { return names[c]; });
  }

  // 这个数量才让控件的标签说得出实话：「指标（央视下 12 个）」告诉读的人这份列表
  // 是被下钻收窄过的。一份悄悄变短的列表读起来像 bug。
  function indicatorOptions(panel, state) {
    return optionsFor(panel, state, "metric");
  }

  function sourceOptions(panel, state) {
    return optionsFor(panel, state, "source");
  }

  // ── 状态键，两端共用 ───────────────────────────────────────────────

  // 两端用同样的方式拼，所以一次比对失败能报出一个人可以贴回去的状态。列表排序；
  // 除了 indicators 之外，缺键与空列表处处等价 —— 在 indicators 上，这个区别就是默认值。
  function stateKey(state) {
    var levels = state.levels || {};
    var parts = ["card=" + (state.card || ""), "grain=" + (state.grain || "month")];
    ["brand", "channelType", "region", "source", "indicators"].forEach(function (column) {
      var values = (state[column] || []).map(String).slice().sort();
      parts.push(column + "=" + values.join("|"));
    });
    LEVELS.forEach(function (level) { parts.push(level + "=" + (levels[level] || "")); });
    parts.push("compareMonth=" + (state.compareMonth | 0));
    return parts.join(";");
  }

  function shallow(state) {
    var out = {}, key;
    for (key in state) { if (state.hasOwnProperty(key)) { out[key] = state[key]; } }
    return out;
  }

  return {
    GRAINS: GRAINS, GRAIN_DISPLAY: GRAIN_DISPLAY,
    GRAIN_FALLBACK: GRAIN_FALLBACK, GRAIN_BY_ID: GRAIN_BY_ID,
    LEVELS: LEVELS, SCOPE_BOTH: SCOPE_BOTH,
    SCOPE_OVERLAY: SCOPE_OVERLAY,
    bucketOf: bucketOf, bucketMonths: bucketMonths,
    blankState: blankState, cardOf: cardOf, cardIndex: cardIndex,
    selectedMetrics: selectedMetrics, aggOf: aggOf,
    fold: fold, grainsFor: grainsFor, resolveGrain: resolveGrain,
    yearly: yearly, cascadeOptions: cascadeOptions,
    indicatorOptions: indicatorOptions, sourceOptions: sourceOptions,
    optionsFor: optionsFor, stateKey: stateKey,
    livePeriods: livePeriods
  };
}));
