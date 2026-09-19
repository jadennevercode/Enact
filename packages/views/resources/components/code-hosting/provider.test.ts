// @vitest-environment node

// Provider shape rules, which need no DOM. The component suite in
// ./code-hosting.test.tsx covers the wiring; this is the canonical place for
// the host-classification matrix.

import { describe, it, expect } from "vitest";
import type { VCSConnection } from "@enact/core/types";
import { PROVIDER_PROFILES, displayHost, isGitHubDotCom, providerOf } from "./provider";

function connection(overrides: Partial<VCSConnection>): VCSConnection {
  return {
    id: "c1",
    workspace_id: "w1",
    provider: "github",
    instance_url: "https://github.com",
    account_login: "acme",
    webhook_url: "",
    webhook_path: "",
    created_at: "",
    token_type: "fine_grained",
    token_scopes: [],
    token_expires_at: null,
    clone_host: "",
    has_custom_ca: false,
    last_validated_at: null,
    api_status: "ok",
    webhook_status: "pending",
    git_read_status: "unknown",
    git_write_status: "unknown",
    change_request_status: "unknown",
    ...overrides,
  };
}

describe("isGitHubDotCom", () => {
  it("recognizes the public instance in the forms an operator might paste", () => {
    for (const url of [
      "https://github.com",
      "https://github.com/",
      "https://www.github.com",
      "https://api.github.com",
    ]) {
      expect(isGitHubDotCom(url)).toBe(true);
    }
  });

  it("treats an enterprise host, and a lookalike, as not the public instance", () => {
    for (const url of [
      "https://ghe.corp.example",
      // A suffix match would classify this as github.com and then refuse to
      // show the instance URL field for it.
      "https://github.com.evil.example",
      "not a url",
      "",
    ]) {
      expect(isGitHubDotCom(url)).toBe(false);
    }
  });
});

describe("providerOf", () => {
  // A stored connection records only `github`; which form to open is recovered
  // from the host, because github.com must not offer an editable instance URL.
  it("separates github.com from an enterprise instance", () => {
    expect(providerOf(connection({ provider: "github", instance_url: "https://github.com" }))).toBe("github");
    expect(providerOf(connection({ provider: "github", instance_url: "https://ghe.corp.example" }))).toBe(
      "github_enterprise",
    );
  });

  it("maps everything else to the GitLab form", () => {
    expect(providerOf(connection({ provider: "gitlab", instance_url: "https://gitlab.corp.example" }))).toBe(
      "gitlab",
    );
  });
});

describe("PROVIDER_PROFILES", () => {
  // GitLab is the only provider that scopes api and write_repository onto
  // separate credentials; asking twice anywhere else would just invite pasting
  // the same value into both boxes.
  it("asks for a second token only where the provider actually splits them", () => {
    expect(PROVIDER_PROFILES.gitlab.needsSeparateGitToken).toBe(true);
    expect(PROVIDER_PROFILES.github.needsSeparateGitToken).toBe(false);
    expect(PROVIDER_PROFILES.github_enterprise.needsSeparateGitToken).toBe(false);
  });

  // github.com has one address, so the form must not ask for it; an enterprise
  // instance has no fixed address, so it must.
  it("fixes the instance URL only for the public GitHub", () => {
    expect(PROVIDER_PROFILES.github.fixedInstanceURL).toBe("https://github.com");
    expect(PROVIDER_PROFILES.github_enterprise.fixedInstanceURL).toBeUndefined();
    expect(PROVIDER_PROFILES.gitlab.fixedInstanceURL).toBeUndefined();
  });

  it("stores both GitHub variants under the one provider the API knows", () => {
    expect(PROVIDER_PROFILES.github.apiProvider).toBe("github");
    expect(PROVIDER_PROFILES.github_enterprise.apiProvider).toBe("github");
    expect(PROVIDER_PROFILES.gitlab.apiProvider).toBe("gitlab");
  });

  it("offers each provider its own token vocabulary", () => {
    expect(PROVIDER_PROFILES.github.tokenTypes).toContain("fine_grained");
    expect(PROVIDER_PROFILES.gitlab.tokenTypes).toContain("service_account");
    expect(PROVIDER_PROFILES.gitlab.tokenTypes).not.toContain("fine_grained");
  });
});

describe("displayHost", () => {
  it("shows the host without the scheme nobody typed", () => {
    expect(displayHost("https://ghe.corp.example")).toBe("ghe.corp.example");
    expect(displayHost("https://gitlab.corp.example:8443/")).toBe("gitlab.corp.example:8443");
  });

  it("falls back to the raw value rather than rendering nothing", () => {
    expect(displayHost("not a url")).toBe("not a url");
  });
});
