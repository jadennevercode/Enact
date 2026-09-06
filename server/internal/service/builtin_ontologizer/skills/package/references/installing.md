# 怎么交付

包渲染在 `exports/skill-package/<slug>/`。三种交付方式，按对方是谁选。

## 一个人自己用

```bash
cp -r <ws>/exports/skill-package/<slug> ~/.claude/skills/
```

Claude Code 下次启动就会看到它。这是最快的一种，适合本体负责人自己验一下
描述准不准、Agent 会不会在该用的时候用它。

## 一个团队用

渲染时加 `--plugin`，包里会多出 `.claude-plugin/plugin.json` 与
`marketplace.json`：

```bash
python3 <pkg>/scripts/package.py <ws> --plugin
claude plugin marketplace add <包目录>
claude plugin install <slug>
```

把包目录放进一个 git 仓库，团队成员从那里装，更新就是重新渲染再提交。

## 下游系统用

不装 Skill，直接读两份文件：

- `ontology/bundle.yaml` —— 机器可读的完整模型
- `ontology/graph.cypher` —— 导进图库的投影，每个 MERGE 以稳定 id 为键，
  重复执行会收敛而不是复制

`package.yaml` 里的 `source_revision` 和 `source_content_digest` 是它们
用来判断"我手上这份是不是最新"的依据。

## 更新一个已经发出去的包

**重新渲染，不要手改。**

```bash
python3 <pkg>/scripts/package.py <ws>
python3 <pkg>/scripts/package.py <ws> --check     # 确认磁盘上这份就是渲染结果
```

模型变了就得先有新的 candidate release：`review` → `revise` → 选定 → 重新打包。
包的版本跟着 revision 走，不单独编号——两套编号会立刻对不上。

## 装完之后验一下

拿三个问题问装了包的 Agent：

1. 一个用别名提的问题（看 glossary 生不生效）；
2. 一个模型明确不承诺的问题（看它会不会说不知道，而不是编）；
3. 一个跨两个对象的关系问题（看它读不读 relationships 的方向和基数）。

第二个最重要。**一个不肯说不知道的 Agent，比没有本体更危险**——
本体给了它更多可以自信引用的名词。
