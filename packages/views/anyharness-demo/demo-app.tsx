"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Boxes,
  Check,
  ChevronRight,
  Circle,
  FileText,
  Hammer,
  Layers,
  ListTodo,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@enact/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@enact/ui/components/ui/dialog";
import { Input } from "@enact/ui/components/ui/input";
import { Textarea } from "@enact/ui/components/ui/textarea";
import {
  agents,
  artifacts,
  family,
  frameworks,
  mechanisms,
  skills,
  runtimeStatus,
  subissues,
  suggestions,
  useDemo,
  type DemoArtifact,
  type DemoCommand,
  type DemoRepository,
  type DemoState,
  type Framework,
} from "@enact/core/anyharness-demo";
import { useNavigation } from "../navigation";

const box = "rounded-xl border border-border bg-background p-4";
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-md border border-border bg-muted px-2 py-0.5 text-caption font-medium">
      {children}
    </span>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}
function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DemoApp({
  repository,
  embedded = false,
}: {
  repository: DemoRepository;
  embedded?: boolean;
}) {
  const { state: s, send, error } = useDemo(repository);
  const nav = useNavigation();
  const [detail, setDetail] = useState<{
    title: string;
    body: ReactNode;
    artifact?: DemoArtifact;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [paused, setPaused] = useState(s.visible < s.messages.length);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [drafts, setDrafts] = useState({ build: "", trial: "" });
  const route =
    nav.searchParams.get("demoPath")?.split("/") ??
    nav.pathname.split("/").filter(Boolean).slice(1);
  const page = route[0] || "home",
    isTrial = route[1] === "AH-10",
    issue = isTrial ? "trial" : "build";
  const draft = drafts[issue];
  const setDraft = (text: string) =>
    setDrafts((previous) => ({ ...previous, [issue]: text }));
  const pending = s.visible < s.messages.length;
  const allArtifacts = artifacts(s),
    allMechanisms = mechanisms(s),
    tasks = subissues(s);
  const issueExists = isTrial
    ? s.trial !== "none"
    : route[1] === "AH-1" && tasks.length > 0;
  const go = (path: string) => {
    const [view, query] = path.split("?");
    const params = new URLSearchParams(query);
    params.set("demo", "1");
    params.set("demoPath", view!);
    nav.push(`/anyharness/runtimes?${params}`);
  };
  async function command(c: DemoCommand) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await send(c, crypto.randomUUID());
    } catch {
      setPaused(true);
      /* The query mutation exposes a recoverable error below. */
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) setPaused(true);
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!pending || paused || busy) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(
      () => void command({ type: reduced ? "reveal" : "tick" }),
      reduced ? 0 : 650,
    );
    return () => clearTimeout(timer);
  }, [s.visible, s.messages.length, paused, busy]);
  // Capture the create shortcut before shell handlers can dispatch a real issue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        go("issues");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  function openArtifact(id: string) {
    const a = allArtifacts.find((a) => a.id === id);
    if (a)
      setDetail({
        title: a.title,
        body: (
          <pre className="whitespace-pre-wrap break-words font-sans text-body leading-7">
            {a.body}
          </pre>
        ),
        artifact: a,
      });
  }
  function artifactLinks(ids: string[]) {
    return (
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => {
          const a = allArtifacts.find((a) => a.id === id);
          return a ? (
            <Button
              key={id}
              variant="outline"
              size="sm"
              onClick={() => openArtifact(id)}
            >
              <FileText />
              {a.title}
              <span className="text-muted-foreground">{a.version}</span>
            </Button>
          ) : null;
        })}
      </div>
    );
  }
  function showMechanism(id: string) {
    const m = allMechanisms.find((m) => m.id === id);
    if (m)
      setDetail({
        title: `${m.id} · ${m.domain}`,
        body: (
          <div className="space-y-5">
            <p>{m.choice}</p>
            <Section title="实现映射">
              <code>{m.implementation}</code>
            </Section>
            <Section title="验证方式">
              <p>{m.check}</p>
            </Section>
            {artifactLinks(["blueprint", "source"])}
          </div>
        ),
      });
  }
  function showAgent(id: string) {
    const a = agents.find((a) => a.id === id);
    if (!a) return;
    setDetail({
      title: a.name,
      body: (
        <div className="space-y-5">
          <p>{a.responsibility}</p>
          <p>
            <strong>输入：</strong>
            {a.input}
          </p>
          <p>
            <strong>交付：</strong>
            {a.output}
          </p>
          <p>
            <strong>边界：</strong>
            {a.boundary}
          </p>
          <Section title="挂载 Skills">
            <div className="flex flex-wrap gap-2">
              {a.skills.map((id) => (
                <Button
                  variant="outline"
                  key={id}
                  onClick={() => showSkill(id)}
                >
                  {skills.find((k) => k.id === id)?.name}
                </Button>
              ))}
            </div>
          </Section>
          <Section title="任务与交接">
            <p>
              {tasks
                .filter((t) => t.owner === a.name)
                .map((t) => `${t.id} ${t.title} · ${t.status}`)
                .join("；") || "协调主 Issue，等待阶段交接"}
            </p>
            {s.messages
              .slice(0, s.visible)
              .filter((m) => m.role === a.name)
              .map((m) => (
                <p key={m.id} className="border-l-2 border-brand pl-3">
                  {m.text}
                </p>
              ))}
          </Section>
        </div>
      ),
    });
  }
  function showSkill(id: string) {
    const k = skills.find((k) => k.id === id);
    if (!k) return;
    setDetail({
      title: k.name,
      body: (
        <div className="space-y-5">
          <Badge>v1.0 · 演示素材</Badge>
          <p>{k.purpose}</p>
          <p>
            <strong>触发：</strong>
            {k.trigger}
          </p>
          <p>
            <strong>输入：</strong>
            {k.input}
          </p>
          <p>
            <strong>输出：</strong>
            {k.output}
          </p>
          <p>
            <strong>领域：</strong>
            {k.domains.map((n) => `H${String(n).padStart(2, "0")}`).join("、")}
          </p>
          <p>
            <strong>示例：</strong>在{" "}
            {s.runtime?.name || "Enterprise Code Runtime"} 构建任务中，依据“
            {k.input}”生成“{k.output}”，记录来源 Issue
            与版本，交给下一个负责角色。
          </p>
          <Section title="挂载角色">
            <div className="flex flex-wrap gap-2">
              {agents
                .filter((a) => a.skills.includes(k.id))
                .map((a) => (
                  <Button
                    key={a.id}
                    variant="outline"
                    onClick={() => showAgent(a.id)}
                  >
                    {a.name}
                  </Button>
                ))}
            </div>
          </Section>
        </div>
      ),
    });
  }
  function createIssue() {
    if (s.stage === "team") void command({ type: "issue" });
    go("issues/AH-1");
  }
  const navItems = [
    ["home", "工作台", Boxes],
    ["issues", "任务", ListTodo],
    ["agents", "智能体团队", Bot],
    ["runtimes", "运行时", Layers],
  ] as const;
  const locked = ["ready", "failed", "published"].includes(s.stage);
  return (
    <div
      className={`enact-dashboard-shell flex ${embedded ? "h-full" : "h-svh"} min-h-0 flex-col bg-background text-foreground text-body`}
      data-testid="anyharness-demo"
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex items-center gap-3">
          <span className="font-semibold">Enact</span>
          <ChevronRight className="size-3 text-muted-foreground" />
          <span>AnyHarness</span>
          <Badge>演示</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setDetail({
                title: "关于此演示",
                body: (
                  <p>
                    仅此账号、此工作区可见。所有创建、对话、模型、构建、测试、发布和记忆均为本地模拟。真实工作区数据保持不变。支持当前场景的明确意图，无法回答任意问题。
                  </p>
                ),
              })
            }
          >
            模拟说明
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => nav.push("/anyharness/runtimes")}
          >
            返回真实工作区
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3 max-md:w-16">
          <div className="mb-3 hidden px-2 text-caption text-muted-foreground md:block">
            企业 Runtime 研发
          </div>
          {navItems.map(([path, label, Icon]) => (
            <button
              key={path}
              title={label}
              aria-current={page === path ? "page" : undefined}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted ${page === path ? "bg-muted font-semibold text-brand" : ""}`}
              onClick={() => go(path)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="max-md:hidden">{label}</span>
            </button>
          ))}
          <div className="mt-4 max-md:hidden">
            <Button
              className="w-full"
              disabled={s.stage === "empty" || s.stage === "draft"}
              onClick={createIssue}
            >
              <ListTodo />
              构建 Issue
            </Button>
          </div>
          <div className="mt-auto space-y-3 max-md:hidden">
            <label className="block space-y-2 text-caption text-muted-foreground">
              演示检查点
              <select
                aria-label="加载检查点"
                value=""
                className="w-full rounded-lg border border-border bg-background p-2 text-foreground"
                onChange={(e) => {
                  if (e.target.value) {
                    void command({
                      type: "checkpoint",
                      checkpoint: e.target.value as
                        | "design"
                        | "failed"
                        | "published",
                    });
                    go("issues/AH-1");
                  }
                }}
              >
                <option value="">加载完整场景…</option>
                <option value="design">待确认设计</option>
                <option value="failed">验证失败</option>
                <option value="published">已发布</option>
              </select>
            </label>
            <Button variant="ghost" onClick={() => setResetting(true)}>
              <RotateCcw />
              重置演示
            </Button>
            <p className="px-2 text-caption text-muted-foreground">
              数据仅保存于当前浏览器。
              <br />
              无真实模型或工具执行。
            </p>
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error && (
            <div
              role="alert"
              className="bg-destructive/10 p-3 text-destructive"
            >
              本地保存失败，未提交本轮变化。请检查浏览器存储后重试。
            </div>
          )}
          {pending && (
            <div
              className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-5 py-2"
              role="status"
            >
              <span>
                {paused
                  ? "播放已暂停"
                  : `${s.messages[s.visible]?.role} · 处理中`}{" "}
                <span className="text-muted-foreground">
                  {s.visible}/{s.messages.length} 条动态
                </span>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPaused((p) => !p)}
                >
                  {paused ? "继续播放" : "暂停播放"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void command({ type: "reveal" })}
                >
                  立即显示本轮结果
                </Button>
              </div>
            </div>
          )}
          {page === "issues" && route[1] && issueExists ? (
            <>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {isTrial ? "AH-10" : "AH-1"}
                  </span>
                  <Badge>
                    {isTrial
                      ? s.trial === "approval" || s.trial === "write-approval"
                        ? "待批准"
                        : s.trial === "complete"
                          ? "已完成"
                          : "进行中"
                      : runtimeStatus(s)}
                  </Badge>
                  <Badge>高优先级</Badge>
                </div>
                <Button variant="ghost" onClick={() => go("issues")}>
                  所有任务
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <div
                  className="min-w-0 flex-1 overflow-y-auto px-6 py-6 lg:px-10"
                  data-testid="demo-issue-scroll"
                >
                  <div className="mx-auto max-w-3xl space-y-7">
                    <h1 className="text-heading font-semibold break-words">
                      {isTrial
                        ? "修复价格计算中的边界错误"
                        : `构建 ${s.runtime?.name || "Enterprise Code Runtime"}`}
                    </h1>
                    <p className="leading-7 text-muted-foreground">
                      {isTrial
                        ? "使用已发布的企业 Runtime 完成一次模拟研发任务，观察上下文、工具授权、评审和记忆机制。"
                        : s.runtime?.goal}
                    </p>
                    {!isTrial && (
                      <Section title="阶段子任务">
                        <div className="rounded-xl border border-border divide-y divide-border">
                          {tasks.map((t) => (
                            <button
                              key={t.id}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                              onClick={() =>
                                setDetail({
                                  title: `${t.id} · ${t.title}`,
                                  body: (
                                    <div className="space-y-4">
                                      <Badge>{t.status}</Badge>
                                      <p>负责人：{t.owner}</p>
                                      <p>
                                        交付范围：{t.title}
                                        。完成后将产物与约束交接到下一阶段。
                                      </p>
                                      {artifactLinks(t.artifactIds)}
                                      {t.status === "待开始" ? (
                                        <p className="text-muted-foreground">
                                          此阶段尚未开始；执行后将显示交流和产物。
                                        </p>
                                      ) : (
                                        s.messages
                                          .slice(0, s.visible)
                                          .filter((m) => m.role === t.owner)
                                          .map((m) => (
                                            <p key={m.id}>{m.text}</p>
                                          ))
                                      )}
                                    </div>
                                  ),
                                })
                              }
                            >
                              {t.status === "已完成" ? (
                                <Check className="size-4 text-brand" />
                              ) : (
                                <Circle className="size-4 text-muted-foreground" />
                              )}
                              <span className="text-caption text-muted-foreground">
                                {t.id}
                              </span>
                              <span className="flex-1">{t.title}</span>
                              <span className="text-caption text-muted-foreground">
                                {t.status}
                              </span>
                            </button>
                          ))}
                          {s.validation.length > 0 && (
                            <button
                              className="flex w-full items-center gap-3 px-3 py-2 text-left"
                              onClick={() => openArtifact("validation-1")}
                            >
                              <ShieldCheck className="size-4" />
                              AH-D01 · 上下文压缩丢失架构约束{" "}
                              <Badge>
                                {s.validation.length > 1 ? "已修复" : "待修复"}
                              </Badge>
                            </button>
                          )}
                        </div>
                      </Section>
                    )}
                    <Section title="动态">
                      <div className="space-y-5">
                        {s.messages
                          .slice(0, s.visible)
                          .filter((m) => m.issue === issue)
                          .map((m) => (
                            <article key={m.id} className="flex gap-3">
                              <div
                                className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg ${m.role === "你" ? "bg-muted" : "bg-brand/10 text-brand"}`}
                              >
                                {m.role === "你" ? (
                                  <span>你</span>
                                ) : (
                                  <Bot className="size-4" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    className="font-semibold hover:underline"
                                    onClick={() => {
                                      const a = agents.find(
                                        (a) => a.name === m.role,
                                      );
                                      if (a) showAgent(a.id);
                                    }}
                                  >
                                    {m.role}
                                  </button>
                                  <span className="text-caption text-muted-foreground">
                                    {m.kind === "handoff"
                                      ? "派工与交接"
                                      : m.kind === "validation"
                                        ? "验证完成"
                                        : m.kind === "build"
                                          ? "模拟构建完成"
                                          : "已完成"}{" "}
                                    ·{" "}
                                    {new Date(m.time).toLocaleTimeString(
                                      "zh-CN",
                                      { hour: "2-digit", minute: "2-digit" },
                                    )}
                                  </span>
                                </div>
                                <p className="whitespace-pre-wrap break-words leading-7">
                                  {m.text}
                                </p>
                                {artifactLinks(m.artifactIds)}
                              </div>
                            </article>
                          ))}
                      </div>
                    </Section>
                    <form
                      className={`${box} space-y-3`}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!draft.trim() || pending || busy) return;
                        void command({ type: "comment", text: draft, issue });
                        setDraft("");
                      }}
                    >
                      <label htmlFor="demo-comment" className="font-medium">
                        回复 {isTrial ? "企业编码助手" : "构建 Family"}
                      </label>
                      <Textarea
                        ref={composer}
                        id="demo-comment"
                        placeholder="提出要求、修改设计或作出决定…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="min-h-24"
                      />
                      <div className="flex flex-wrap gap-2">
                        {suggestions(s, issue).map((text) => (
                          <Button
                            type="button"
                            key={text}
                            variant="outline"
                            size="sm"
                            className="h-auto whitespace-normal py-1 text-left"
                            onClick={() => {
                              setDraft(text);
                              composer.current?.focus();
                            }}
                          >
                            {text}
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-caption text-muted-foreground">
                          建议填入编辑器后，由你发送。
                        </span>
                        <Button
                          type="submit"
                          disabled={!draft.trim() || pending || busy}
                        >
                          <Send />
                          发送
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
                <aside className="hidden w-72 shrink-0 space-y-6 overflow-y-auto border-l border-border p-5 xl:block">
                  <Section title="当前阶段">
                    <Badge>
                      {isTrial
                        ? s.trial === "write-approval"
                          ? "补丁等待用户批准"
                          : s.trial === "approval"
                            ? "测试等待用户批准"
                            : s.trial === "complete"
                              ? "交付完成"
                              : "交付与记忆决定"
                        : runtimeStatus(s)}
                    </Badge>
                    <p className="text-muted-foreground">
                      {suggestions(s, issue)[0]}
                    </p>
                  </Section>
                  <Section title="负责团队">
                    <button
                      className="text-left text-brand hover:underline"
                      onClick={() => go("agents")}
                    >
                      {isTrial ? "企业编码助手" : family.name}
                    </button>
                  </Section>
                  <Section title="关联 Runtime">
                    <Button
                      variant="outline"
                      className="max-w-full truncate"
                      onClick={() => go("runtimes/demo-runtime-enterprise")}
                    >
                      {s.runtime?.name}
                    </Button>
                  </Section>
                  <Section title="设计与产物">
                    {artifactLinks(
                      isTrial
                        ? [
                            "trial-context",
                            "patch",
                            "trial-report",
                            "candidate",
                          ]
                        : [
                            "blueprint",
                            "diff",
                            "source",
                            "validation-1",
                            "validation-2",
                            "release",
                          ],
                    )}
                  </Section>
                  {!isTrial && (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => setEditing(true)}
                    >
                      编辑设计
                    </Button>
                  )}
                  {s.stage === "published" && !isTrial && (
                    <Button
                      onClick={() => go("runtimes/demo-runtime-enterprise")}
                    >
                      使用此 Runtime
                    </Button>
                  )}
                </aside>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 lg:p-9">
              <div className="mx-auto max-w-6xl space-y-7">
                {(page === "home" || page === "runtimes") && (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 text-caption text-muted-foreground">
                          ANYHARNESS / RUNTIME STUDIO
                        </div>
                        <h1 className="text-heading font-semibold">
                          {s.runtime ? s.runtime.name : "自建企业 Runtime"}
                        </h1>
                        <p className="mt-2 text-muted-foreground">
                          选择框架，通过构建 Issue 与 Agent Family
                          协作，设计企业自己的编码环境。
                        </p>
                      </div>
                      {s.runtime && (
                        <Badge>
                          {runtimeStatus(s)} · {s.runtime.version}
                        </Badge>
                      )}
                    </div>
                    {!s.runtime ? (
                      <FrameworkChooser
                        onCreate={(c) => void command(c)}
                        onPreview={setDetail}
                      />
                    ) : (
                      <>
                        <div className="grid gap-4 md:grid-cols-3">
                          <div className={box}>
                            <div className="text-caption text-muted-foreground">
                              框架与模型
                            </div>
                            <p className="mt-2 font-semibold">
                              {s.runtime.framework}
                            </p>
                            <p className="mt-2 text-muted-foreground">
                              企业内部模型 · 未连接
                            </p>
                          </div>
                          <div className={box}>
                            <div className="text-caption text-muted-foreground">
                              设计覆盖
                            </div>
                            <p className="mt-2 text-title font-semibold">
                              {allMechanisms.length} / 20 领域
                            </p>
                            <p className="mt-2 text-muted-foreground">
                              {s.revisions.length} 个蓝图版本
                            </p>
                          </div>
                          <div className={box}>
                            <div className="text-caption text-muted-foreground">
                              独立验证
                            </div>
                            <p className="mt-2 text-title font-semibold">
                              {s.validation.length
                                ? `${s.validation.at(-1)?.passed ? 12 : 11} / 12 通过`
                                : "等待构建"}
                            </p>
                            <p className="mt-2 text-muted-foreground">
                              {s.validation.length} 轮验证记录
                            </p>
                          </div>
                        </div>
                        <div
                          className={`${box} flex flex-wrap items-center justify-between gap-4`}
                        >
                          <div>
                            <h2 className="font-semibold">
                              {s.stage === "draft"
                                ? "准备构建团队"
                                : s.stage === "team"
                                  ? "在 Issue 中开始协作"
                                  : s.stage === "published"
                                    ? "开始使用企业 Runtime"
                                    : "继续构建 Issue"}
                            </h2>
                            <p className="mt-1 text-muted-foreground">
                              {s.stage === "published"
                                ? "绑定企业编码助手，完成一次有授权、有评审的模拟编码任务。"
                                : "Skills 定义方法，Agents 负责交付，Family 组织构建过程。"}
                            </p>
                          </div>
                          {s.stage === "draft" ? (
                            <Button
                              onClick={() => {
                                void command({ type: "team" });
                                go("agents");
                              }}
                            >
                              添加推荐 Family
                            </Button>
                          ) : s.stage === "team" ? (
                            <Button onClick={createIssue}>
                              创建构建 Issue
                            </Button>
                          ) : s.stage === "published" ? (
                            <Button
                              onClick={() => {
                                if (!s.coderBound)
                                  void command({ type: "bind" });
                                go("agents?tab=agents");
                              }}
                            >
                              {s.coderBound
                                ? "查看企业编码助手"
                                : "创建企业编码助手"}
                            </Button>
                          ) : (
                            <Button onClick={() => go("issues/AH-1")}>
                              打开构建 Issue
                            </Button>
                          )}
                        </div>
                        <Section title="生命周期">
                          <div className="flex flex-wrap items-center gap-2">
                            {[
                              "待设计",
                              "设计中",
                              "构建中",
                              "验证中",
                              "待修复",
                              "待发布",
                              "可用",
                            ].map((v, i) => (
                              <span key={v} className="flex items-center gap-2">
                                <Badge>{v}</Badge>
                                {i < 6 && (
                                  <ChevronRight className="size-3 text-muted-foreground" />
                                )}
                              </span>
                            ))}
                          </div>
                        </Section>
                        <Section title="机制架构">
                          <div className="grid gap-3 sm:grid-cols-3">
                            {[
                              ["H03", "模型适配"],
                              ["H05", "上下文组装"],
                              ["H07", "项目记忆"],
                              ["H09", "工具授权"],
                              ["H13", "开发与评审协作"],
                              ["H10", "隔离执行环境"],
                            ].map(([id, label]) => (
                              <button
                                key={id}
                                disabled={!allMechanisms.length}
                                onClick={() => showMechanism(id!)}
                                className={`${box} flex items-center justify-between text-left hover:bg-muted disabled:opacity-50`}
                              >
                                <span>{label}</span>
                                <ChevronRight className="size-4" />
                              </button>
                            ))}
                          </div>
                          <p className="text-caption text-muted-foreground">
                            模型 → 上下文 → 行为循环 → 工具授权 →
                            执行；知识与记忆提供证据，评审独立验收。
                          </p>
                        </Section>
                        <Section title="二十领域设计">
                          <div className="grid gap-2 md:grid-cols-2">
                            {allMechanisms.map((m) => (
                              <button
                                key={m.id}
                                className={`${box} text-left hover:bg-muted`}
                                onClick={() => showMechanism(m.id)}
                              >
                                <span className="text-caption text-muted-foreground">
                                  {m.id}
                                </span>
                                <span className="ml-2 font-medium">
                                  {m.domain}
                                </span>
                                <p className="mt-2 line-clamp-2 text-caption text-muted-foreground">
                                  {m.choice}
                                </p>
                              </button>
                            ))}
                          </div>
                          {!allMechanisms.length && (
                            <p className="text-muted-foreground">
                              需求澄清后生成领域设计卡。
                            </p>
                          )}
                        </Section>
                        <Section title="版本与追溯">
                          {artifactLinks(
                            allArtifacts
                              .filter(
                                (a) =>
                                  !a.id.startsWith("trial") &&
                                  a.id !== "patch" &&
                                  a.id !== "candidate",
                              )
                              .map((a) => a.id),
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => go("issues/AH-1")}
                            >
                              原始构建 Issue →
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => go("agents")}
                            >
                              负责的 Family、Agents、Skills →
                            </Button>
                            {s.trial !== "none" && (
                              <Button
                                variant="ghost"
                                onClick={() => go("issues/AH-10")}
                              >
                                模拟运行记录 →
                              </Button>
                            )}
                            {!locked && (
                              <Button
                                variant="outline"
                                onClick={() => setEditing(true)}
                              >
                                编辑设计
                              </Button>
                            )}
                          </div>
                        </Section>
                      </>
                    )}
                  </>
                )}
                {page === "agents" && (
                  <>
                    <h1 className="text-heading font-semibold">智能体团队</h1>
                    <div className="flex gap-2 border-b border-border pb-3">
                      {[
                        ["families", "Agent Family"],
                        ["agents", "Agents"],
                        ["skills", "Skills"],
                      ].map(([tab, label]) => (
                        <Button
                          key={tab}
                          variant={
                            (nav.searchParams.get("tab") || "families") === tab
                              ? "secondary"
                              : "ghost"
                          }
                          onClick={() => go(`agents?tab=${tab}`)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    {(nav.searchParams.get("tab") || "families") ===
                      "families" && (
                      <>
                        <div className={`${box} space-y-4`}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <Badge>构建团队 · 独立模拟环境</Badge>
                              <h2 className="mt-3 text-title font-semibold">
                                {family.name}
                              </h2>
                            </div>
                            <Badge>
                              {agents.length} 角色 · {skills.length} Skills
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">
                            研发并交付企业 Runtime；最终 Runtime
                            内部的开发、探索和评审角色另行绑定。
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {agents.map((a) => (
                              <button
                                key={a.id}
                                className={`${box} text-left hover:bg-muted`}
                                onClick={() => showAgent(a.id)}
                              >
                                <p className="font-medium">{a.name}</p>
                                <p className="mt-2 text-caption text-muted-foreground">
                                  {a.responsibility}
                                </p>
                              </button>
                            ))}
                          </div>
                          <p className="leading-7">
                            交接：Orchestrator → Architect → Context / Systems
                            Designer → Engineer → Independent Verifier → Release
                            Maintainer
                          </p>
                          <p>
                            当前：
                            {s.messages
                              .slice(0, s.visible)
                              .filter((m) => m.role !== "你")
                              .at(-1)?.role || "等待构建任务"}{" "}
                            · {runtimeStatus(s)}
                          </p>
                          <p>
                            待用户决定：
                            {suggestions(s, "build")[0] || "创建构建 Issue"}
                          </p>
                          {s.stage === "draft" ? (
                            <Button
                              onClick={() => void command({ type: "team" })}
                            >
                              添加推荐 Family
                            </Button>
                          ) : s.stage === "team" ? (
                            <Button onClick={createIssue}>
                              创建构建 Issue
                            </Button>
                          ) : tasks.length > 0 ? (
                            <Button onClick={() => go("issues/AH-1")}>
                              查看构建 Issue 与子任务
                            </Button>
                          ) : (
                            <Button onClick={() => go("runtimes")}>
                              先选择框架
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                    {nav.searchParams.get("tab") === "agents" && (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          {agents.map((a) => (
                            <button
                              key={a.id}
                              className={`${box} space-y-2 text-left hover:bg-muted`}
                              onClick={() => showAgent(a.id)}
                            >
                              <Bot className="size-5 text-brand" />
                              <p className="font-semibold">{a.name}</p>
                              <p className="text-muted-foreground">
                                {a.responsibility}
                              </p>
                              <Badge>{a.skills.length} Skills · 构建角色</Badge>
                            </button>
                          ))}
                        </div>
                        {s.coderBound && (
                          <div className={`${box} space-y-4`}>
                            <Badge>最终 Runtime 使用者</Badge>
                            <h2 className="text-title font-semibold">
                              企业编码助手
                            </h2>
                            <p>
                              Runtime：{s.runtime?.name} v1.0 ·
                              Skills：项目探索、补丁实现、测试验证、独立评审。
                            </p>
                            <p>
                              内部角色：Explorer → Developer →
                              Reviewer。工具：read_file、write_patch、run_tests（需批准）。
                            </p>
                            {artifactLinks(["tools", "family"])}
                            <Button
                              onClick={() => {
                                void command({ type: "trial" });
                                go("issues/AH-10");
                              }}
                            >
                              {s.trial === "none"
                                ? "创建模拟编码 Issue"
                                : "打开模拟编码 Issue"}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                    {nav.searchParams.get("tab") === "skills" && (
                      <div className="grid gap-3 md:grid-cols-2">
                        {skills.map((k) => (
                          <button
                            key={k.id}
                            className={`${box} text-left hover:bg-muted`}
                            onClick={() => showSkill(k.id)}
                          >
                            <p className="font-mono font-semibold">{k.name}</p>
                            <p className="mt-2 text-muted-foreground">
                              {k.purpose}
                            </p>
                            <p className="mt-3 text-caption text-muted-foreground">
                              {k.output} · v1.0
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {page === "issues" && (!route[1] || !issueExists) && (
                  <>
                    <div className="flex items-center justify-between">
                      <h1 className="text-heading font-semibold">任务</h1>
                      <Button disabled={!s.familyAdded} onClick={createIssue}>
                        构建 Issue
                      </Button>
                    </div>
                    {tasks.length ? (
                      <div className="divide-y divide-border rounded-xl border border-border">
                        {[
                          {
                            id: "AH-1",
                            title: `构建 ${s.runtime?.name}`,
                            status: runtimeStatus(s),
                          },
                          ...tasks,
                          ...(s.trial !== "none"
                            ? [
                                {
                                  id: "AH-10",
                                  title: "修复价格计算中的边界错误",
                                  status:
                                    s.trial === "complete"
                                      ? "已完成"
                                      : "进行中",
                                },
                              ]
                            : []),
                        ].map((t) => (
                          <button
                            key={t.id}
                            className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted"
                            onClick={() =>
                              go(
                                t.id === "AH-10"
                                  ? "issues/AH-10"
                                  : "issues/AH-1",
                              )
                            }
                          >
                            <span className="text-caption text-muted-foreground">
                              {t.id}
                            </span>
                            <span className="flex-1">{t.title}</span>
                            <Badge>{t.status}</Badge>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={`${box} space-y-4`}>
                        <p>
                          从 Runtime 选择框架并准备
                          Family，然后创建首个构建任务。
                        </p>
                        <Button onClick={() => go("runtimes")}>
                          自建企业 Runtime
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {!["home", "runtimes", "agents", "issues"].includes(page) && (
                  <div className={box}>
                    <h1 className="text-title">此页面不在演示范围内</h1>
                    <p className="my-4">
                      可继续访问运行时、智能体团队与任务，或返回真实工作区。
                    </p>
                    <Button onClick={() => go("runtimes")}>
                      返回演示运行时
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogTitle className="pr-6 text-title">{detail?.title}</DialogTitle>
          <DialogDescription>AnyHarness · 演示详情</DialogDescription>
          {detail?.body}
          {detail?.artifact && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    `${detail.artifact!.id}.md`,
                    detail.artifact!.body,
                    "text/markdown",
                  )
                }
              >
                下载 Markdown
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    `${detail.artifact!.id}.json`,
                    JSON.stringify(
                      { simulation: true, ...detail.artifact },
                      null,
                      2,
                    ),
                    "application/json",
                  )
                }
              >
                下载 JSON
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>编辑企业设计</DialogTitle>
          <DialogDescription>
            修改将同步到蓝图、机制卡和工程映射。
          </DialogDescription>
          {editing && s.runtime && (
            <DesignForm
              state={s}
              onSave={(c) => {
                void command(c);
                setEditing(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={resetting} onOpenChange={setResetting}>
        <DialogContent>
          <DialogTitle>重置本地演示？</DialogTitle>
          <DialogDescription>
            仅清除此账号、此工作区的 AnyHarness 演示进度。真实工作区保持原样。
          </DialogDescription>
          <Button
            onClick={() => {
              void command({ type: "reset" });
              setResetting(false);
              go("runtimes");
            }}
          >
            确认重置演示
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FrameworkChooser({
  onCreate,
  onPreview,
}: {
  onCreate: (c: DemoCommand) => void;
  onPreview: (v: { title: string; body: ReactNode }) => void;
}) {
  const [selected, setSelected] = useState<Framework>("Deep Agents");
  const [name, setName] = useState("Enterprise Code Runtime");
  const [goal, setGoal] = useState(
    "使用企业内部模型理解项目、修改代码、补充测试；管理项目上下文和记忆，支持独立评审，命令执行需要授权。",
  );
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {frameworks.map((f) => (
          <div
            key={f.name}
            className={`${box} space-y-4 ${selected === f.name ? "ring-2 ring-brand" : ""}`}
          >
            <button
              aria-pressed={selected === f.name}
              className="flex w-full items-center justify-between text-left"
              onClick={() => setSelected(f.name)}
            >
              <h2 className="text-title font-semibold">{f.name}</h2>
              {selected === f.name && <Check className="size-5 text-brand" />}
            </button>
            <Badge>
              {f.name === "Deep Agents" ? "完整构建与试用" : "架构与计划预览"}
            </Badge>
            <p className="leading-6">{f.base}</p>
            <p className="text-muted-foreground">企业自主设计：{f.design}</p>
            <p className="text-caption text-muted-foreground">{f.style}</p>
            <Button
              variant="outline"
              onClick={() => {
                setSelected(f.name);
                onPreview({
                  title: `${f.name} · 方案预览`,
                  body: (
                    <div className="space-y-5">
                      <p>{f.architecture}</p>
                      <p>
                        <strong>实施工作：</strong>
                        {f.work}
                      </p>
                      <p>
                        <strong>机制设计：</strong>
                        {f.design}
                      </p>
                      <p>
                        此处是演示方案，框架能力和适配接口需在真实研发阶段验证。
                      </p>
                      {f.name !== "Deep Agents" && (
                        <p>
                          本轮仅提供此框架的比较与方案预览。关闭预览后，可明确切换到
                          Deep Agents 体验完整构建。
                        </p>
                      )}
                    </div>
                  ),
                });
              }}
            >
              查看架构与计划
            </Button>
          </div>
        ))}
      </div>
      <div className={`${box} space-y-4`}>
        <h2 className="text-title font-semibold">
          {selected === "Deep Agents"
            ? "创建 Runtime 草稿"
            : `${selected} 方案已选中`}
        </h2>
        {selected === "Deep Agents" ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onCreate({ type: "create", framework: selected, name, goal });
            }}
          >
            <label className="block space-y-2">
              Runtime 名称
              <Input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-2">
              企业目标
              <Textarea
                required
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <Button type="submit">
              <Hammer />
              创建 Runtime 草稿
            </Button>
          </form>
        ) : (
          <>
            <p className="text-muted-foreground">
              当前框架提供架构与构建计划预览，完整交互演示基于 Deep Agents。
            </p>
            <Button onClick={() => setSelected("Deep Agents")}>
              使用 Deep Agents 体验完整构建
            </Button>
          </>
        )}
      </div>
    </>
  );
}
function DesignForm({
  state: s,
  onSave,
}: {
  state: DemoState;
  onSave: (c: DemoCommand) => void;
}) {
  const [name, setName] = useState(s.runtime!.name),
    [goal, setGoal] = useState(s.runtime!.goal),
    [language, setLanguage] = useState(s.runtime!.language),
    [protect, setProtect] = useState(s.protectedContext.join("、")),
    [memory, setMemory] = useState(s.memory),
    [tools, setTools] = useState(s.tools);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          type: "configure",
          name,
          goal,
          language,
          protectedContext: protect
            .split(/[、,，\n]/)
            .map((x) => x.trim())
            .filter(Boolean),
          memory,
          tools,
        });
      }}
    >
      <label className="block space-y-2">
        Runtime 名称
        <Input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        企业目标
        <Textarea
          required
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        主要语言
        <Input
          required
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        上下文保护内容（顿号分隔）
        <Textarea
          value={protect}
          onChange={(e) => setProtect(e.target.value)}
        />
      </label>
      <label className="block space-y-2">
        记忆策略
        <select
          className="w-full rounded-lg border border-border bg-background p-2"
          value={memory}
          onChange={(e) => setMemory(e.target.value as typeof memory)}
        >
          <option value="verified">候选—验证—用户采纳</option>
          <option value="direct">项目内直接复用（待评审）</option>
        </select>
      </label>
      <label className="block space-y-2">
        工具授权
        <select
          className="w-full rounded-lg border border-border bg-background p-2"
          value={tools}
          onChange={(e) => setTools(e.target.value as typeof tools)}
        >
          <option value="confirm">命令逐次确认</option>
          <option value="writes">写入和命令均需确认</option>
        </select>
      </label>
      <Button type="submit">保存设计变更</Button>
    </form>
  );
}
