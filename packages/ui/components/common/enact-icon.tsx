import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";

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
}

const borderedSizes = {
  sm: { wrapper: "p-1.5", icon: "size-3.5" },
  md: { wrapper: "p-2", icon: "size-4" },
  lg: { wrapper: "p-2.5", icon: "size-5" },
};

/**
 * The Enact mark: three cubes stacked in isometric projection.
 *
 * Geometry — each cube is a hexagon split into three faces. With half-width
 * w = 5.5 and side height s = 5.5, the top cube's lower silhouette (the V from
 * 6.5,10.625 through 12,13.375 to 17.5,10.625) is exactly the upper edge of the
 * two lower cubes' top faces, so the three tessellate with no overlap and draw
 * order does not matter.
 *
 * Depth comes from opacity on a single `currentColor` fill rather than from a
 * palette, so the mark inherits text color and stays correct in both themes and
 * on any surface it is placed on.
 */
const FACES = [
  // Top cube — top, left, right
  { d: "M12 2.375 L17.5 5.125 L12 7.875 L6.5 5.125 Z", o: 1 },
  { d: "M6.5 5.125 L12 7.875 L12 13.375 L6.5 10.625 Z", o: 0.62 },
  { d: "M12 7.875 L17.5 5.125 L17.5 10.625 L12 13.375 Z", o: 0.38 },
  // Lower-left cube
  { d: "M6.5 10.625 L12 13.375 L6.5 16.125 L1 13.375 Z", o: 1 },
  { d: "M1 13.375 L6.5 16.125 L6.5 21.625 L1 18.875 Z", o: 0.62 },
  { d: "M6.5 16.125 L12 13.375 L12 18.875 L6.5 21.625 Z", o: 0.38 },
  // Lower-right cube
  { d: "M17.5 10.625 L23 13.375 L17.5 16.125 L12 13.375 Z", o: 1 },
  { d: "M12 13.375 L17.5 16.125 L17.5 21.625 L12 18.875 Z", o: 0.62 },
  { d: "M17.5 16.125 L23 13.375 L23 18.875 L17.5 21.625 Z", o: 0.38 },
];

function MarkSvg({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {FACES.map((face) => (
        <path key={face.d} d={face.d} fillOpacity={face.o} />
      ))}
    </svg>
  );
}

export function EnactIcon({
  className,
  animate = false,
  noSpin = false,
  bordered = false,
  size = "sm",
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
          <MarkSvg className="block size-full" />
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
      <MarkSvg className="block size-full" />
    </span>
  );
}
