/**
 * Enact mark — three cubes stacked in isometric projection. 1:1 vector copy of
 * packages/ui/components/common/enact-icon.tsx and docs/assets/logo-light.svg.
 * Keep all three in sync.
 *
 * Two variants (design-system/enact/MASTER.md §10):
 *
 * - "mono" (default): one colour, depth from fill-opacity 1 / 0.62 / 0.38.
 *   react-native-svg does not resolve CSS `currentColor`, so callers must pass
 *   `color` explicitly. For theme-aware usage, pair with `useColorScheme` +
 *   `THEME` token from `@/lib/theme`.
 * - "color": the three-step green ladder. One gradient per cube, oriented
 *   top-left to bottom-right across that cube's own bounding box, with the left
 *   and right faces darkened 18% and 36% by a black overlay. Identical in both
 *   themes — the colour mark never follows the theme, so `color` is ignored.
 */
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

interface EnactLogoProps {
  size?: number;
  color?: string;
  variant?: "mono" | "color";
}

const FACES: [string, number][] = [
  ["M12 2.375 L17.5 5.125 L12 7.875 L6.5 5.125 Z", 1],
  ["M6.5 5.125 L12 7.875 L12 13.375 L6.5 10.625 Z", 0.62],
  ["M12 7.875 L17.5 5.125 L17.5 10.625 L12 13.375 Z", 0.38],
  ["M6.5 10.625 L12 13.375 L6.5 16.125 L1 13.375 Z", 1],
  ["M1 13.375 L6.5 16.125 L6.5 21.625 L1 18.875 Z", 0.62],
  ["M6.5 16.125 L12 13.375 L12 18.875 L6.5 21.625 Z", 0.38],
  ["M17.5 10.625 L23 13.375 L17.5 16.125 L12 13.375 Z", 1],
  ["M12 13.375 L17.5 16.125 L17.5 21.625 L12 18.875 Z", 0.62],
  ["M17.5 16.125 L23 13.375 L23 18.875 L17.5 21.625 Z", 0.38],
];

/**
 * Mobile cannot import from `@enact/ui`, so the six gradient stops are copied
 * here. They are kept in sync with the `--mark-*` tokens in
 * packages/ui/styles/tokens.css — change both together.
 */
const MARK_SHADE = "#000000";

interface Cube {
  /** Gradient id, and the `<defs>` entry it points at. */
  id: string;
  /** Stop colours, start then end. */
  from: string;
  to: string;
  /** Gradient bounding box: top-left to bottom-right of this cube. */
  box: [number, number, number, number];
  /** Top, left, right — path data plus the black-overlay opacity. */
  faces: [string, number][];
}

const CUBES: Cube[] = [
  {
    id: "enactMarkTop",
    from: "#c4d600",
    to: "#86bc25",
    box: [6.5, 2.375, 17.5, 13.375],
    faces: [
      ["M12 2.375 L17.5 5.125 L12 7.875 L6.5 5.125 Z", 0],
      ["M6.5 5.125 L12 7.875 L12 13.375 L6.5 10.625 Z", 0.18],
      ["M12 7.875 L17.5 5.125 L17.5 10.625 L12 13.375 Z", 0.36],
    ],
  },
  {
    id: "enactMarkLeft",
    from: "#86bc25",
    to: "#26890d",
    box: [1, 10.625, 12, 21.625],
    faces: [
      ["M6.5 10.625 L12 13.375 L6.5 16.125 L1 13.375 Z", 0],
      ["M1 13.375 L6.5 16.125 L6.5 21.625 L1 18.875 Z", 0.18],
      ["M6.5 16.125 L12 13.375 L12 18.875 L6.5 21.625 Z", 0.36],
    ],
  },
  {
    id: "enactMarkRight",
    from: "#26890d",
    to: "#046a38",
    box: [12, 10.625, 23, 21.625],
    faces: [
      ["M17.5 10.625 L23 13.375 L17.5 16.125 L12 13.375 Z", 0],
      ["M12 13.375 L17.5 16.125 L17.5 21.625 L12 18.875 Z", 0.18],
      ["M17.5 16.125 L23 13.375 L23 18.875 L17.5 21.625 Z", 0.36],
    ],
  },
];

/**
 * react-native-svg resolves `<Defs>` and gradient ids per `<Svg>` root, and it
 * does not flatten fragments reliably, so the colour variant is built as a flat
 * array of children rather than as a nested component.
 */
const colorChildren = () => [
  <Defs key="defs">
    {CUBES.map((cube) => (
      <LinearGradient
        key={cube.id}
        id={cube.id}
        gradientUnits="userSpaceOnUse"
        x1={cube.box[0]}
        y1={cube.box[1]}
        x2={cube.box[2]}
        y2={cube.box[3]}
      >
        <Stop offset="0" stopColor={cube.from} />
        <Stop offset="1" stopColor={cube.to} />
      </LinearGradient>
    ))}
  </Defs>,
  ...CUBES.flatMap((cube) =>
    cube.faces.map(([d]) => <Path key={d} d={d} fill={`url(#${cube.id})`} />),
  ),
  ...CUBES.flatMap((cube) => cube.faces)
    .filter(([, shade]) => shade > 0)
    .map(([d, shade]) => (
      <Path key={`shade-${d}`} d={d} fill={MARK_SHADE} fillOpacity={shade} />
    )),
];

export function EnactLogo({ size = 48, color, variant = "mono" }: EnactLogoProps) {
  const { isDarkColorScheme } = useColorScheme();
  const resolvedColor =
    color ?? (isDarkColorScheme ? THEME.dark.foreground : THEME.light.foreground);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {variant === "color"
        ? colorChildren()
        : FACES.map(([d, opacity]) => (
            <Path key={d} d={d} fill={resolvedColor} fillOpacity={opacity} />
          ))}
    </Svg>
  );
}
