/* 一张卡的图 —— 双轴，角色定死。
 *
 * 响应（销量）：填充面积，青色，**右轴**，背景板。
 * 花费类：折线，**左轴**。
 * 其余一切：柱状，**左轴**。
 *
 * 为什么销量在右、驱动在左：销量和驱动的单位根本不同（箱 vs 元 vs %），不能共用一条
 * 刻度；而图上大多数序列是驱动，所以把默认先读的那条轴（左轴）留给它们，销量作次轴
 * 背景。这是定过的决定，不重新讨论 —— 同一份数据换个形状，读起来就是两个发现。
 *
 * 这个文件是 Python 侧 primitives.py + figures.py 的移植，也是**唯一**的渲染器。
 * 两个渲染器漂移的风险不是被管理掉的，是被构造消除的：Python 侧已经不画任何几何。
 */
(function (root, factory) {
  var api = factory(root.Fmt);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.Render = api; }
}(typeof self !== "undefined" ? self : this, function (Fmt) {
  "use strict";

  var W = 900, H = 380;
  var PAD = { l: 62, r: 68, t: 18, b: 46 };
  var PLOT_W = W - PAD.l - PAD.r;
  var PLOT_H = H - PAD.t - PAD.b;

  //: 八个分类色位，按名称排序分配。**不许按排名分配** —— MT 掉到第三名就换个颜色，
  //: 那不是配色变化，那是误导。第九个及以后折进 --muted。
  var SLOTS = 8;

  function slotVar(index) {
    return index < SLOTS ? "var(--series-" + (index + 1) + ")" : "var(--muted)";
  }

  /** 色位按**这张卡的全部候选指标**排序分配，不按当前选中的子集。
   *
   * 按选中集分配的话，用户加第七个指标会让前六条全部换色 —— 同一条曲线在两次点击
   * 之间变了颜色，读的人会以为它变成了别的东西。 */
  function palette(card) {
    var names = (card.metrics || []).slice().sort();
    var map = {};
    names.forEach(function (name, i) { map[name] = slotVar(i); });
    return map;
  }

  // ── 坐标 ───────────────────────────────────────────────────────────

  function xAt(i, n) {
    return PAD.l + PLOT_W * (i + 0.5) / Math.max(n, 1);
  }

  function band(n) { return PLOT_W / Math.max(n, 1); }

  function scale(lo, hi) {
    var span = (hi - lo) || 1;
    return function (v) { return PAD.t + PLOT_H * (1 - (v - lo) / span); };
  }

  /** 域。`zeroBase` 为真时含零。
   *
   * 左轴（驱动，多为柱状）含零：一根不从零起的柱子把 5% 的差画成 50% 的差。
   * **右轴（响应，面积底图）不含零** —— 它是参照系不是量值，从零起会把三年的波动
   * 压成一条贴着顶边的直线，而这条线正是读的人要拿来对照的东西。代价是右轴的刻度
   * 不能按面积比例读，所以轴标题上写明了它不从 0 起。 */
  function domain(lists, manual, zeroBase) {
    var lo = null, hi = null;
    lists.forEach(function (values) {
      (values || []).forEach(function (v) {
        if (v === null || v === undefined) { return; }
        lo = (lo === null || v < lo) ? v : lo;
        hi = (hi === null || v > hi) ? v : hi;
      });
    });
    if (lo === null) { lo = 0; hi = 1; }
    if (zeroBase !== false) {
      if (lo > 0) { lo = 0; }
      if (hi < 0) { hi = 0; }
    }
    if (lo === hi) { hi = lo + 1; }
    var pad = (hi - lo) * 0.08;
    lo -= (lo < 0 ? pad : 0);
    hi += pad;
    // 手填的轴范围**真的裁剪**，不会被自动撑回去 —— 否则填了等于没填。
    if (manual && manual.min !== null && manual.min !== undefined) { lo = manual.min; }
    if (manual && manual.max !== null && manual.max !== undefined) { hi = manual.max; }
    return [lo, hi];
  }

  function ticks(lo, hi, count) {
    var span = hi - lo;
    if (!(span > 0)) { return [lo]; }
    var raw = span / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; })
      .filter(function (s) { return s >= raw; })[0] || 10 * mag;
    var out = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + step * 1e-9 && out.length < 12; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
  }

  // ── 图元 ───────────────────────────────────────────────────────────

  /** 面积图。缺口是断开 —— 一段一段画，绝不跨过 null 连过去。 */
  function area(values, y, n) {
    var runs = segments(values), out = "";
    runs.forEach(function (run) {
      var top = run.map(function (p) { return xAt(p.i, n) + "," + y(p.v); });
      var base = PAD.t + PLOT_H;
      out += '<polygon class="mark-area" points="'
        + xAt(run[0].i, n) + "," + base + " " + top.join(" ") + " "
        + xAt(run[run.length - 1].i, n) + "," + base + '"/>';
    });
    return out;
  }

  function line(values, y, n, color, index) {
    var out = "";
    segments(values).forEach(function (run) {
      out += '<polyline class="mark-line" data-series="' + index + '" fill="none" '
        + 'stroke="' + color + '" points="'
        + run.map(function (p) { return xAt(p.i, n) + "," + y(p.v); }).join(" ")
        + '"/>';
      if (run.length === 1) {
        out += '<circle class="mark-dot" data-series="' + index + '" fill="' + color
          + '" cx="' + xAt(run[0].i, n) + '" cy="' + y(run[0].v) + '" r="2.5"/>';
      }
    });
    return out;
  }

  /** 分组柱。同一期里几个柱系列并排，宽度按系列数分。 */
  function bars(values, y, n, color, index, slot, total) {
    var w = band(n) * 0.72 / Math.max(total, 1);
    var zero = y(0);
    var out = "";
    values.forEach(function (v, i) {
      if (v === null || v === undefined) { return; }
      var cx = xAt(i, n) - band(n) * 0.36 + w * slot;
      var top = Math.min(y(v), zero), height = Math.abs(y(v) - zero);
      out += '<rect class="mark-bar" data-series="' + index + '" fill="' + color
        + '" x="' + cx.toFixed(1) + '" y="' + top.toFixed(1)
        + '" width="' + Math.max(w - 1, 1).toFixed(1)
        + '" height="' + Math.max(height, 0.6).toFixed(1) + '"/>';
    });
    return out;
  }

  function segments(values) {
    var runs = [], run = [];
    (values || []).forEach(function (v, i) {
      if (v === null || v === undefined) {
        if (run.length) { runs.push(run); run = []; }
      } else { run.push({ i: i, v: v }); }
    });
    if (run.length) { runs.push(run); }
    return runs;
  }

  /** 没铺满的桶打斜纹。求和类在这些桶上必然偏低，而图上看不出来。 */
  function hatches(periods, partial) {
    var out = "", n = periods.length, w = band(n);
    periods.forEach(function (key, i) {
      var cover = partial[key];
      if (cover === undefined) { return; }
      out += '<rect class="partial" x="' + (xAt(i, n) - w / 2).toFixed(1)
        + '" y="' + PAD.t + '" width="' + w.toFixed(1) + '" height="' + PLOT_H
        + '" data-cover="' + cover + '"/>';
    });
    return out;
  }

  function axes(periods, left, right, leftMeta, rightMeta) {
    var n = periods.length, out = "";
    out += '<line class="axis" x1="' + PAD.l + '" y1="' + (PAD.t + PLOT_H)
      + '" x2="' + (W - PAD.r) + '" y2="' + (PAD.t + PLOT_H) + '"/>';

    ticks(left.lo, left.hi, 4).forEach(function (v) {
      var y = left.y(v);
      out += '<line class="grid" x1="' + PAD.l + '" y1="' + y.toFixed(1)
        + '" x2="' + (W - PAD.r) + '" y2="' + y.toFixed(1) + '"/>';
      out += '<text class="tick" x="' + (PAD.l - 8) + '" y="' + (y + 3.5).toFixed(1)
        + '" text-anchor="end">' + Fmt.esc(Fmt.tick(v, leftMeta)) + "</text>";
    });
    if (right) {
      ticks(right.lo, right.hi, 4).forEach(function (v) {
        var y = right.y(v);
        out += '<text class="tick tick-right" x="' + (W - PAD.r + 8) + '" y="'
          + (y + 3.5).toFixed(1) + '">' + Fmt.esc(Fmt.tick(v, rightMeta)) + "</text>";
      });
    }

    // 末期永远标出来，然后按固定间隔往前排。**离末期太近的那一个跳过** ——
    // 不跳过的话，一条 35 期的轴上最后两个标签会叠在一起，而叠住的标签比没有标签糟：
    // 读的人会以为自己看清了。
    var every = Math.max(1, Math.ceil(n / 7));
    periods.forEach(function (key, i) {
      if (i !== n - 1) {
        if (i % every) { return; }
        if (n - 1 - i < every * 0.6) { return; }
      }
      out += '<text class="tick" x="' + xAt(i, n).toFixed(1) + '" y="'
        + (PAD.t + PLOT_H + 18) + '" text-anchor="middle">'
        + Fmt.esc(Fmt.period(key)) + "</text>";
    });
    return out;
  }

  // ── 一整张图 ───────────────────────────────────────────────────────

  /** `folded` 来自 Fold.fold；`hidden` 是被图例点掉的指标名集合。
   *
   * 被点掉的序列**退出轴域计算** —— 藏掉一条量纲巨大的指标，其余会自动放大。这是
   * 「一条线把其他全压平」最快的解法，也是它必须改 domain 而不是改透明度的原因。 */
  function chart(panel, card, state, folded, options) {
    options = options || {};
    var hidden = options.hidden || {};
    var axis = options.axis || {};
    // 在响应之前声明：底图先画，而它也要读 marks。`var` 提升的是声明不是赋值，
    // 放在下面等于在这里拿到 undefined。
    var marks = options.marks || {};
    var colors = palette(card);
    var periods = folded.periods, n = periods.length;

    var metrics = Object.keys(folded.series).sort();
    var visible = metrics.filter(function (m) { return !hidden[m]; });
    var leftValues = visible.map(function (m) { return folded.series[m].v; });
    var responseVisible = !hidden["__response__"];

    var leftDomain = domain(leftValues, axis.left, true);
    var rightDomain = domain(responseVisible ? [folded.response] : [], axis.right,
                             false);
    var left = { lo: leftDomain[0], hi: leftDomain[1],
                 y: scale(leftDomain[0], leftDomain[1]) };
    var right = { lo: rightDomain[0], hi: rightDomain[1],
                  y: scale(rightDomain[0], rightDomain[1]) };

    var leftMeta = (panel.metricMeta || {})[visible[0]] || {};
    var rightMeta = (panel.response || {}).meta || {};

    var body = hatches(periods, folded.partial);
    body += axes(periods, left, right, leftMeta, rightMeta);

    // 底图先画，驱动叠在上面 —— 面积压住柱子就白画了。
    if (responseVisible && folded.responseMetric) {
      body += (marks.__response__ === "line")
        ? line(folded.response, right.y, n, "var(--response-line)", -1)
        : area(folded.response, right.y, n);
    }

    var barMetrics = visible.filter(function (m) {
      return markFor(panel, m, marks) === "bar";
    });
    var changed = [];
    visible.forEach(function (metric) {
      var index = metrics.indexOf(metric);
      var color = colors[metric] || slotVar(index);
      var mark = markFor(panel, metric, marks);
      if (mark !== roleOf(panel, metric)) { changed.push(metric); }
      var values = folded.series[metric].v;
      if (mark === "line") { body += line(values, left.y, n, color, index); }
      else if (mark === "area") { body += area(values, left.y, n); }
      else {
        body += bars(values, left.y, n, color, index,
                     barMetrics.indexOf(metric), barMetrics.length);
      }
    });
    if (marks.__response__ && marks.__response__ !== "area") { changed.push("__response__"); }

    body += '<g class="hits">' + hits(n) + "</g>";

    return {
      svg: '<svg viewBox="0 0 ' + W + " " + H + '" role="img" '
        + 'aria-label="' + Fmt.esc(card.l3 + " 对照 " + (folded.responseMetric || "响应"))
        + '" data-geom=\'' + JSON.stringify({
          padL: PAD.l, padR: PAD.r, padT: PAD.t, padB: PAD.b, w: W, h: H, n: n
        }) + "'>" + body + "</svg>",
      legend: legend(panel, card, metrics, colors, folded, hidden, marks),
      changed: changed,
      leftLabel: axisLabel(panel, visible),
      rightLabel: folded.responseMetric
        ? folded.responseMetric + unitOf(rightMeta) + RIGHT_AXIS_NOTE : ""
    };
  }

  function roleOf(panel, metric) {
    return ((panel.metricMeta || {})[metric] || {}).role || "bar";
  }

  /** 这一条实际画成什么。**默认仍然由上游定死**（Y→面积 / 花费→折线 / 其余→柱状）；
   * `marks` 是读的人在图例里换过的，卡本地，不进归约。
   *
   * 图型是在数出来之后才选的，所以它碰不到跨端契约 —— 这也是它可以自由换而归约
   * 不能的原因。 */
  function markFor(panel, metric, marks) {
    var picked = (marks || {})[metric];
    return picked || roleOf(panel, metric);
  }

  //: 响应只给这两个：柱状底图会把画在它上面的驱动挡住。
  var RESPONSE_MARKS = ["area", "line"];
  var DRIVER_MARKS = ["bar", "line", "area"];

  function unitOf(meta) {
    var unit = (meta || {}).unit || "";
    return unit ? "（" + unit + "）" : "";
  }

  //: 右轴不从零起，所以它的刻度不能按面积比例读 —— 说出来，不藏着。
  var RIGHT_AXIS_NOTE = "（不从 0 起）";

  function axisLabel(panel, visible) {
    var units = {};
    visible.forEach(function (metric) {
      var meta = (panel.metricMeta || {})[metric] || {};
      units[meta.unit || ""] = true;
    });
    var names = Object.keys(units).filter(Boolean);
    if (names.length === 1) { return "驱动（" + names[0] + "）"; }
    if (names.length > 1) { return "驱动（单位不一，见图例）"; }
    return "驱动";
  }

  /** 图例：每条带自己的汇总符号。点一下隐藏 —— 它会退出轴域，不是变淡。 */
  function legend(panel, card, metrics, colors, folded, hidden, marks) {
    var out = "";
    if (folded.responseMetric) {
      out += item("__response__", folded.responseMetric + " (Y)",
                  "var(--response-line)",
                  markFor(panel, "__response__", marks) === "line" ? "line" : "area",
                  "右轴 · " + (((panel.response || {}).meta || {}).aggSymbol || "Σ"),
                  hidden["__response__"], RESPONSE_MARKS,
                  (marks || {}).__response__ ? "area" : "");
    }
    metrics.forEach(function (metric, index) {
      var meta = (panel.metricMeta || {})[metric] || {};
      var mark = markFor(panel, metric, marks);
      out += item(metric, metric, colors[metric] || slotVar(index), mark,
                  meta.aggSymbol || "Σ", hidden[metric], DRIVER_MARKS,
                  mark !== (meta.role || "bar") ? (meta.role || "bar") : "");
    });
    return out;
  }

  /** 图例项 = 显隐开关 + 换图型的菜单。
   *
   * 换图型放在图例而不是筛选行：产品的筛选行没有图型控件，而图型是**逐序列**的 ——
   * 图例是页面上唯一一处逐序列的表面。`fromDefault` 非空表示这一条被换过，画一条
   * 虚线下划线，读的人才知道自己看到的不是默认画法。 */
  function item(key, label, color, mark, symbol, off, choices, fromDefault) {
    var shape = mark === "line" ? "line" : (mark === "area" ? "area" : "rect");
    var menu = (choices || []).map(function (option) {
      return '<button type="button" class="opt" data-role="mark" data-metric="'
        + Fmt.esc(key) + '" data-mark="' + option + '" aria-pressed="'
        + (option === mark ? "true" : "false") + '">' + option + "</button>";
    }).join("");
    return '<span class="legend-wrap" data-legend="' + Fmt.esc(key) + '">'
      + '<button type="button" class="legend-item" data-metric="' + Fmt.esc(key)
      + '" aria-pressed="' + (off ? "true" : "false")
      + '" data-mark-changed="' + (fromDefault ? "1" : "")
      + '" title="' + Fmt.esc(symbol
          + (fromDefault ? " · 画法已改（默认是 " + fromDefault + "）" : "")) + '">'
      + '<span class="swatch ' + shape + '" style="--c:' + color + '"></span>'
      + '<span class="legend-name">' + Fmt.esc(label) + "</span></button>"
      + '<button type="button" class="mark-toggle" data-role="markmenu" data-metric="'
      + Fmt.esc(key) + '" aria-label="Chart type" aria-expanded="false">&#9662;</button>'
      + '<div class="popover" data-pop="mark:' + Fmt.esc(key) + '" hidden>'
      + '<p class="pop-note">Chart type</p>' + menu + "</div></span>";
  }

  function hits(n) {
    var out = "", w = band(n);
    for (var i = 0; i < n; i++) {
      out += '<rect class="hit" data-i="' + i + '" x="' + (xAt(i, n) - w / 2).toFixed(1)
        + '" y="' + PAD.t + '" width="' + w.toFixed(1) + '" height="' + PLOT_H + '"/>';
    }
    return out;
  }

  return { chart: chart, palette: palette, markFor: markFor,
           domain: domain, ticks: ticks,
           xAt: xAt, band: band, PAD: PAD, W: W, H: H };
}));
