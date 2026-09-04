"use client";

import { Check } from "lucide-react";
import {
  PROJECT_STATUS_ORDER,
  PROJECT_PRIORITY_ORDER,
} from "@enact/core/projects/config";
import { cn } from "@enact/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@enact/ui/components/ui/dropdown-menu";
import type { Project, ProjectStatus, ProjectPriority, UpdateProjectRequest } from "@enact/core/types";
import { PriorityIcon } from "../../issues/components/priority-icon";
import { useProjectStatusLabels, useProjectPriorityLabels } from "./labels";

export function ProjectStatusBadge({ project, handleUpdate, triggerClassName, align = "end" }: { project: Project; handleUpdate: (data: UpdateProjectRequest) => void; triggerClassName?: string; align?: "start" | "end" | "center" }) {
  const statusLabels = useProjectStatusLabels();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" data-status={project.status} className={cn(
            "enact-project-status-badge inline-flex cursor-pointer items-center gap-1 px-1.5 py-0.5",
            triggerClassName
          )}>
            {statusLabels[project.status]}
          </button>
        }
      />
      <DropdownMenuContent align={align} className="w-44">
        {PROJECT_STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onClick={() => handleUpdate({ status: s as ProjectStatus })}>
            <span className="enact-project-status-dot size-2" data-status={s} />
            <span>{statusLabels[s]}</span>
            {s === project.status && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectPriorityBadge({ project, handleUpdate, triggerClassName, align = "end" }: { project: Project; handleUpdate: (data: UpdateProjectRequest) => void; triggerClassName?: string; align?: "start" | "end" | "center" }) {
  const priorityLabels = useProjectPriorityLabels();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" data-priority={project.priority} className={cn(
            "enact-project-priority-badge inline-flex cursor-pointer items-center gap-1 px-1.5 py-0.5",
            triggerClassName
          )}>
            <PriorityIcon priority={project.priority} />
            <span className="text-caption">{priorityLabels[project.priority]}</span>
          </button>
        }
      />
      <DropdownMenuContent align={align} className="w-44">
        {PROJECT_PRIORITY_ORDER.map((p) => (
          <DropdownMenuItem key={p} onClick={() => handleUpdate({ priority: p as ProjectPriority })}>
            <PriorityIcon priority={p} />
            <span>{priorityLabels[p]}</span>
            {p === project.priority && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
