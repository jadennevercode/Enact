// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  canDecideLesson,
  isLessonOpen,
  isRetrospectiveActive,
  isRetrospectivePending,
  lessonStatusTone,
  retrospectiveStatusTone,
} from "./lesson-display";

describe("lessonStatusTone", () => {
  test("maps every shipped status", () => {
    expect(lessonStatusTone("proposed")).toBe("pending");
    expect(lessonStatusTone("in_review")).toBe("pending");
    expect(lessonStatusTone("published")).toBe("positive");
    expect(lessonStatusTone("rejected")).toBe("negative");
    expect(lessonStatusTone("deprecated")).toBe("muted");
  });

  test("degrades an unknown status instead of failing", () => {
    // Installed desktop builds talk to newer backends. A status this build has
    // never heard of must render as something neutral, not as nothing.
    expect(lessonStatusTone("some_future_status")).toBe("muted");
  });
});

describe("retrospectiveStatusTone", () => {
  test("maps every shipped status", () => {
    expect(retrospectiveStatusTone("suggested")).toBe("pending");
    expect(retrospectiveStatusTone("queued")).toBe("pending");
    expect(retrospectiveStatusTone("running")).toBe("pending");
    expect(retrospectiveStatusTone("completed")).toBe("positive");
    expect(retrospectiveStatusTone("failed")).toBe("negative");
    expect(retrospectiveStatusTone("dismissed")).toBe("muted");
  });

  test("degrades an unknown status", () => {
    expect(retrospectiveStatusTone("resurrected")).toBe("muted");
  });
});

describe("canDecideLesson", () => {
  test("offers a decision on an open, current proposal", () => {
    expect(canDecideLesson({ status: "proposed", base_version_current: true })).toBe(true);
    expect(canDecideLesson({ status: "in_review", base_version_current: true })).toBe(true);
  });

  test("refuses a stale proposal", () => {
    // The server rejects it, so the button would always fail. Say so before the
    // reviewer reads the diff rather than after they press it.
    expect(canDecideLesson({ status: "proposed", base_version_current: false })).toBe(false);
  });

  test("refuses a decided one", () => {
    for (const status of ["published", "rejected", "deprecated"] as const) {
      expect(canDecideLesson({ status, base_version_current: true })).toBe(false);
    }
  });

  test("treats a missing staleness flag as stale", () => {
    // Not truthiness: a backend that stops sending the field must not make
    // every proposal look approvable.
    expect(
      canDecideLesson({ status: "proposed" } as unknown as {
        status: "proposed";
        base_version_current: boolean;
      }),
    ).toBe(false);
  });
});

describe("open and pending predicates", () => {
  test("isLessonOpen covers exactly the undecided statuses", () => {
    expect(isLessonOpen({ status: "proposed" })).toBe(true);
    expect(isLessonOpen({ status: "in_review" })).toBe(true);
    expect(isLessonOpen({ status: "published" })).toBe(false);
  });

  test("a suggestion is pending until it is answered either way", () => {
    expect(isRetrospectivePending({ status: "suggested" })).toBe(true);
    expect(isRetrospectivePending({ status: "dismissed" })).toBe(false);
    expect(isRetrospectivePending({ status: "queued" })).toBe(false);
  });

  test("active covers the two in-flight statuses", () => {
    expect(isRetrospectiveActive({ status: "queued" })).toBe(true);
    expect(isRetrospectiveActive({ status: "running" })).toBe(true);
    expect(isRetrospectiveActive({ status: "completed" })).toBe(false);
  });
});
