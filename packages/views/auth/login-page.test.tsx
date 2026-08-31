import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "@enact/core/i18n/react";
import enCommon from "../locales/en/common.json";
import enAuth from "../locales/en/auth.json";
import enSettings from "../locales/en/settings.json";

const TEST_RESOURCES = {
  en: { common: enCommon, auth: enAuth, settings: enSettings },
};

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

function renderWithI18n(ui: ReactElement) {
  return render(ui, { wrapper: I18nWrapper });
}

const mockLoginWithEmail = vi.hoisted(() => vi.fn());
const mockRegisterWithEmail = vi.hoisted(() => vi.fn());
const mockApiEmailLogin = vi.hoisted(() => vi.fn());
const mockApiRegister = vi.hoisted(() => vi.fn());
const mockApiListWorkspaces = vi.hoisted(() => vi.fn());
const mockApiSetToken = vi.hoisted(() => vi.fn());
const mockApiGetMe = vi.hoisted(() => vi.fn());
const mockApiIssueCliToken = vi.hoisted(() => vi.fn());
const mockSetQueryData = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ setQueryData: mockSetQueryData }),
  };
});

vi.mock("@enact/core/auth", () => ({
  useAuthStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = {
        loginWithEmail: mockLoginWithEmail,
        registerWithEmail: mockRegisterWithEmail,
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        loginWithEmail: mockLoginWithEmail,
        registerWithEmail: mockRegisterWithEmail,
      }),
    },
  ),
}));

vi.mock("@enact/core/api", () => ({
  api: {
    emailLogin: mockApiEmailLogin,
    register: mockApiRegister,
    listWorkspaces: mockApiListWorkspaces,
    setToken: mockApiSetToken,
    getMe: mockApiGetMe,
    issueCliToken: mockApiIssueCliToken,
  },
}));

vi.mock("@enact/core/types", () => ({}));

import { LoginPage, validateCliCallback } from "./login-page";

describe("LoginPage", () => {
  const onSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGetMe.mockRejectedValue(new Error("unauthorized"));
    mockApiListWorkspaces.mockResolvedValue([]);
    localStorage.clear();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "http://localhost:3000" },
    });
  });

  it("renders the email and password login form", () => {
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    expect(screen.getByText(/sign in to enact/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your email and password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveFocus();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
    expect(screen.queryByText(/verification code/i)).not.toBeInTheDocument();
  });

  it("logs in with the email, seeds workspaces, and completes", async () => {
    mockLoginWithEmail.mockResolvedValueOnce(undefined);
    mockApiListWorkspaces.mockResolvedValueOnce([{ id: "ws-1" }]);
    const user = userEvent.setup();
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockLoginWithEmail).toHaveBeenCalledWith("test@example.com", "secret123");
      expect(mockApiListWorkspaces).toHaveBeenCalledOnce();
      expect(mockSetQueryData).toHaveBeenCalledWith(
        expect.arrayContaining(["workspaces", "list"]),
        [{ id: "ws-1" }],
      );
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it("shows the direct login loading state", async () => {
    mockLoginWithEmail.mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });

  it("shows a login error", async () => {
    mockLoginWithEmail.mockRejectedValueOnce(new Error("Login unavailable"));
    const user = userEvent.setup();
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText("Login unavailable")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("registers a Deloitte China account with a username", async () => {
    mockRegisterWithEmail.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/username/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@deloittecn.com.cn");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(mockRegisterWithEmail).toHaveBeenCalledWith(
        "alice@deloittecn.com.cn",
        "secret123",
        "Alice",
      );
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it("rejects registration outside the Deloitte China email domain", async () => {
    const user = userEvent.setup();
    renderWithI18n(<LoginPage onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: /create an account/i }));
    await user.type(screen.getByLabelText(/username/i), "Alice");
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^create account$/i }));

    expect(
      await screen.findByText(/limited to @deloittecn\.com\.cn/i),
    ).toBeInTheDocument();
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });

  it("renders Google OAuth only when configured", () => {
    const { rerender } = renderWithI18n(<LoginPage onSuccess={onSuccess} />);
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();

    rerender(
      <I18nWrapper>
        <LoginPage
          onSuccess={onSuccess}
          google={{ clientId: "goog-123", redirectUri: "http://localhost/cb" }}
        />
      </I18nWrapper>,
    );
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("shows CLI confirmation for an existing local token", async () => {
    localStorage.setItem("enact_token", "existing-jwt");
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });

    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );

    expect(await screen.findByText(/authorize cli/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
  });

  it("authorizes CLI with the existing local token", async () => {
    localStorage.setItem("enact_token", "existing-jwt");
    mockApiGetMe
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "Test User",
      });
    const onTokenObtained = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^authorize$/i }));

    expect(onTokenObtained).toHaveBeenCalledOnce();
    expect(window.location.href).toContain(
      "http://localhost:9876/callback?token=existing-jwt&state=abc",
    );
  });

  it("authorizes CLI directly from an email login", async () => {
    mockApiEmailLogin.mockResolvedValueOnce({ token: "new-jwt-token" });
    const onTokenObtained = vi.fn();
    const user = userEvent.setup();

    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        onTokenObtained={onTokenObtained}
        cliCallback={{ url: "http://localhost:9876/callback", state: "xyz" }}
      />,
    );
    await user.type(screen.getByLabelText(/email/i), "cli@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockApiEmailLogin).toHaveBeenCalledWith("cli@example.com", "secret123");
      expect(onTokenObtained).toHaveBeenCalledOnce();
      expect(window.location.href).toContain(
        "http://localhost:9876/callback?token=new-jwt-token&state=xyz",
      );
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("authorizes CLI with a cookie session", async () => {
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });
    mockApiIssueCliToken.mockResolvedValueOnce({ token: "fresh-jwt" });
    const user = userEvent.setup();

    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^authorize$/i }));

    await waitFor(() => {
      expect(mockApiIssueCliToken).toHaveBeenCalledOnce();
      expect(window.location.href).toContain(
        "http://localhost:9876/callback?token=fresh-jwt&state=abc",
      );
    });
  });

  it("returns from CLI confirmation to the email form", async () => {
    mockApiGetMe.mockResolvedValueOnce({
      id: "u-1",
      email: "cookie@example.com",
      name: "Cookie User",
    });
    const user = userEvent.setup();

    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        cliCallback={{ url: "http://localhost:9876/callback", state: "abc" }}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: /use a different account/i }),
    );

    expect(screen.getByText(/sign in to enact/i)).toBeInTheDocument();
  });

  it("renders an optional logo", () => {
    renderWithI18n(
      <LoginPage
        onSuccess={onSuccess}
        logo={<div data-testid="custom-logo">Logo</div>}
      />,
    );
    expect(screen.getByTestId("custom-logo")).toBeInTheDocument();
  });
});

describe("validateCliCallback", () => {
  it("accepts local HTTP callback hosts", () => {
    expect(validateCliCallback("http://localhost:9876/callback")).toBe(true);
    expect(validateCliCallback("http://127.0.0.1:8080/cb")).toBe(true);
    expect(validateCliCallback("http://10.0.0.5:9876/callback")).toBe(true);
    expect(validateCliCallback("http://172.31.255.255:1234/cb")).toBe(true);
    expect(validateCliCallback("http://192.168.1.131:41117/callback")).toBe(true);
  });

  it("rejects non-local, HTTPS, and invalid callbacks", () => {
    expect(validateCliCallback("http://172.15.0.1:9876/callback")).toBe(false);
    expect(validateCliCallback("http://172.32.0.1:9876/callback")).toBe(false);
    expect(validateCliCallback("https://localhost:9876/callback")).toBe(false);
    expect(validateCliCallback("http://evil.com:9876/callback")).toBe(false);
    expect(validateCliCallback("not-a-url")).toBe(false);
  });
});
