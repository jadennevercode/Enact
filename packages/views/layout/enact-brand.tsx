import { EnactIcon } from "@enact/ui/components/common/enact-icon";
import { cn } from "@enact/ui/lib/utils";

interface EnactBrandProps {
  className?: string;
}

/**
 * Product identity for the top-left of the app shell.
 *
 * Deliberately a label rather than a link or button: the row directly beneath
 * it is the workspace switcher, and two adjacent interactive rows in the same
 * corner read as one control with a broken hit target. The switcher keeps the
 * interaction; this row only says whose product you are in.
 *
 * This is the one brand position inside the shell, so it takes the colour mark
 * (design-system/enact/MASTER.md §10). Every other mark in the sidebar and in
 * running text stays monochrome and follows the text colour.
 */
export function EnactBrand({ className }: EnactBrandProps) {
  return (
    <div className={cn("flex items-center gap-2 px-2 pt-0.5 pb-1.5", className)}>
      <EnactIcon className="size-4 shrink-0" variant="color" noSpin />
      {/* eslint-disable-next-line i18next/no-literal-string -- the product name
          is a brand and is never translated; see the conventions page. */}
      <span className="text-body font-semibold tracking-tight text-sidebar-foreground">
        Enact
      </span>
    </div>
  );
}
