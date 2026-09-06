---
name: enact-workspace-profile
description: "Use when establishing or revising what a workspace says its project is: the setup checklist's profile step, a member asking you to fill it in, an interview about the project, or a profile that is empty or stale when something needs to read it."
user-invocable: false
allowed-tools: Bash(enact *)
---

# Establish what this project is

A workspace's profile is one document: a summary, the domain, the stack, the
kinds of work it brings here, and the constraints a run must respect.

Two things read it, which is why it is worth getting right rather than getting
done:

- **Every agent run starts with it.** It is rendered into the runtime brief as
  `## Project profile`, so a run no longer has to infer the team's conventions
  from whatever files it happens to open.
- **The Marketplace ranks against it.** What gets recommended to this workspace
  is decided by `stack` and `typical_work` matching what listings say they are
  for. An empty profile means the ranking has nothing to go on and falls back
  to whatever the deployment ships.

## Read it before you write it

```bash
enact workspace profile get --output json
```

A profile that already says something is a draft to revise, not a blank to
fill. Ask about what is missing or looks stale; do not re-ask what is answered.

## Interview, do not interrogate

Five to seven questions, one at a time. The member is trying to start work, not
fill in a form.

Every question offers two or three concrete options drawn from what you already
know — the workspace name, the repositories connected, their first message —
so they can answer by picking rather than by composing. A member who has to
write a paragraph will write "software" and move on, and "software" recommends
nothing.

Cover, in roughly this order, stopping early when you have enough:

1. **What this project is**, in a sentence. Offer two readings of the name or
   the repository and let them correct you.
2. **What it is for and who uses it** — this becomes `domain`.
3. **The stack**, if a repository has not already answered it. Never ask this
   when the repository analysis has: read `repo_brief` first.
4. **What they bring here** — map their answer onto `typical_work`. Offer the
   two or three values that fit their role, in their own words, not as slugs.
5. **Constraints** — review requirements, environments, compliance, anything a
   run must respect. Ask once; many teams have none.

Do not ask about team size unless they raise it. It changes nothing downstream
and reads as a sales question.

## typical_work is a closed vocabulary

`ship_code`, `review_code`, `plan_product`, `research`, `write_docs`,
`automate_ops`, `data_analysis`, `knowledge_modeling`, `design`, `support`,
`compliance`.

It is closed because the recommender maps these values onto what listings say
they are for; free text would score against nothing. Never invent a value — the
write is refused and names the offending one. Anything that does not fit goes
in `summary` or `constraints`, where it still reaches every run.

Never show the member a slug. Ask "mostly writing and shipping code, or more
reviewing what others wrote?" and record `ship_code` / `review_code` yourself.

## Preview, confirm, then write

Show the whole document back in plain language before writing it — this is what
every later run will be told the project is, and a wrong sentence here is wrong
in every task until someone notices.

Ask one confirmation question. Then:

```bash
enact workspace profile set --json-stdin <<'JSON'
{
  "summary": "A logistics control tower for mid-size carriers.",
  "domain": "logistics",
  "stack": ["go", "typescript", "postgres"],
  "languages": ["zh", "en"],
  "typical_work": ["ship_code", "review_code"],
  "constraints": "Production changes need a second reviewer."
}
JSON
```

**The write is a replace, not a merge.** A field you omit is cleared. When you
are revising, start from `profile get` output and change what needs changing.

The two exceptions are `repo_brief` and `repo_brief_sources`: they are written
by the repository analysis, and are carried forward when your document omits
them entirely. Do not write them from a conversation — if the member describes
their repository, that belongs in `summary`.

## Then get out of the way

Writing the profile closes the setup checklist's profile step on its own; do
not also close the issue.

Say what changes now, in one or two sentences: runs will start knowing this,
and the Marketplace can rank against it. Offer the next thing — reading the
recommendations — and stop. The profile is a means, and a member who wanted to
answer questions about their project would have opened a form.
