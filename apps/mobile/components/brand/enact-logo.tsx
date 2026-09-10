/**
 * Enact mark — a green ring cut twice on the diagonal, holding three slanted
 * bars that read as an E.
 *
 * The path is generated into ./enact-mark-path.ts from
 * design-system/enact/mark-source.svg by scripts/generate-brand-mark.mjs, the
 * same way packages/ui/components/common/enact-icon.tsx gets its copy. Mobile
 * cannot import @enact/ui, so it keeps its own generated file; the generator
 * writes both and apps/web/app/brand-mark-sync.test.ts holds them identical.
 *
 * Two variants (design-system/enact/MASTER.md §10):
 *
 * - "mono" (default): one flat colour. react-native-svg does not resolve CSS
 *   `currentColor`, so callers must pass `color` explicitly. For theme-aware
 *   usage, pair with `useColorScheme` + `THEME` token from `@/lib/theme`.
 * - "color": one vertical gradient across the mark's full height, Deep Green
 *   at the top to Deloitte Green at the bottom. Identical in both themes — the
 *   colour mark never follows the theme, so `color` is ignored.
 */
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import {
  ENACT_MARK_GRADIENT,
  ENACT_MARK_PATH,
  ENACT_MARK_STOPS,
  ENACT_MARK_VIEWBOX,
} from "./enact-mark-path";

interface EnactLogoProps {
  size?: number;
  color?: string;
  variant?: "mono" | "color";
}

const GRADIENT_ID = "enactMark";

/**
 * react-native-svg resolves `<Defs>` and gradient ids per `<Svg>` root, and it
 * does not flatten fragments reliably, so the colour variant is built as a flat
 * array of children rather than as a nested component.
 */
const colorChildren = () => [
  <Defs key="defs">
    <LinearGradient
      id={GRADIENT_ID}
      gradientUnits="userSpaceOnUse"
      x1={ENACT_MARK_GRADIENT.x1}
      y1={ENACT_MARK_GRADIENT.y1}
      x2={ENACT_MARK_GRADIENT.x2}
      y2={ENACT_MARK_GRADIENT.y2}
    >
      <Stop offset="0" stopColor={ENACT_MARK_STOPS.from} />
      <Stop offset="0.5" stopColor={ENACT_MARK_STOPS.mid} />
      <Stop offset="1" stopColor={ENACT_MARK_STOPS.to} />
    </LinearGradient>
  </Defs>,
  <Path key="mark" d={ENACT_MARK_PATH} fill={`url(#${GRADIENT_ID})`} />,
];

export function EnactLogo({ size = 48, color, variant = "mono" }: EnactLogoProps) {
  const { isDarkColorScheme } = useColorScheme();
  const resolvedColor =
    color ?? (isDarkColorScheme ? THEME.dark.foreground : THEME.light.foreground);

  return (
    <Svg width={size} height={size} viewBox={ENACT_MARK_VIEWBOX}>
      {variant === "color" ? (
        colorChildren()
      ) : (
        <Path d={ENACT_MARK_PATH} fill={resolvedColor} />
      )}
    </Svg>
  );
}
