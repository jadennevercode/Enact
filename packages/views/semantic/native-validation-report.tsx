"use client";
import { CheckCircle2, CircleDashed, CircleX, ShieldCheck } from "lucide-react";
import { RecordView, useSemanticText } from "./shared";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : [];

export function NativeValidationReport({ artifact }: { artifact: RecordValue }) {
  const t = useSemanticText();
  const report = record(artifact.validation_report), schema = record(report.schema), shacl = record(report.shacl);
  const schemaChecks = [record(schema.entities).valid, record(schema.relationships).valid];
  const schemaPassed = schema.valid ?? schema.is_valid ?? (schemaChecks.every(value => typeof value === "boolean") ? schemaChecks.every(Boolean) : undefined);
  const questions = records(artifact.competency_questions), results = records(report.competency_questions), findings = records(report.findings);
  const checks = [
    { label: t("schemaValidation"), passed: schemaPassed, value: schema },
    { label: t("shaclValidation"), passed: shacl.valid ?? shacl.conforms, value: shacl },
    { label: t("competencyQuestions"), passed: results.length ? results.every(r => r.passed === true) : undefined, value: results },
  ];
  return <section className="space-y-4 rounded-xl border border-border-soft p-5">
    <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h3 className="text-body font-semibold">{t("nativeValidation")}</h3></div>
    <p className="text-body text-muted-foreground">{t("nativeValidationHelp")}</p>
    <div className="grid gap-3 md:grid-cols-3">{checks.map(check => {
      const Icon = check.passed === true ? CheckCircle2 : check.passed === false ? CircleX : CircleDashed;
      return <details key={check.label} className="rounded-lg border border-border-soft p-4"><summary className="cursor-pointer text-body"><span className="flex items-center gap-2"><Icon className={`size-4 ${check.passed === true ? "text-success" : check.passed === false ? "text-destructive" : "text-muted-foreground"}`} />{check.label}</span><span className="mt-2 block text-caption text-muted-foreground">{t(check.passed === true ? "passed" : check.passed === false ? "failed" : "notEvaluated")}</span></summary><div className="mt-3"><RecordView value={check.value} /></div></details>;
    })}</div>
    {questions.length > 0 && <div className="space-y-2">{questions.map((question, i) => {
      const result = results.find(r => r.id === question.id), Icon = result?.passed === true ? CheckCircle2 : result?.passed === false ? CircleX : CircleDashed;
      return <details key={String(question.id || i)} className="rounded-lg border border-border-soft p-4"><summary className="cursor-pointer text-body"><Icon className={`mr-2 inline size-4 ${result?.passed === true ? "text-success" : result?.passed === false ? "text-destructive" : "text-muted-foreground"}`} />{String(question.question || question.name || question.description || question.id || i + 1)}</summary><div className="mt-3 space-y-3">{question.query ? <pre className="overflow-auto rounded-md bg-muted/30 p-3 font-mono text-caption">{String(question.query)}</pre> : null}<RecordView value={result || question} /></div></details>;
    })}</div>}
    {findings.length > 0 && <div className="space-y-2">{findings.map((finding, i) => <div key={i} className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-body"><p>{String(finding.message || finding.code || "")}</p><details className="mt-2"><summary className="cursor-pointer text-caption text-muted-foreground">{t("advanced")}</summary><RecordView value={finding} /></details></div>)}</div>}
  </section>;
}
