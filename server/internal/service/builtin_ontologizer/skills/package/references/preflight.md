# 打包之前先确认什么

四件事，都能用脚本查，不要凭印象。

## 1 · 有没有选定的候选发布

```bash
python3 <pkg>/scripts/state.py status <ws>
```

状态是 `candidate_selected` 或 `submitted` 才有得打。还在 `in_review` 或
`revision_pending` 就说明模型还在改——打一个正在改的模型出去，
下周就要收回来。

没有选定时不要自作主张挑一版。`candidate_selection` 是本体负责人的决定，
交给 `revise` 去开那道决策点。

## 2 · 那一版封存了没有

`package_from_candidate` 会查。没封存的版本还会变，包和它的对应关系立刻就假了。

## 3 · 评估跑过没有

评估不是必须的，但**没跑过的包，`competency-questions.md` 是空的**——
消费它的人就不知道这份本体验过什么。

跑过更好的地方在 boundaries：`unsupported` 的问题会被写进「不承诺的能力」，
那是消费方最需要知道的一段。没有评估，这一段就只剩未决假设和未裁决的冲突。

值得跟人说一句：现在打也可以，但评估之后重新渲染一次，包会诚实很多。

## 4 · 未决项都有主吗

```bash
python3 <pkg>/scripts/validate.py <ws> --check conflicts_not_merged
```

未裁决的冲突会原样写进 `boundaries.md`。这是对的——但一条没有 owner 的冲突
写进去，读的人看到的是「有分歧」，不知道该找谁。打包前把 owner 补齐，
比打完之后再解释便宜。

## 什么不算阻塞

- **没提交（没有 PR）。** 两条路互不依赖。
- **有 warning 级检查没过**（`behaviour_present`、`inheritance_is_a`）。
  它们会体现在包里：没有事件和生命周期的本体，`behaviour.md` 会直说
  「这份本体没有建事件」。那是诚实的呈现，不是要拦住打包。
