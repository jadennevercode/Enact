/**
 * Enact mark — three cubes stacked in isometric projection. 1:1 vector copy of
 * packages/ui/components/common/enact-icon.tsx and docs/assets/logo-light.svg.
 * Keep all three in sync.
 *
 * react-native-svg does not resolve CSS `currentColor`, so callers must pass
 * `color` explicitly. For theme-aware usage, pair with `useColorScheme` +
 * `THEME` token from `@/lib/theme`.
 */
import Svg, { Path } from "react-native-svg";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

interface EnactLogoProps {
  size?: number;
  color?: string;
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

export function EnactLogo({ size = 48, color }: EnactLogoProps) {
  const { isDarkColorScheme } = useColorScheme();
  const resolvedColor =
    color ?? (isDarkColorScheme ? THEME.dark.foreground : THEME.light.foreground);

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {FACES.map(([d, opacity]) => (
        <Path key={d} d={d} fill={resolvedColor} fillOpacity={opacity} />
      ))}
    </Svg>
  );
}
