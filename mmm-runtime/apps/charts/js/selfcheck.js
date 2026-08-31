/* 页面打开时先给自己出一遍题 —— 不通过就一张图都不画。
 *
 * 这一页的数是它自己算出来的（架构 D10）。让这件事安全的不是页面小心，是页面被重放：
 * 同一套归约在 Python 和 JS 两端跑过同一批枚举状态，生成时比对过一次；这里是第二次，
 * 在读的人的浏览器里，在第一次绘制之前。
 *
 * **不一致就整页不画。** 一个错的数字配一条红条幅，照样会在会上被念出来；一页拒绝
 * 作图的页面不会。
 */
(function (root, factory) {
  var api = factory(root.Fold);
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.SelfCheck = api; }
}(typeof self !== "undefined" ? self : this, function (Fold) {
  "use strict";

  /** 与 mmm_engine/charts/foldcheck.evaluate 一一对应。 */
  function evaluate(panel, state) {
    var folded = Fold.fold(panel, state);
    var resolved = Fold.resolveGrain(panel, state);
    var series = {}, aggs = {};
    Object.keys(folded.series).sort().forEach(function (name) {
      series[name] = folded.series[name].v;
      aggs[name] = folded.series[name].agg;
    });
    var row = {
      key: Fold.stateKey(state), periods: folded.periods,
      response: folded.response, series: series, aggs: aggs,
      partial: folded.partial, dropped: folded.dropped,
      grain: resolved.grain, fellBackFrom: resolved.fellBackFrom,
      options: {}
    };
    // 控件上摆出来的取值也在契约里 —— 见 foldcheck.evaluate 上的注释。这三处
    // evaluate（Python、node、这里）必须一起改，少改一处就是这一页拒绝作图。
    Fold.SCOPE_BOTH.forEach(function (column) {
      row.options[column] = Fold.optionsFor(panel, state, column);
    });
    if (state.compareMonth !== undefined && state.compareMonth !== null) {
      var table = Fold.yearly(panel, state, state.compareMonth | 0);
      row.yearly = {
        years: table.years,
        rows: table.rows.map(function (r) {
          return [r.metric, r.agg, r.values, r.yoy];
        })
      };
    }
    return row;
  }

  function differs(expected, actual, path) {
    path = path || "";
    if (expected === null || actual === null || expected === undefined
        || actual === undefined) {
      return (expected == null && actual == null)
        ? null : { path: path, expected: expected, actual: actual };
    }
    if (typeof expected === "number" || typeof actual === "number") {
      return Object.is(expected, actual)
        ? null : { path: path, expected: expected, actual: actual };
    }
    if (Array.isArray(expected) || Array.isArray(actual)) {
      if (!Array.isArray(expected) || !Array.isArray(actual)
          || expected.length !== actual.length) {
        return { path: path, expected: expected, actual: actual };
      }
      for (var i = 0; i < expected.length; i++) {
        var found = differs(expected[i], actual[i], path + "[" + i + "]");
        if (found) { return found; }
      }
      return null;
    }
    if (typeof expected === "object" && typeof actual === "object") {
      var keys = Object.keys(expected).concat(Object.keys(actual))
        .filter(function (k, i, all) { return all.indexOf(k) === i; }).sort();
      for (var j = 0; j < keys.length; j++) {
        var hit = differs(expected[keys[j]], actual[keys[j]],
                          path ? path + "." + keys[j] : keys[j]);
        if (hit) { return hit; }
      }
      return null;
    }
    return expected === actual
      ? null : { path: path, expected: expected, actual: actual };
  }

  /** FNV-1a，和 mmm_engine/charts/foldcheck.checksum 同一套。
   *
   * 便宜是故意的：它防的是一个文本编辑器，不是一个对手。 */
  function checksum(panel) {
    var digest = 0x811C9DC5;
    function feed(text) {
      var bytes = unescape(encodeURIComponent(String(text)));
      for (var i = 0; i < bytes.length; i++) {
        digest = (digest ^ bytes.charCodeAt(i)) >>> 0;
        digest = Math.imul(digest, 0x01000193) >>> 0;
      }
    }
    var records = (panel.series || []).concat(panel.responseSeries || []);
    records.forEach(function (record) {
      feed(record.m === undefined ? -1 : record.m);
      (record.v || []).forEach(function (value) {
        feed(value === null || value === undefined ? "~" : repr(value));
      });
    });
    return ("0000000" + digest.toString(16)).slice(-8);
  }

  /** Python 的 `repr(float)`。JS 的 String(1) 是 "1"，Python 的是 "1.0"。 */
  function repr(value) {
    var n = Number(value);
    if (!isFinite(n)) { return String(n); }
    var text = String(n);
    return /[.eE]/.test(text) ? text : text + ".0";
  }

  function run(panel) {
    var states = panel.selfCheck || [];
    var failures = [];
    for (var i = 0; i < states.length; i++) {
      var expected = states[i];
      var actual = evaluate(panel, expected.state);
      var copy = {};
      Object.keys(expected).forEach(function (k) {
        if (k !== "state") { copy[k] = expected[k]; }
      });
      var diff = differs(copy, actual);
      if (diff) { failures.push({ key: expected.key, diff: diff }); }
    }
    var stamped = panel.checksum;
    var got = checksum(panel);
    if (stamped && stamped !== got) {
      failures.push({ key: "（整页内容校验和）",
                      diff: { path: "checksum", expected: stamped, actual: got } });
    }
    return { ok: !failures.length, checked: states.length,
             failed: failures.length, failures: failures };
  }

  return { run: run, evaluate: evaluate, checksum: checksum };
}));
