import { useId, useState, useEffect } from "react";
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
  /**
   * "mono" (default) inherits text colour; "color" paints the three-step green.
   */
  variant?: "mono" | "color";
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
 * Two variants (design-system/enact/MASTER.md §10):
 *
 * - "mono": depth comes from opacity on a single `currentColor` fill rather
 *   than from a palette, so the mark inherits text colour and stays correct in
 *   both themes and on any surface it is placed on.
 * - "color": the three-step green ladder. Each cube carries its own gradient,
 *   oriented top-left to bottom-right across that cube's own bounding box, and
 *   the left and right faces are darkened by a `--mark-shade` overlay painted
 *   on top of the same gradient. The stop colours are tokens so this file stays
 *   free of raw literals; both themes define them identically, so the colour
 *   mark does not change with the theme.
 */
type Face = {
  /** Path data for the face. */
  d: string;
  /** Mono fill-opacity. */
  o: number;
  /** Colour-variant black overlay opacity; 0 means the face is unshaded. */
  shade: number;
};

type Cube = {
  /** Gradient bounding box: top-left to bottom-right of this cube. */
  box: { x1: number; y1: number; x2: number; y2: number };
  /** Token names for the gradient's start and end stops. */
  stops: readonly [string, string];
  /** Top, left, right. */
  faces: readonly Face[];
};

const CUBES: readonly Cube[] = [
  {
    box: { x1: 6.5, y1: 2.375, x2: 17.5, y2: 13.375 },
    stops: ["--mark-top-from", "--mark-top-to"],
    faces: [
      { d: "M12 2.375 L17.5 5.125 L12 7.875 L6.5 5.125 Z", o: 1, shade: 0 },
      {
        d: "M6.5 5.125 L12 7.875 L12 13.375 L6.5 10.625 Z",
        o: 0.62,
        shade: 0.18,
      },
      {
        d: "M12 7.875 L17.5 5.125 L17.5 10.625 L12 13.375 Z",
        o: 0.38,
        shade: 0.36,
      },
    ],
  },
  {
    box: { x1: 1, y1: 10.625, x2: 12, y2: 21.625 },
    stops: ["--mark-left-from", "--mark-left-to"],
    faces: [
      {
        d: "M6.5 10.625 L12 13.375 L6.5 16.125 L1 13.375 Z",
        o: 1,
        shade: 0,
      },
      {
        d: "M1 13.375 L6.5 16.125 L6.5 21.625 L1 18.875 Z",
        o: 0.62,
        shade: 0.18,
      },
      {
        d: "M6.5 16.125 L12 13.375 L12 18.875 L6.5 21.625 Z",
        o: 0.38,
        shade: 0.36,
      },
    ],
  },
  {
    box: { x1: 12, y1: 10.625, x2: 23, y2: 21.625 },
    stops: ["--mark-right-from", "--mark-right-to"],
    faces: [
      {
        d: "M17.5 10.625 L23 13.375 L17.5 16.125 L12 13.375 Z",
        o: 1,
        shade: 0,
      },
      {
        d: "M12 13.375 L17.5 16.125 L17.5 21.625 L12 18.875 Z",
        o: 0.62,
        shade: 0.18,
      },
      {
        d: "M17.5 16.125 L23 13.375 L23 18.875 L17.5 21.625 Z",
        o: 0.38,
        shade: 0.36,
      },
    ],
  },
];

/** `useId` output carries separators that are awkward inside `url(#…)`. */
const toFragmentId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, "");

function MonoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {CUBES.flatMap((cube) => cube.faces).map((face) => (
        <path key={face.d} d={face.d} fillOpacity={face.o} />
      ))}
    </svg>
  );
}

function ColorMark({ className }: { className?: string }) {
  const prefix = `enact-mark-${toFragmentId(useId())}`;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {CUBES.map((cube, index) => (
          <linearGradient
            key={cube.stops[0]}
            id={`${prefix}-${index}`}
            gradientUnits="userSpaceOnUse"
            x1={cube.box.x1}
            y1={cube.box.y1}
            x2={cube.box.x2}
            y2={cube.box.y2}
          >
            <stop offset="0" stopColor={`var(${cube.stops[0]})`} />
            <stop offset="1" stopColor={`var(${cube.stops[1]})`} />
          </linearGradient>
        ))}
      </defs>
      {CUBES.map((cube, index) =>
        cube.faces.map((face) => (
          <path
            key={face.d}
            d={face.d}
            fill={`url(#${prefix}-${index})`}
          />
        )),
      )}
      {CUBES.flatMap((cube) => cube.faces)
        .filter((face) => face.shade > 0)
        .map((face) => (
          <path
            key={face.d}
            d={face.d}
            fill="var(--mark-shade)"
            fillOpacity={face.shade}
          />
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
