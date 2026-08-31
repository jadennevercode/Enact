/* 跨宿主重放 —— 页面自己算的数，和工具算的数，逐位比对。
 *
 *     node apps/charts/js/foldcheck.mjs <工作区>/data/derived/validation-foldcheck.json
 *
 * 它 require 的是页面内联的**同一份** fold.js。两份实现漂开的那一刻，这里非零退出，
 * 而 charts.book 在写页面之前调它，所以那一页根本不会被写出来。
 *
 * 比对不走 JSON 字符串：Python 和 JS 对同一个浮点数的最短往返写法在指数区间上
 * 不一样（1e-07 对 1e-7），拿字符串比会在没有差异的地方报差异。所以这里逐个结构
 * 走下去，数字用 Object.is 比 —— 它同时管住 -0 和 NaN。
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const Fold = require(join(HERE, "fold.js"));

const MAX_REPORTED = 3;

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

/** 走到第一处不同为止，返回那条路径；完全一致返回 null。 */
function firstDifference(expected, actual, path = "") {
  if (expected === null || actual === null || expected === undefined
      || actual === undefined) {
    return expected === actual || (expected == null && actual == null)
      ? null : { path, expected, actual };
  }
  if (typeof expected === "number" || typeof actual === "number") {
    return Object.is(expected, actual) ? null : { path, expected, actual };
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      return { path, expected, actual };
    }
    if (expected.length !== actual.length) {
      return { path: path + ".length", expected: expected.length,
               actual: actual.length };
    }
    for (let i = 0; i < expected.length; i++) {
      const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (diff) { return diff; }
    }
    return null;
  }
  if (typeof expected === "object" && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      const diff = firstDifference(expected[key], actual[key],
                                   path ? `${path}.${key}` : key);
      if (diff) { return diff; }
    }
    return null;
  }
  return expected === actual ? null : { path, expected, actual };
}

/** 与 mmm_engine/charts/foldcheck.evaluate 一一对应。 */
function evaluate(panel, state) {
  const folded = Fold.fold(panel, state);
  const resolved = Fold.resolveGrain(panel, state);
  const series = {}, aggs = {};
  Object.keys(folded.series).sort().forEach((name) => {
    series[name] = folded.series[name].v;
    aggs[name] = folded.series[name].agg;
  });
  const row = {
    key: Fold.stateKey(state),
    periods: folded.periods,
    response: folded.response,
    series, aggs,
    partial: folded.partial,
    dropped: folded.dropped,
    grain: resolved.grain,
    fellBackFrom: resolved.fellBackFrom,
    options: {}
  };
  Fold.SCOPE_BOTH.forEach((column) => {
    row.options[column] = Fold.optionsFor(panel, state, column);
  });
  if (state.compareMonth !== undefined && state.compareMonth !== null) {
    const table = Fold.yearly(panel, state, state.compareMonth | 0);
    row.yearly = {
      years: table.years,
      rows: table.rows.map((r) => [r.metric, r.agg, r.values, r.yoy])
    };
  }
  return row;
}

/** 重放一份黄金。`panel` 单独传，因为黄金里只存状态与期望值。
 *
 * `state` 是输入不是输出，比对时摘掉：把它一起比，两端只要有一端多带一个字段，
 * 每一个状态都会报错，而真正的差异会淹没在里面。
 */
export function replay(panel, golden) {
  const problems = [];
  for (const expected of golden) {
    const { state, ...wanted } = expected;
    const actual = evaluate(panel, state);
    delete actual.state;
    const diff = firstDifference(wanted, actual);
    if (diff) { problems.push({ key: expected.key, diff }); }
  }
  return problems;
}

function main(argv) {
  const goldenPath = argv[0];
  if (!goldenPath) {
    fail("用法：node foldcheck.mjs <工作区>/data/derived/validation-foldcheck.json");
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const panelPath = argv[1] || goldenPath.replace(/validation-foldcheck\.json$/,
                                                  "validation-panel.json");
  const panel = JSON.parse(readFileSync(panelPath, "utf8"));

  if (golden.ruleVersion && panel.ruleVersion
      && golden.ruleVersion !== panel.ruleVersion) {
    fail(`黄金是 ${golden.ruleVersion} 生成的，面板是 ${panel.ruleVersion} —— `
         + "两者不是同一次运行的产物，先重新跑 validation.panel");
  }

  const states = golden.states || [];
  const problems = replay(panel, states);
  if (!problems.length) {
    process.stdout.write(`${states.length} 个状态，两端逐位一致\n`);
    return 0;
  }

  process.stderr.write(
    `${problems.length}/${states.length} 个状态两端算出来的不一样。\n`
    + "页面在浏览器里重算的口径和工具算的对不上，这一页不能发出去。\n\n");
  for (const problem of problems.slice(0, MAX_REPORTED)) {
    const { path, expected, actual } = problem.diff;
    process.stderr.write(`状态  ${problem.key}\n`);
    process.stderr.write(`位置  ${path}\n`);
    process.stderr.write(`工具  ${JSON.stringify(expected)}\n`);
    process.stderr.write(`页面  ${JSON.stringify(actual)}\n\n`);
  }
  if (problems.length > MAX_REPORTED) {
    process.stderr.write(`…还有 ${problems.length - MAX_REPORTED} 个\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
