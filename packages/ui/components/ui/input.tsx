import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@enact/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "enact-control enact-form-control h-8 w-full min-w-0 rounded-lg px-2.5 py-1 text-title-sm file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground md:text-body",
        className
      )}
      {...props}
    />
  )
}

export { Input }
