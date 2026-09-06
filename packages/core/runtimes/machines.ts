import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Machines are owned by the user, not by a workspace, so these keys carry no
 * workspace id. That is the point: the same host must not be cached — or
 * displayed — once per workspace.
 */
export const machineKeys = {
  all: () => ["machines"] as const,
  list: () => ["machines", "list"] as const,
  detail: (machineId: string) => ["machines", "detail", machineId] as const,
};

export function machineListOptions() {
  return queryOptions({
    queryKey: machineKeys.list(),
    queryFn: () => api.listMachines(),
  });
}

export function machineDetailOptions(machineId: string) {
  return queryOptions({
    queryKey: machineKeys.detail(machineId),
    queryFn: () => api.getMachine(machineId),
    enabled: Boolean(machineId),
  });
}
