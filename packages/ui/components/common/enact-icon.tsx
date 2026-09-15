import { useId, useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import {
  ENACT_MARK_GRADIENT,
  ENACT_MARK_PATH,
  ENACT_MARK_VIEWBOX,
} from "./enact-mark-path";

interface EnactIconProps extends React.ComponentProps<"span"> {
  /**
   * If true, play a one-time entrance animation.
   */
  animate?: boolean;
  /**
   * If true, disable the hover animation.
   */
  noSpin?: boolean;
  /**
   * If true, show a border around the icon.
   */
  bordered?: boolean;
  /**
   * Size of the bordered icon: "sm" (default), "md", "lg"
   */
  size?: "sm" | "md" | "lg";
  /**
   * "mono" (default) inherits text colour; "color" paints the green gradient.
   */
  variant?: "mono" | "color";
}

const borderedSizes = {
  sm: { wrapper: "p-1.5", icon: "size-3.5" },
  md: { wrapper: "p-2", icon: "size-4" },
  lg: { wrapper: "p-2.5", icon: "size-5" },
};

/**
 * The Enact mark: a green ring cut twice on the diagonal, holding three
 * slanted bars that read as an E.
 *
 * The path is generated into ./enact-mark-path.ts from
 * design-system/enact/mark-source.svg by scripts/generate-brand-mark.mjs, so
 * the geometry here is never edited by hand.
 *
 * Two variants (design-system/enact/MASTER.md §10):
 *
 * - "mono": one flat `currentColor` fill, so the mark inherits text colour and
 *   stays correct in both themes and on any surface it is placed on.
 * - "color": one vertical gradient across the mark's full height, Deep Green
 *   at the top to Deloitte Green at the bottom. The stops are the
 *   `--mark-from` / `--mark-mid` / `--mark-to` tokens so this file stays free
 *   of raw literals; both themes define them identically, so the colour mark
 *   does not change with the theme.
 */

/** `useId` output carries separators that are awkward inside `url(#…)`. */
const toFragmentId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

function MonoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={ENACT_MARK_VIEWBOX}
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={ENACT_MARK_PATH} />
    </svg>
  );
}

function ColorMark({ className }: { className?: string }) {
  const gradientId = `enact-mark-${toFragmentId(useId())}`;

  return (
    <svg
      viewBox={ENACT_MARK_VIEWBOX}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={ENACT_MARK_GRADIENT.x1}
          y1={ENACT_MARK_GRADIENT.y1}
          x2={ENACT_MARK_GRADIENT.x2}
          y2={ENACT_MARK_GRADIENT.y2}
        >
          <stop offset="0" stopColor="var(--mark-from)" />
          <stop offset="0.5" stopColor="var(--mark-mid)" />
          <stop offset="1" stopColor="var(--mark-to)" />
        </linearGradient>
      </defs>
      <path d={ENACT_MARK_PATH} fill={`url(#${gradientId})`} />
    </svg>
  );
}

export function EnactIcon({
  className,
  animate = false,
  noSpin = false,
  bordered = false,
  size = "sm",
  variant = "mono",
  ...props
}: EnactIconProps) {
  const [entranceDone, setEntranceDone] = useState(!animate);

  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setEntranceDone(true), 450);
    return () => clearTimeout(timer);
  }, [animate]);

  const motion = cn(
    !entranceDone && "animate-entrance-rise",
    entranceDone && !noSpin && "enact-mark-lift"
  );

  const Mark = variant === "color" ? ColorMark : MonoMark;

  if (bordered) {
    const sizeConfig = borderedSizes[size];
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center border border-border rounded-md",
          sizeConfig.wrapper,
          className
        )}
        aria-hidden="true"
        {...props}
      >
        <span className={cn("block", sizeConfig.icon, motion)}>
          <Mark className="block size-full" />
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn("inline-block size-[1em]", motion, className)}
      aria-hidden="true"
      {...props}
    >
      <Mark className="block size-full" />
    </span>
  );
}
