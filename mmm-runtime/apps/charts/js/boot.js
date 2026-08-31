/* 接线 —— 状态在这里，重画从这里出去。
 *
 * 一个卡片 = 一个 L1›L2›L3 因子路径 = 一份状态。**所有筛选器都在卡上**，照产品的版式。
 * 作用域没有变：品牌 / 渠道 / 区域仍然同时改销量底图与驱动，来源 / 下钻 / 指标仍然
 * 只改叠加层 —— 变的只是按钮的位置。
 *
 * 卡片滚进视野才第一次绘制。十几二十个因子一次性全画，打开这一页要等好几秒，而读的人
 * 第一眼只看得见第一张。
 *
 * 轴范围、刷选、图型、展开的那个 popover 都是**卡片本地状态**，不写进任何持久化的
 * 东西。理由很实际：这一页是一份发出去的文件，而一个把「我刚才把左轴拉到 0–500」
 * 当成项目状态记下来的页面，会在下一次重出的时候把别人的视角带回来。
 */
(function (root) {
  "use strict";
  var Fold = root.Fold, Render = root.Render, Controls = root.Controls,
      Table = root.Table, SelfCheck = root.SelfCheck, Fmt = root.Fmt;

  var PANEL = root.__PANEL__ || {};

  // 每张卡自己一份状态。**没有页面级筛选条** —— 产品把粒度、品牌、渠道、区域都放在
  // 卡上。作用域没变（品牌 / 渠道 / 区域仍然同时改销量底图与驱动），变的是位置。
  var cards = {};

  function start() {
    var report = SelfCheck.run(PANEL);
    root.__foldSelfCheck = report;
    if (!report.ok) { refuse(report); return; }
    document.documentElement.setAttribute("data-selfcheck", "ok");

    (PANEL.cards || []).forEach(function (card) { setup(card); });
    document.documentElement.setAttribute("data-ready", "1");
  }

  /** 自检不过就一张图都不画。
   *
   * 这是有意的，不是防御性编程：一个错的数字配一条红条幅，照样会在会上被念出来。 */
  function refuse(report) {
    var host = document.getElementById("cards") || document.body;
    var first = report.failures[0] || {};
    var diff = first.diff || {};
    host.innerHTML = '<section class="refuse"><h2>这一页没有作图</h2>'
      + "<p>它在打开时重算了自己带的验算题，结果和生成它的那次计算对不上。"
      + "对不上的时候画出来的图是没有依据的，所以一张都不画。</p>"
      + "<dl><dt>状态</dt><dd><code>" + Fmt.esc(first.key || "") + "</code></dd>"
      + "<dt>位置</dt><dd><code>" + Fmt.esc(diff.path || "") + "</code></dd>"
      + "<dt>计算结果</dt><dd><code>" + Fmt.esc(JSON.stringify(diff.expected))
      + "</code></dd>"
      + "<dt>这一页算出来的</dt><dd><code>" + Fmt.esc(JSON.stringify(diff.actual))
      + "</code></dd></dl>"
      + "<p>请重新生成这一页。如果重新生成之后还是这样，是这一页被人手动改过。</p>"
      + "</section>";
    document.documentElement.setAttribute("data-selfcheck", "failed");
  }

  /** 一张卡当前的完整状态。全部来自这张卡自己。 */
  function stateFor(card) {
    var local = cards[card.path] || {};
    var state = Fold.blankState(PANEL, card.path);
    ["brand", "channelType", "region", "source", "indicators"].forEach(function (k) {
      state[k] = (local[k] || []).slice();
    });
    if (local.grain) { state.grain = local.grain; }
    state.levels = JSON.parse(JSON.stringify(local.levels || state.levels));
    state.compareMonth = local.compareMonth | 0;
    state.axis = local.axis || {};
    state.window = local.window || null;
    state.hidden = local.hidden || {};
    state.marks = local.marks || {};
    return state;
  }

  function setup(card) {
    cards[card.path] = cards[card.path] || {};
    var host = document.querySelector('[data-card="' + cssEscape(card.path) + '"]');
    if (!host) { return; }
    host.addEventListener("click", function (event) { onCard(card, host, event); });
    host.addEventListener("change", function (event) { onCard(card, host, event); });
    host.addEventListener("input", function (event) { onCard(card, host, event); });
    observe(host, function () { draw(card, host); });
  }

  /** 懒加载：滚进视野才画第一次。 */
  function observe(host, paint) {
    if (!root.IntersectionObserver) { paint(); return; }
    var seen = false;
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !seen) { seen = true; paint(); watcher.disconnect(); }
      });
    }, { rootMargin: "300px" });
    watcher.observe(host);
  }

  function onCard(card, host, event) {
    var target = event.target;
    if (!target || !target.getAttribute) { return; }

    var pill = target.closest ? target.closest('[data-role="pill"]') : null;
    if (pill) {
      var name = pill.getAttribute("data-name");
      cards[card.path].openPill =
        cards[card.path].openPill === name ? "" : name;
      showPopovers(host, cards[card.path].openPill);
      return;
    }
    var linky = target.closest ? target.closest('[data-role="ask"], [data-role="regen"]')
                              : null;
    if (linky) {
      var which = linky.getAttribute("data-role");
      cards[card.path].openPill =
        cards[card.path].openPill === which ? "" : which;
      showPopovers(host, cards[card.path].openPill);
      return;
    }

    if (target.getAttribute("data-role") === "compare-month") {
      cards[card.path].compareMonth = Number(target.value) | 0;
      schedule(card, host);
      return;
    }
    if (target.getAttribute("data-role") === "brush") {
      brushed(card, host, target);
      return;
    }
    if (target.getAttribute("data-role") === "markmenu") {
      var key = "mark:" + target.getAttribute("data-metric");
      cards[card.path].openPill = cards[card.path].openPill === key ? "" : key;
      showPopovers(host, cards[card.path].openPill);
      return;
    }
    if (target.getAttribute("data-role") === "mark") {
      var marks = cards[card.path].marks || {};
      marks[target.getAttribute("data-metric")] = target.getAttribute("data-mark");
      cards[card.path].marks = marks;
      cards[card.path].openPill = "";
      schedule(card, host);
      return;
    }
    if (target.getAttribute("data-role") === "reset-marks") {
      cards[card.path].marks = {};
      schedule(card, host);
      return;
    }
    var legend = target.closest ? target.closest(".legend-item") : null;
    if (legend) {
      var metric = legend.getAttribute("data-metric");
      var hidden = cards[card.path].hidden || {};
      if (hidden[metric]) { delete hidden[metric]; } else { hidden[metric] = true; }
      cards[card.path].hidden = hidden;
      schedule(card, host);
      return;
    }
    var button = target.closest ? target.closest("button, select, input") : target;
    if (!button) { return; }
    var next = Controls.apply(stateFor(card), button);
    if (!next) { return; }
    var local = cards[card.path];
    ["brand", "channelType", "region", "source", "indicators"].forEach(function (k) {
      local[k] = next[k] || [];
    });
    local.grain = next.grain;
    local.levels = next.levels;
    local.axis = next.axis || {};
    if (button.getAttribute("data-role") === "reset-view") {
      local.window = null;
      local.openPill = "";
    }
    schedule(card, host);
  }

  /** 展开哪一个 popover。
   *
   * `draw()` 每次重建整张卡，会把打开的那个拆掉；所以「哪个是开着的」必须是状态，
   * 重画之后按它恢复，并把焦点还给那个 pill —— 否则每点一个选项，键盘焦点就掉到
   * body 上，多选控件按一次就用不下去了。 */
  function showPopovers(host, open) {
    [].slice.call(host.querySelectorAll(".popover")).forEach(function (pop) {
      pop.hidden = pop.getAttribute("data-pop") !== open;
    });
    [].slice.call(host.querySelectorAll('[data-role="pill"]')).forEach(function (b) {
      b.setAttribute("aria-expanded",
                     b.getAttribute("data-name") === open ? "true" : "false");
    });
    if (open) {
      var owner = host.querySelector('[data-role="pill"][data-name="'
                                     + cssEscape(open) + '"]');
      if (owner) { owner.focus(); }
    }
  }

  function brushed(card, host, input) {
    var local = cards[card.path];
    var window = local.window || {};
    window[input.getAttribute("data-edge")] = Number(input.value) | 0;
    if (window.from !== undefined && window.to !== undefined
        && window.from > window.to) {
      var swap = window.from; window.from = window.to; window.to = swap;
    }
    window.toIsSet = true;
    local.window = window;
    schedule(card, host);
  }

  /** 重画排到事件之后。
   *
   * 直接在 change 处理器里替换掉那个 `<select>` 自己，浏览器会在一个已经被摘下来的
   * 节点上继续跑 blur，然后 innerHTML 赋值抛 NotFoundError。等这一轮事件走完再画，
   * 顺手把焦点收回卡片上，键盘操作也不会掉到 body 上去。 */
  function schedule(card, host) {
    if (host.__pending) { return; }
    host.__pending = true;
    (root.requestAnimationFrame || function (fn) { setTimeout(fn, 0); })(function () {
      host.__pending = false;
      draw(card, host);
    });
  }

  function setSlot(host, name, html) {
    var slot = host.querySelector('[data-slot="' + name + '"]');
    if (slot && slot.isConnected !== false) { slot.innerHTML = html; }
  }

  /** 一张卡整块重画。局部更新省下来的那点时间，抵不上两条路径不一致的代价。 */
  function draw(card, host) {
    var state = stateFor(card);
    var resolved = Fold.resolveGrain(PANEL, state);
    state.grain = resolved.grain;
    state.fellBackFrom = resolved.fellBackFrom;

    var folded = Fold.fold(PANEL, state);
    folded.card = card.path;
    var view = windowed(folded, state.window);
    var chart = Render.chart(PANEL, card, state, view,
                             { hidden: state.hidden, axis: state.axis,
                               marks: state.marks });

    setSlot(host, "filters", Controls.filterRow(PANEL, card, state));
    setSlot(host, "chart",
            '<div class="axis-title left">' + Fmt.esc(chart.leftLabel) + "</div>"
            + '<div class="axis-title right">' + Fmt.esc(chart.rightLabel) + "</div>"
            + chart.svg);
    setSlot(host, "brush", Controls.brush(folded.periods, state.window));
    setSlot(host, "legend", chart.legend);
    setSlot(host, "table", Table.yearly(PANEL, state));
    setSlot(host, "notes", notes(state, folded, view));
    fillHelpers(host, card, state);
    markTypemark(host, chart.changed || []);

    showPopovers(host, cards[card.path].openPill || "");
    host.setAttribute("data-drawn", "1");
    wireHover(host, view);
  }

  /** 两个按钮背后的内容。**都没有后端，也都不假装有。**
   *
   * Ask 摆出的是这张卡在**当前筛选态**下的那条 `validation.read` 命令 —— 这正是
   * 答问的规定路径：它和页面走同一个归约内核，所以顾问念出来的数和客户屏幕上的
   * 不可能不一样。Regenerate 摆出的是重出流程，外加一句「改这一页没有用」。
   */
  function fillHelpers(host, card, state) {
    var parts = ['~/.local/bin/mmm tool validation.read --workspace <工作区>',
                 '--card "' + card.path + '"'];
    if (state.grain !== "month") { parts.push("--grain " + state.grain); }
    [["brand", "--brand"], ["channelType", "--channel"], ["region", "--region"],
     ["source", "--source"], ["indicators", "--indicator"]].forEach(function (pair) {
      var values = state[pair[0]] || [];
      if (values.length) { parts.push(pair[1] + ' "' + values.join(",") + '"'); }
    });
    var levels = [];
    Fold.LEVELS.forEach(function (level) {
      if ((state.levels || {})[level]) {
        levels.push(level + "=" + state.levels[level]);
      }
    });
    if (levels.length) { parts.push('--level "' + levels.join(",") + '"'); }
    if (state.compareMonth) { parts.push("--compare-month " + state.compareMonth); }

    setPop(host, "ask",
           "<p>问答在对话里发生。这条命令返回顾问作答必须引用的数字 —— "
           + "它和你屏幕上这张图走的是同一个归约内核。</p><pre>"
           + Fmt.esc(parts.join(" \\\n  ")) + "</pre>");
    setPop(host, "regen",
           "<p>重出这一页：</p><pre>" + Fmt.esc(
             "~/.local/bin/mmm tool validation.panel    --workspace <工作区>\n"
             + "~/.local/bin/mmm tool validation.facts    --workspace <工作区>\n"
             + "~/.local/bin/mmm tool validation.analyses --workspace <工作区>\n"
             + "~/.local/bin/mmm app charts book  --workspace <工作区>")
           + "</pre><p>解读写在 <code>artifacts/s2/chart-analyses.yaml</code>。"
           + "<strong>改这一页没有用</strong> —— 下一次重出会覆盖它，而且页面自带的"
           + "校验和会认出它被改过，然后拒绝作图。</p>");
  }

  /** 改过画法就说出来 —— 三处：图例项的虚线、卡头的提示、解读被标成对应默认视图。
   *
   * 默认画法是定过的决定（响应=面积 / 花费=折线 / 其余=柱状）：同一份数据换个形状
   * 读起来就是两个发现，所以换是允许的，**换过了不说才不允许**。 */
  function markTypemark(host, changed) {
    var slot = host.querySelector('[data-slot="typemark"]');
    if (!slot) { return; }
    slot.hidden = !changed.length;
    slot.innerHTML = changed.length
      ? "Chart type edited · " + changed.length
        + ' <button type="button" class="ghost" data-role="reset-marks">'
        + "Reset to default</button>"
      : "";
    var analysis = host.querySelector(".analysis");
    if (analysis) {
      analysis.setAttribute("data-stale", changed.length ? "1" : "");
    }
  }

  function setPop(host, name, html) {
    var pop = host.querySelector('[data-pop="' + name + '"]');
    if (pop) { pop.innerHTML = html; }
  }

  /** 刷选只裁时间窗，不重算 —— 窗内的每个数还是刚才那个数。 */
  function windowed(folded, window) {
    if (!window || window.from === undefined && window.to === undefined) {
      return folded;
    }
    var from = window.from || 0;
    var to = window.to === undefined ? folded.periods.length - 1 : window.to;
    var cut = function (list) { return list.slice(from, to + 1); };
    var series = {};
    Object.keys(folded.series).forEach(function (name) {
      series[name] = { agg: folded.series[name].agg, v: cut(folded.series[name].v) };
    });
    var partial = {};
    cut(folded.periods).forEach(function (key) {
      if (folded.partial[key] !== undefined) { partial[key] = folded.partial[key]; }
    });
    return { periods: cut(folded.periods), bounds: folded.bounds, card: folded.card,
             response: cut(folded.response), responseMetric: folded.responseMetric,
             series: series, partial: partial, dropped: folded.dropped };
  }

  /** 图底下的说明。**空、缺、被排除掉的东西都要说出来** —— 静默缺失是客户在会上
   * 才问出来的那一类问题。 */
  function notes(state, folded, view) {
    var lines = [];
    if (state.fellBackFrom) {
      lines.push("按" + label(state.grain) + "显示：选了「" + label(state.fellBackFrom)
                 + "」，但这一片撑不起那个颗粒度。");
    }
    if (folded.dropped) {
      lines.push("有 " + folded.dropped + " 条全国口径的曲线被这次筛选排除了 —— "
                 + "它们没有渠道 / 区域标记，图上只会显得线变短了。");
    }
    var partial = Object.keys(view.partial || {});
    if (partial.length) {
      lines.push(partial.length + " 个时间桶没有铺满（"
                 + partial.slice(0, 4).map(Fmt.period).join("、")
                 + "），图上打了斜纹：求和类指标在这些桶上必然偏低。");
    }
    var empty = [], gapped = [];
    Object.keys(view.series).sort().forEach(function (name) {
      var values = view.series[name].v;
      var missing = values.filter(function (v) { return v === null; }).length;
      if (missing === values.length) { empty.push(name); }
      else if (missing) { gapped.push(name + " 缺 " + missing + " 期"); }
    });
    if (empty.length) {
      lines.push("这个视角下没有观测值的指标：" + empty.join("、")
                 + "。空也是结论 —— 它不是零。");
    }
    // 缺口要数出来。图上是断开，而一条断开的线和一条本来就短的线看起来一样。
    if (gapped.length) {
      lines.push("有缺口的指标：" + gapped.join("、") + "。图上是断开，不是零。");
    }
    if (!lines.length) { return ""; }
    return "<ul>" + lines.map(function (line) {
      return "<li>" + Fmt.esc(line) + "</li>";
    }).join("") + "</ul>";
  }

  function label(id) {
    var hit = Fold.GRAINS.filter(function (g) { return g.id === id; })[0];
    return hit ? hit.label : id;
  }

  /** 悬浮读数。数字从刚算好的结构里取，不从 DOM 里刮。 */
  function wireHover(host, view) {
    var svg = host.querySelector("svg");
    var tip = host.querySelector('[data-slot="tip"]');
    if (!svg || !tip) { return; }
    svg.addEventListener("mousemove", function (event) {
      var hit = event.target.closest ? event.target.closest(".hit") : null;
      if (!hit) { tip.hidden = true; return; }
      var i = Number(hit.getAttribute("data-i"));
      tip.hidden = false;
      tip.innerHTML = tipFor(view, i);
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; });
  }

  /** 悬浮读数。`名称 : 值 · 汇总方式`，每行按它自己的序列颜色。
   *
   * 响应和驱动**混在一起按名称排序**，不是响应优先：读的人在图上看到的是几条并排的
   * 曲线，提示框按同一个顺序列出来，眼睛不用重新找。汇总方式打原词（sum / average）
   * 而不是 Σ —— 提示框是它唯一说得下一整个词的地方，而「这个数是加起来的还是平均的」
   * 值得说清楚。 */
  function tipFor(view, i) {
    var rows = [];
    if (view.responseMetric) {
      rows.push({ name: view.responseMetric + " (Y)",
                  sort: view.responseMetric,
                  value: view.response[i],
                  meta: (PANEL.response || {}).meta || {},
                  color: "var(--response-line)" });
    }
    var colors = Render.palette(Fold.cardOf(PANEL, view.card) || { metrics: [] });
    Object.keys(view.series).forEach(function (name) {
      rows.push({ name: name, sort: name, value: view.series[name].v[i],
                  meta: (PANEL.metricMeta || {})[name] || {},
                  color: colors[name] || "var(--muted)" });
    });
    rows.sort(function (a, b) { return a.sort < b.sort ? -1 : (a.sort > b.sort ? 1 : 0); });

    var out = "<strong>" + Fmt.esc(Fmt.period(view.periods[i])) + "</strong>";
    rows.forEach(function (row) {
      out += '<span style="color:' + row.color + '">' + Fmt.esc(row.name) + " : "
        + Fmt.esc(Fmt.value(row.value, row.meta))
        + ' <em>· ' + Fmt.esc(row.meta.agg || "sum") + "</em></span>";
    });
    return out;
  }

  function cssEscape(text) {
    return String(text).replace(/["\\]/g, "\\$&");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
}(typeof self !== "undefined" ? self : this));
