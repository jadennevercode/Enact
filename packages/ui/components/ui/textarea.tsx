import * as React from "react"

import { cn } from "@enact/ui/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "enact-control enact-form-control flex field-sizing-content min-h-16 w-full rounded-lg px-2.5 py-2 text-title-sm md:text-body",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
