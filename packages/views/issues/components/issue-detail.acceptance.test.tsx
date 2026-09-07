// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Acceptance is a product rule -- `done` belongs to a person, and an agent
// takes work as far as `in_review` -- so the header has to say which of the
// two things the button does. The rule is spelled out here rather than
// through a DOM mount: issue detail needs a workspace, a status catalog, a
// timeline and a dozen queries to render, and none of that is what this
// pins. The canonical behavioural suite is issue-detail.test.tsx.
const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "issue-detail.tsx"),
  "utf8",
);

describe("issue detail acceptance actions", () => {
  it("labels the same write as acceptance while the work is in review", () => {
    expect(source).toMatch(
      /issueBehavesAs\(issue, "in_review"\)\s*\?\s*t\(\(\$\) => \$\.detail\.accept_tooltip\)\s*:\s*t\(\(\$\) => \$\.detail\.mark_done_tooltip\)/,
    );
  });

  it("offers sending it back only while it is in review", () => {
    expect(source).toMatch(
      /onDone && issueBehavesAs\(issue, "in_review"\) && \(/,
    );
    expect(source).toMatch(/\$\.detail\.return_tooltip/);
  });

  // Sending work back has to re-arm the agent. An assigned issue in the
  // `todo` category starts a run; parking it anywhere else leaves the work
  // stalled in a state nobody is watching.
  it("sends it back to the todo category, not to a hardcoded status", () => {
    expect(source).toMatch(/const todo = statusesInCategory\("todo"\)\[0\];/);
    expect(source).toMatch(/if \(todo\) handleUpdateField\(\{ status: todo\.key \}\)/);
  });

  // A workspace can rename or archive its statuses, so the button has to
  // cope with a catalog that offers nothing in that category.
  it("disables the action when the workspace has no todo status", () => {
    expect(source).toMatch(/disabled=\{!statusesInCategory\("todo"\)\[0\]\}/);
  });
});
