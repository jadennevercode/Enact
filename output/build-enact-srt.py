from pathlib import Path
import math
import re

TEXT = """Enact，Enterprise AI OS。

将专家智慧转化为持续进化的企业本能，突破人力驱动的增长边界。

在开发和咨询交付中，专业经验往往掌握在少数专家手里。每个新项目，都需要重新组织方法、交代背景、协调分工和检查结果。Enact 将这些工作连接起来，让人与 AI 围绕共同目标完成交付。

第一项核心能力，是 Reusable Agent Family。

当一套方法已经被验证，团队应该能够在下一个项目中继续使用。Enact 将方法论中的角色、流程、知识和工具，组织成协助团队交付的 AI Teammate。

进入智能体团队，可以看到面向不同专业场景的 Agent Family。打开一个 Family，成员与职责明确呈现，协作指引定义团队如何分工，以及什么时候需要人参与。

进入具体 Agent，可以配置专业指令、模型和运行时；打开它使用的 Skill，可以查看方法步骤、参考资料、模板与检查脚本。专家经验由此成为可以按项目配置、重复使用的团队能力。

第二项能力，是 Multi-Workspace。

项目交付需要持续共享背景、跟进依赖和处理变化。随着参与的人和智能体增加，团队更需要一个共同的协作空间。

通过工作区切换器，可以进入不同客户、团队或项目的工作环境，各自组织成员、资源、任务和智能体配置。

打开一项任务，明确目标、关联材料，再将工作分配给成员、Agent 或整个 Family。待办任务分配给智能体后，执行即可启动。

在任务详情中，可以查看分工和进展，通过评论补充背景、回答问题或调整方向，再打开产物检查结果。目标、讨论和执行历史持续关联，让人与 AI 能够接着彼此的工作往下推进。

第三项能力，是 Unified Runtime, Connectivity & Observability。

企业已经拥有代码仓库、数据系统和知识资产，也在使用不同的 AI 工具。Enact 将这些能力连接到交付流程，并帮助团队掌握执行情况与资源消耗。

打开运行时，可以统一查看本机、远程和云端环境，以及机器状态、可用工具和当前工作负载。桌面端自动发现本机 AI 工具，也可以连接服务器和远程开发机。

进入来源，可以关联代码仓库、本地目录与知识库；通过数据与系统连接和 MCP，接入项目需要的数据与工具。

再打开观测，可以查看 Token 消耗、运行时长、执行次数和费用统计，比较不同智能体的资源使用，并进一步检查失败原因。

接下来，看开发与咨询两条交付轨道。

首先是开发轨道，AI SDLC。

开发交付的难点，在于让业务需求经过设计、实现和测试，最终成为符合预期的软件。

AI SDLC 从需求澄清开始，协助团队明确方案、变更范围和验收标准，再由不同角色推进开发、验证与发布准备。

打开项目任务，可以看到阶段分工、执行进展和需要人决定的事项；进入交付产物，可以检查设计方案、代码变更与测试证据。

业务目标由此贯穿工程过程，团队依据明确的标准和证据完成验收，并将有效做法沉淀到后续交付中。

接下来是咨询轨道，MMM。

一个 MMM 项目，需要跨越业务访谈、模型设计、数据处理、算法建模和客户汇报，每个阶段都有不同的专业要求。

Enact 将这些工作组织成协作流程：前期梳理业务驱动因素、设计模型，随后推进数据收集、质量检查与分析，再完成算法建模、结果解读和汇报准备。

在工作区中，可以沿着任务查看访谈结论、数据分析、建模结果与汇报产物。不同 AI Teammate 承接多类型工作，顾问确认关键业务判断，让专业方法贯穿端到端交付。

同属咨询轨道的 Ontologizer，帮助企业将业务经验转化为能够投入使用的本体。

AI 像 FDE 一样，从用户的业务问题出发，通过持续对话澄清概念、补齐关系，手把手协助设计业务对象、行动和规则。

在 Ontology Studio 中，可以逐步查看和修改模型，完成构建、测试、审阅与版本治理。

经过确认的本体进一步连接真实数据和业务系统，将业务定义用于查询、调查、规则判断与受控行动，让本体从设计成果走进日常业务运行。

从专业方法的复用，到项目中的人机协作，再到统一连接与运行，Enact 让每次交付留下可使用的成果，也为下一次交付积累更成熟的能力。

Enact，Enterprise AI OS。

将专家智慧转化为持续进化的企业本能，突破人力驱动的增长边界。"""


def width(text):
    return sum(1 if ord(char) > 127 else 0.55 for char in text)


def wrap(sentence):
    if width(sentence) <= 27:
        return sentence
    candidates = [match.end() for match in re.finditer(r"[，：；]", sentence)]
    if not candidates:
        candidates = [match.start() for match in re.finditer(r"\s+", sentence)]
    if not candidates:
        return sentence
    midpoint = min(
        candidates,
        key=lambda index: abs(width(sentence[:index]) - width(sentence[index:])),
    )
    return sentence[:midpoint].strip() + "\n" + sentence[midpoint:].strip()


def timestamp(milliseconds):
    seconds, millis = divmod(milliseconds, 1000)
    minutes, secs = divmod(seconds, 60)
    hours, mins = divmod(minutes, 60)
    return f"{hours:02}:{mins:02}:{secs:02},{millis:03}"


sentences = [part.strip() for part in re.findall(r"[^。！？；]+[。！？；]?", TEXT) if part.strip()]
# Keep each full sentence or independent semicolon clause together.
# Visual line breaks do not insert a pause inside the sentence.
cues = sentences

blocks = []
intervals = []
start_ms = 0
for number, cue in enumerate(cues, 1):
    han = len(re.findall(r"[\u3400-\u9fff]", cue))
    words = re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*", cue)
    english_seconds = sum(0.65 if len(word) <= 5 else 0.95 for word in words)
    # Estimate clear narration at 240 Chinese characters per minute.
    duration_ms = max(3000, math.ceil((han / 4 + english_seconds + 0.5) * 2) * 500)
    end_ms = start_ms + duration_ms
    blocks.append(f"{number}\n{timestamp(start_ms)} --> {timestamp(end_ms)}\n{cue}")
    intervals.append((start_ms, end_ms))
    start_ms = end_ms + 10_000

normalize = lambda value: re.sub(r"\s+", "", value)
assert normalize("".join(cues)) == normalize(TEXT), "Narration text changed"
assert all(b[0] - a[1] == 10_000 for a, b in zip(intervals, intervals[1:]))
assert all(end > start for start, end in intervals)
output = Path(__file__).with_name("Enact-旁白-句间隔10秒.srt")
output.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
saved_blocks = output.read_text(encoding="utf-8").strip().split("\n\n")
assert len(saved_blocks) == len(cues)
assert all(block.splitlines()[0] == str(i) for i, block in enumerate(saved_blocks, 1))
assert normalize("".join("".join(block.splitlines()[2:]) for block in saved_blocks)) == normalize(TEXT)
print(f"File: {output}")
print(f"Cues: {len(cues)}")
print(f"Total: {timestamp(intervals[-1][1])}")
print(f"Estimated narration: {timestamp(sum(end-start for start,end in intervals))}")
print("Verified: complete original text, sequential numbering, 10-second gaps, valid timestamps, UTF-8")
