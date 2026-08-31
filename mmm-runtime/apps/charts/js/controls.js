/* 一张卡上的那一行筛选器。
 *
 * 全部控件都在卡上，一行排开，顺序照产品：
 *
 *   Year | Half-year | Quarter | Month · Source · Sub-factor (L4) · Level 5–8
 *   · Indicator · Brand · Channel · Region ·〈空隙〉· Axis range
 *
 * **控件标签是英文的**：它们是产品骨架，不是正文。正文（解读、说明）跟项目语言走。
 *
 * 作用域没有变，变的只是按钮的位置：品牌 / 渠道 / 区域仍然同时改销量底图与驱动
 * （`SCOPE_BOTH`），数据来源 / 下钻 / 指标仍然只改叠加层。不管你在看哪个文件、
 * 哪个子因子，判断投入产出的那条基准必须站住不动。
 *
 * 统一的原语是 pill + popover：一个按钮，按下去展开一组选项。有选择时按钮描边并
 * 带计数徽标，所以 `Indicator` 和 `Indicator 2` 是同一个控件的两个状态。
 */
(function (root, factory) {
  var api = factory(root.Fold, root.Fmt);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.Controls = api; }
}(typeof self !== "undefined" ? self : this, function (Fold, Fmt) {
  "use strict";

  var LABEL = { source: "Source", indicators: "Indicator", brand: "Brand",
                channelType: "Channel", region: "Region" };
  var LEVEL_LABEL = { l4: "Sub-factor (L4)", l5: "Level 5", l6: "Level 6",
                      l7: "Level 7", l8: "Level 8" };

  // ── 一行 ───────────────────────────────────────────────────────────

  function filterRow(panel, card, state) {
    var out = grainGroup(panel, state);
    out += multiPill(panel, state, "source", Fold.sourceOptions(panel, state),
                     "这张卡的数据只来自一个来源");
    out += ladder(panel, card, state);
    out += indicatorPill(panel, card, state);
    ["brand", "channelType", "region"].forEach(function (column) {
      out += multiPill(panel, state, column,
                       Fold.optionsFor(panel, state, column),
                       notShownWhy(panel, column));
    });
    out += '<span class="grow"></span>';
    out += axisPill(state);
    var trail = breadcrumb(card, state);
    if (trail) { out += '<p class="breadcrumb">' + Fmt.esc(trail) + "</p>"; }
    return out;
  }

  /** 粒度。**撑不起的置灰，永远不删** —— 一行会变长短的控件读起来像 bug，而且
   * 读的人分不清「这里不适用」和「没有了」。按钮顺序粗→细（`GRAIN_DISPLAY`），
   * 与降级顺序（细→粗）是两回事。 */
  function grainGroup(panel, state) {
    var out = '<div class="segmented" role="group" aria-label="Time grain">';
    Fold.grainsFor(panel, state).forEach(function (g) {
      out += '<button type="button" data-role="grain" data-grain="' + g.id + '"'
        + (g.supported ? "" : " disabled")
        + ' aria-pressed="' + (g.supported && g.id === state.grain ? "true" : "false")
        + '" title="' + Fmt.esc(g.supported ? "" : g.why) + '">'
        + Fmt.esc(g.en) + "</button>";
    });
    return out + "</div>";
  }

  function notShownWhy(panel, column) {
    var listed = (panel.notShown || []).filter(function (n) {
      return n.what === column;
    })[0];
    return listed ? listed.why : "";
  }

  /** 多选 pill。空 = 不筛选（`Indicator` 除外，见下）。 */
  function multiPill(panel, state, name, values, disabledWhy) {
    var chosen = state[name] || [];
    if (values.length <= 1) {
      var why = values.length
        ? (disabledWhy || "这张卡只有一个取值") + "：" + values[0]
        : (disabledWhy || "这张卡没有这一维");
      return deadPill(LABEL[name], why);
    }
    var picked = {};
    chosen.forEach(function (v) { picked[v] = true; });
    var opts = values.map(function (value) {
      return '<button type="button" class="opt" data-role="multi" data-name="' + name
        + '" data-value="' + Fmt.esc(value) + '" aria-pressed="'
        + (picked[value] ? "true" : "false") + '">' + Fmt.esc(value) + "</button>";
    }).join("");
    return pill(name, LABEL[name], chosen.length, opts
      + '<button type="button" class="ghost" data-role="clear" data-name="'
      + name + '">Clear</button>');
  }

  /** L4–L8 的梯子。
   *
   * 选中某一层清空它下面所有层**并清空指标选择** —— 指标挂在下钻路径上，路径变了
   * 旧选择就没有意义。某一层在当前路径下没有可选项时是个**灰 pill**，不隐藏：
   * 一行的长度恒定，读的人才看得见「这个因子就是没报到那么深」。 */
  function ladder(panel, card, state) {
    var chosen = state.levels || {};
    var options = Fold.cascadeOptions(panel, card.path, chosen);
    var out = "";
    Fold.LEVELS.forEach(function (level) {
      var values = options[level] || [];
      if (!values.length) {
        out += deadPill(LEVEL_LABEL[level],
                        "这个因子没有报到 " + level.toUpperCase());
        return;
      }
      var opts = '<button type="button" class="opt" data-role="level" data-level="'
        + level + '" data-value="" aria-pressed="'
        + (chosen[level] ? "false" : "true") + '">All</button>';
      opts += values.map(function (value) {
        return '<button type="button" class="opt" data-role="level" data-level="'
          + level + '" data-value="' + Fmt.esc(value) + '" aria-pressed="'
          + (chosen[level] === value ? "true" : "false") + '">'
          + Fmt.esc(value) + "</button>";
      }).join("");
      out += pill(level, LEVEL_LABEL[level], chosen[level] ? 1 : 0, opts,
                  chosen[level] || "");
    });
    return out;
  }

  /** 指标。**空 = 默认几条，不是全部** —— 这是唯一一个空表示默认的控件。
   * 标签写出「… 下 N 个」，因为一份被下钻收窄过的列表突然变短会被当成 bug。 */
  function indicatorPill(panel, card, state) {
    var available = Fold.indicatorOptions(panel, state);
    var chosen = state.indicators || [];
    var picked = {};
    chosen.forEach(function (m) { picked[m] = true; });
    var where = "";
    Fold.LEVELS.forEach(function (level) {
      if ((state.levels || {})[level]) { where = (state.levels || {})[level]; }
    });

    var head = '<p class="pop-note">' + Fmt.esc(
      (where ? where + " 下 " : "") + available.length + " 个"
      + (chosen.length ? "" : "；没有选就画默认的 "
         + (card.defaultMetrics || []).length + " 条，不是全部")) + "</p>";
    var opts = available.map(function (metric) {
      var meta = (panel.metricMeta || {})[metric] || {};
      return '<button type="button" class="opt" data-role="multi" '
        + 'data-name="indicators" data-value="' + Fmt.esc(metric)
        + '" aria-pressed="' + (picked[metric] ? "true" : "false")
        + '" title="' + Fmt.esc(aggTitle(meta)) + '">' + Fmt.esc(metric)
        + '<span class="agg">' + Fmt.esc(meta.aggSymbol || "Σ") + "</span></button>";
    }).join("");
    return pill("indicators", LABEL.indicators, chosen.length, head + opts
      + '<button type="button" class="ghost" data-role="clear" '
      + 'data-name="indicators">Clear</button>');
  }

  /** 汇总口径的来源，写进提示框 —— 一个求和的花费和一个求和的摄氏度在图上长得
   * 一模一样，区别只在这句话里。 */
  var AGG_SOURCE = {
    tree: "因子树里人定的",
    coverage: "指标登记表里的（那一列本身是按名字推断出来的）",
    classifier: "按名字推断的，没有人定过",
    conflict: "两个因子定得不一致，本轮按取平均"
  };

  function aggTitle(meta) {
    var how = meta.agg === "average" ? "跨期与跨切片取平均"
      : (meta.agg === "min" ? "取最小值"
         : (meta.agg === "max" ? "取最大值" : "跨期与跨切片求和"));
    var line = how + " · " + (AGG_SOURCE[meta.source] || "来源不明");
    return meta.aggNote ? line + " · " + meta.aggNote : line;
  }

  /** 手填轴范围。留空 = 自动贴合；填了就**真的裁剪**，不会被自动撑回去。 */
  function axisPill(state) {
    var axis = state.axis || {};
    function pair(side, label) {
      var block = axis[side] || {};
      return '<div class="axis-pair"><em>' + label + "</em>"
        + '<input type="number" step="any" data-role="axis" data-side="' + side
        + '" data-edge="min" placeholder="min" value="'
        + (block.min === null || block.min === undefined ? "" : block.min) + '">'
        + '<input type="number" step="any" data-role="axis" data-side="' + side
        + '" data-edge="max" placeholder="max" value="'
        + (block.max === null || block.max === undefined ? "" : block.max)
        + '"></div>';
    }
    var body = pair("left", "Left (drivers)") + pair("right", "Right (response)")
      + '<button type="button" class="ghost" data-role="reset-view">'
      + "Reset view</button>";
    return pill("axis", "Axis range", touchedCount(state), body);
  }

  function touchedCount(state) {
    var axis = state.axis || {}, n = 0;
    ["left", "right"].forEach(function (side) {
      var block = axis[side] || {};
      if (block.min !== null && block.min !== undefined) { n += 1; }
      if (block.max !== null && block.max !== undefined) { n += 1; }
    });
    return n;
  }

  // ── 原语 ───────────────────────────────────────────────────────────

  function pill(name, label, count, body, valueLabel) {
    var on = count > 0 || !!valueLabel;
    return '<span class="pill-wrap" data-pill="' + Fmt.esc(name) + '">'
      + '<button type="button" class="pill" data-role="pill" data-name="'
      + Fmt.esc(name) + '" aria-haspopup="true" aria-expanded="false" '
      + 'aria-pressed="' + (on ? "true" : "false") + '">'
      + Fmt.esc(label)
      + (valueLabel ? '<span class="chosen">' + Fmt.esc(valueLabel) + "</span>" : "")
      + (count > 0 && !valueLabel ? '<span class="badge">' + count + "</span>" : "")
      + '<span class="caret">&#9662;</span></button>'
      + '<div class="popover" data-pop="' + Fmt.esc(name) + '" hidden role="group" '
      + 'aria-label="' + Fmt.esc(label) + '">' + body + "</div></span>";
  }

  /** 不可用的控件是 `<span>` 而不是 `<button>`：键盘不该停在一个死控件上，
   * 但它留在行里，一行的长度才恒定。 */
  function deadPill(label, why) {
    return '<span class="pill muted" title="' + Fmt.esc(why) + '">'
      + Fmt.esc(label) + "</span>";
  }

  function breadcrumb(card, state) {
    var chosen = state.levels || {}, parts = [];
    Fold.LEVELS.forEach(function (level) {
      if (chosen[level]) {
        parts.push(LEVEL_LABEL[level] + ": " + chosen[level]);
      }
    });
    if (state.fellBackFrom) {
      parts.push("按" + grainLabel(state.grain) + "显示（选了「"
                 + grainLabel(state.fellBackFrom) + "」，这一片撑不起那个颗粒度）");
    }
    return parts.length ? card.l3 + " › " + parts.join(" › ") : "";
  }

  function grainLabel(id) {
    var hit = Fold.GRAIN_BY_ID[id];
    return hit ? hit.label : id;
  }

  // ── 事件 ───────────────────────────────────────────────────────────

  /** 一次点击对状态做了什么。返回 null 表示与筛选无关。
   *
   * 状态迁移集中在这里，不散在监听器里：一个「选了 L5 之后指标没清空」的 bug
   * 只会在某一条路径上出现，而所有路径都从这个函数过。 */
  function apply(state, target) {
    var role = target.getAttribute("data-role");
    var next = clone(state);

    if (role === "grain") {
      if (target.disabled) { return null; }
      next.grain = target.getAttribute("data-grain");
      return next;
    }
    if (role === "multi") {
      var name = target.getAttribute("data-name");
      var value = target.getAttribute("data-value");
      if (!name || value === null) { return null; }
      var list = (next[name] || []).slice();
      var at = list.indexOf(value);
      if (at >= 0) { list.splice(at, 1); } else { list.push(value); }
      next[name] = list;
      return next;
    }
    if (role === "clear") {
      next[target.getAttribute("data-name")] = [];
      return next;
    }
    if (role === "level") {
      var level = target.getAttribute("data-level");
      var levels = clone(next.levels || {});
      levels[level] = target.getAttribute("data-value") || "";
      var below = false;
      Fold.LEVELS.forEach(function (other) {
        if (below) { levels[other] = ""; }
        if (other === level) { below = true; }
      });
      next.levels = levels;
      next.indicators = [];      // 路径变了，旧的指标选择就没有意义
      return next;
    }
    if (role === "axis") {
      var side = target.getAttribute("data-side");
      var edge = target.getAttribute("data-edge");
      var axis = clone(next.axis || {});
      axis[side] = clone(axis[side] || {});
      axis[side][edge] = target.value === "" ? null : Number(target.value);
      next.axis = axis;
      return next;
    }
    if (role === "reset-view") {
      next.axis = {};
      next.window = null;
      return next;
    }
    return null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  /** 时间刷选。两个滑块 —— 拖拽条好看，但键盘用不了，而这一页是要发出去的。 */
  function brush(periods, window) {
    var last = Math.max(periods.length - 1, 0);
    var from = window && window.from !== undefined ? window.from : 0;
    var to = window && window.to !== undefined ? window.to : last;
    return '<input type="range" data-role="brush" data-edge="from" min="0" max="'
      + last + '" value="' + from + '" aria-label="Window start">'
      + '<input type="range" data-role="brush" data-edge="to" min="0" max="' + last
      + '" value="' + to + '" aria-label="Window end">'
      + '<output class="window">' + Fmt.esc(Fmt.period(periods[from] || ""))
      + " – " + Fmt.esc(Fmt.period(periods[to] || "")) + "</output>";
  }

  return { filterRow: filterRow, brush: brush, apply: apply, aggTitle: aggTitle,
           AGG_SOURCE: AGG_SOURCE };
}));
