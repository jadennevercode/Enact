import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { BindingEditor } from "./binding-editor";
vi.mock("../navigation", () => ({ useNavigation: () => ({ searchParams: new URLSearchParams() }) }));
vi.mock("@enact/core/hooks", () => ({ useWorkspaceId: () => "workspace" }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) => ({
    data: options.queryKey.includes("catalog") ? { entries: [] } : [{ id: "connection", name: "Quality", kind: "rest", enabled: true }],
  }),
  queryOptions: (options: unknown) => options,
}));
vi.mock("./shared", async () => ({
  ...(await vi.importActual<typeof import("./shared")>("./shared")),
  useSemanticText: () => (key: string) => key,
}));
describe("binding form editing", () => {
  it("preserves non-form authorization metadata and explicit empty bodies", () => {
    const binding = {
      id: "freeze",
      description: "Freeze stock",
      connection_id: "connection",
      path: "/stocks/{id}/freeze",
      method: "POST",
      required_parameters: ["id"],
      body_parameters: [],
      allowed_roles: ["member"],
      authorization: { mode: "confirm", roles: ["PlantManager"] },
      readback: { path: "/stocks/{id}", expected: { status: "frozen" } },
      custom_contract: { revision: 2 },
    };
    const onChange = vi.fn();
    render(
      <BindingEditor
        value={JSON.stringify({
          data_bindings: [],
          action_bindings: [binding],
        })}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Freeze stock" }));
    fireEvent.click(screen.getByRole("button", { name: "applyBinding" }));
    expect(onChange).toHaveBeenCalledOnce();
    const saved = JSON.parse(onChange.mock.calls[0]![0]).action_bindings[0];
    expect(saved).toEqual(binding);
  });
});
