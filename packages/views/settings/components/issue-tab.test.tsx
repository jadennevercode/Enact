import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DEFAULT_MANUAL_CREATE_FIELDS,
  DEFAULT_QUICK_CREATE_FIELDS,
  useIssueCreateSettingsStore,
} from "@enact/core/issues/stores/issue-create-settings-store";
import { renderWithI18n } from "../../test/i18n";
import { IssueTab } from "./issue-tab";

function resetStore() {
  useIssueCreateSettingsStore.setState({
    quickCreateFields: DEFAULT_QUICK_CREATE_FIELDS,
    manualCreateFields: DEFAULT_MANUAL_CREATE_FIELDS,
  });
}

describe("IssueTab", () => {
  beforeEach(resetStore);

  afterEach(() => {
    cleanup();
    resetStore();
  });

  it("renders a switch per field with the persisted selection", () => {
    renderWithI18n(<IssueTab />);

    // 2 quick create fields + 6 manual create fields.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(8);

    // Quick create defaults to priority only.
    const [quickPriority, quickDueDate] = switches;
    expect(quickPriority).toBeChecked();
    expect(quickDueDate).not.toBeChecked();

    // Manual create defaults to the classic toolbar; dates start hidden.
    const manual = switches.slice(2);
    for (const s of manual.slice(0, 4)) expect(s).toBeChecked();
    expect(manual[4]).not.toBeChecked();
    expect(manual[5]).not.toBeChecked();
  });

  it("persists enabling a quick create field", async () => {
    const user = userEvent.setup();
    renderWithI18n(<IssueTab />);

    const [, quickDueDate] = screen.getAllByRole("switch");
    await user.click(quickDueDate!);

    expect(useIssueCreateSettingsStore.getState().quickCreateFields).toEqual([
      "priority",
      "due_date",
    ]);
  });

  it("persists hiding a manual create field without touching quick create", async () => {
    const user = userEvent.setup();
    renderWithI18n(<IssueTab />);

    // Manual section starts at index 2; labels is its 4th row (index 5 overall).
    const manualLabels = screen.getAllByRole("switch")[5];
    await user.click(manualLabels!);

    expect(useIssueCreateSettingsStore.getState().manualCreateFields).toEqual([
      "status",
      "priority",
      "assignee",
    ]);
    expect(useIssueCreateSettingsStore.getState().quickCreateFields).toEqual(["priority"]);
  });
});
