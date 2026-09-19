// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isRegistrationEmail, REGISTRATION_EMAIL_DOMAINS } from "./registration";

describe("isRegistrationEmail", () => {
  it("accepts every registration domain", () => {
    expect(REGISTRATION_EMAIL_DOMAINS).toEqual(["deloittecn.com.cn", "deloitte.com.hk"]);
    expect(isRegistrationEmail("alice@deloittecn.com.cn")).toBe(true);
    expect(isRegistrationEmail("alice@deloitte.com.hk")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isRegistrationEmail("  Alice@Deloitte.COM.HK ")).toBe(true);
  });

  it("rejects other domains, including look-alike suffixes", () => {
    expect(isRegistrationEmail("alice@example.com")).toBe(false);
    expect(isRegistrationEmail("alice@notdeloitte.com.hk")).toBe(false);
    expect(isRegistrationEmail("alice@deloitte.com.hk.evil.com")).toBe(false);
    expect(isRegistrationEmail("@deloitte.com.hk")).toBe(false);
    expect(isRegistrationEmail("")).toBe(false);
  });
});
