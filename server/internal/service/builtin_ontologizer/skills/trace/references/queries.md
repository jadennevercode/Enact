# 七种问法，各自怎么答

下面每条命令都能直接跑。`<pkg>` 是本插件根目录，`<ws>` 是工作区目录，
`<rev>` 是版本号（不指定就用当前 HEAD，`revision.py head <ws>` 能读出来）。

两个入口的区别要记住：

- **读磁盘上的索引**（快，但不含 scope 成员与断链状态）：读 `trace-index.yaml`。
- **现算一次**（含全部十二栏）：`index.build(ws, rev, derived=True)`。凡是要回答
  `orphaned` 或 Access Scope 归属，必须走这一条。

共同的前缀：`PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "..."`。

## why <对象>

十二个字段全给，然后用人话讲一遍：它靠什么撑着、出处能不能翻回去核对、这一版动过没有。

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
import yamlio
from tools.trace import index
idx = index.build('<ws>', '<rev>', derived=True)
print(yamlio.dump(index.records_by_id(idx)['ent.journal_entry']))
"
```

念的时候按这个顺序：**这一版里它是什么 → 靠什么撑着（support_types）→
出处在哪（source_ids + anchors 的原始短语）→ 这一版相对上一版动过没有 →
有没有检查点过它的名字**。原始短语要原样念出来，不要转述——
人核对的就是那句话。

`support_types` 只有 `assumption` 时必须明说："这个对象没有证据，是一条假设撑着的。"
不要因为它有 id、有定义就说得像有出处一样。

## unsupported

哪些对象一条 support 都没有。权威判断是检查项，先跑它：

```bash
python3 <pkg>/scripts/validate.py <ws> --check trace_complete --revision <rev>
```

它会点名到具体对象。要自己列一遍：

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
from tools.trace import index
idx = index.build('<ws>', '<rev>', derived=True)
rows = [r for r in idx['records'] if not r['orphaned'] and not r['support_types']]
print(len(rows), '/', idx['record_count'])
for r in rows: print(r['object_kind'], r['object_id'])
"
```

空的就说"这一版 N 个对象全部解析到了依据"，把 N 和版本号报出来。
不要说"未发现明显问题"——那让人分不清是真干净还是你没查。

## orphaned

上一版的意见指向了一个这一版里不存在的对象。**必须用现算的那条路**，
磁盘上的索引不存这一栏。

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
from tools.trace import index
idx = index.build('<ws>', '<rev>', derived=True)
for r in idx['records']:
    if r['orphaned']: print(r['object_id'], r['change_history'])
"
```

每条断链要说清它来自哪条变更请求（`change_history` 里的 `from_comment`）
和哪一版（`source_revision`）。断链本身不是错误，是一个必须被人看见的事实——
它通常意味着某条意见还没被处理，而它指的东西已经没了。

配套的检查项看的不是索引，而是意见记录本身：

```bash
python3 <pkg>/scripts/validate.py <ws> --check locators_resolve_or_orphaned --revision <rev>
```

它要求 `history/comments.yaml` 里那条意见自己带上 `orphaned: true` 或
`status: orphaned`。标记必须留在人会打开的那个文件里，不能只留在推导出来的索引里——
索引重建一次，断链就被悄悄补齐了，没人会知道链断过。

**这个标记不由 `trace` 来写**（它只读）。查出来之后把清单交给 `review` 或 `revise`，
由它们在处理那条意见时标上。

## assumptions

靠假设撑着的对象，逐条说它影响了什么。

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
from tools.trace import index
idx = index.build('<ws>', '<rev>', derived=True)
for r in idx['records']:
    if 'assumption' in r['support_types']:
        print(r['object_id'], r['object_kind'], r['source_ids'], '| CQ:', r['evaluation_links'])
"
```

拿到的 `source_ids` 是假设的 id，去 `define/fagc-register.yaml` 里读它的
`rationale` 和 `owner`——"这条假设是谁提的、凭什么"是人处理它时唯一需要的两样东西。
没有 owner 的假设要专门点出来：没主的假设会漂移成事实。

## impact <证据|假设>

改这条来源会波及哪些对象。修订前问这个，比改完再看 diff 便宜。

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
from tools.trace import index
key = 'ev.gl-ch6'
idx = index.build('<ws>', '<rev>', derived=True)
hits = [r for r in idx['records'] if key in r['source_ids']]
print(len(hits), '个对象引用了', key)
for r in hits: print(' ', r['object_kind'], r['object_id'], '| CQ:', r['evaluation_links'], '| scope:', r['scope_membership'])
"
```

报三样：受影响的对象数与清单、其中哪些被 Competency Question 依赖（改了会影响评估）、
哪些已经进了 Access Scope（改了会动治理边界）。后两样是修订影响分析要用的。

**这里只报波及面，不建议改不改。** 那是 `revise` 的影响分析和人的判断。

## history <对象>

它在各版本之间怎么变的。把每一版的索引串起来：

```bash
PYTHONPATH=<pkg>:<pkg>/shared/lib python3 -c "
import yamlio, pathlib
ws = pathlib.Path('<ws>'); obj = 'rel.reverses'
for d in sorted((ws / 'revisions').glob('r[0-9]*')):
    p = d / 'trace-index.yaml'
    if not p.is_file(): continue
    rec = {r['object_id']: r for r in yamlio.load_path(p)['records']}.get(obj)
    print(d.name, rec['change_history'] if rec else '不在这一版里')
"
```

输出长这样：

```
r0001 [{'revision': 'r0001', 'action': 'created'}]
r0002 [{'revision': 'r0002', 'action': 'changed', 'parent': 'r0001'}]
r0003 [{'revision': 'r0003', 'action': 'unchanged', 'parent': 'r0002'}]
```

`changed` 的那一版要接着去看它的 `semantic-diff.yaml`，说清具体改了哪些字段——
只说"r0002 改过"没有用，人要知道改的是基数还是方向。
"不在这一版里"也要报出来：一个中途消失又出现的对象，通常意味着一次没说清的删除。

## rebuild

```bash
python3 <pkg>/scripts/validate.py <ws> --check trace_index_current --revision <rev>
```

这条只算不写。**封存的版本到此为止**：不一致就把差异原样报出来，
交给 `orchestrator` 去查是谁在封存后动了这一版，不要自己重建把证据抹掉。

只有还在 running（还没封存）的版本才可以真的写索引，而那本来就是封存那一步会做的事：

```bash
python3 <pkg>/scripts/revision.py seal <ws> <rev>   # 建索引 → 过机器门 → 写摘要
```
