// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "@enact/core/api";
import { applicationError } from "@enact/core/semantic";
const draft = {
  approval_id: "1b0bd562-2f85-441a-9c45-0e1ad6149243",
  run_id: "765d3d1d-bb5a-410f-90f1-48f31f4d770c",
  status: "pending",
};
describe("application error allowlist", () => {
  it("preserves a valid 409 reference while stripping all other backend fields", () => {
    const result = applicationError(
      new ApiError("Continue the existing draft", 409, "Conflict", {
        existing_draft: { ...draft, internal_token: "secret" },
        sql: "private query",
        credentials: "secret",
      }),
    );
    expect(result).toEqual({
      message: "Continue the existing draft",
      status: 409,
      existing_draft: draft,
    });
  });
  it("does not expose invalid or non-conflict draft references", () => {
    expect(
      applicationError(
        new ApiError("Conflict", 409, "", {
          existing_draft: { ...draft, run_id: "https://other.example/secret" },
        }),
      ),
    ).toEqual({ message: "Conflict", status: 409 });
    expect(
      applicationError(
        new ApiError("Forbidden", 403, "", { existing_draft: draft }),
      ),
    ).toEqual({ message: "Forbidden", status: 403 });
  });
  it("does not trust arbitrary Error properties as server error data", () => {
    const error = Object.assign(new Error("A local failure"), {
      status: 409,
      body: { existing_draft: draft },
      secret: "private",
    });
    expect(applicationError(error)).toEqual({ message: "A local failure" });
  });
});
