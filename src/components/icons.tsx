import type { ReactNode, SVGProps } from "react";

/**
 * 深渊矿工统一线性图标。
 *
 * 用法：
 * import { Icon } from "@/components/icons";
 * <Icon name="drill" size={20} color="#f0a23c" />
 */
export const ICONS = {
  drill: (
    <>
      <path d="m5 5 5 5" />
      <path d="m8 2 4 4-3 3-4-4z" />
      <path d="m10 10 7.5 7.5" />
      <path d="m15 15 4-4 3 3-4 4" />
      <path d="m18 18 3 3" />
    </>
  ),
  pack: (
    <>
      <path d="M8 6V4.5A2.5 2.5 0 0 1 10.5 2h3A2.5 2.5 0 0 1 16 4.5V6" />
      <path d="M6 6h12l2 4v10H4V10z" />
      <path d="M8 10v3h8v-3" />
      <path d="M4 15h4m8 0h4" />
    </>
  ),
  armor: (
    <>
      <path d="M12 2 20 5v6c0 5.2-3.4 8.8-8 11-4.6-2.2-8-5.8-8-11V5z" />
      <path d="M12 6v11" />
      <path d="m8 10 4 3 4-3" />
    </>
  ),
  detector: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="m12.5 12.5 7 7" />
      <path d="M16 5a5 5 0 0 1 3 3m-3-7a9 9 0 0 1 7 7" />
    </>
  ),
  charm: (
    <>
      <path d="M9 3h6l1 4-4 4-4-4z" />
      <path d="M12 11v3" />
      <circle cx="12" cy="18" r="4" />
      <path d="M10.5 18h3M12 16.5v3" />
    </>
  ),
  cautious: (
    <>
      <path d="M5 15h9l3-3h3v6H5z" />
      <path d="M8 15V9l3-3h4" />
      <path d="M5 18v3m12-3v3" />
      <path d="m14 6 2-2 2 2" />
    </>
  ),
  standard: (
    <>
      <path d="M4 17h10l5-5 2 2-5 5H4z" />
      <path d="m8 17 7-7" />
      <path d="M12 6h6m-3-3v6" />
    </>
  ),
  overload: (
    <>
      <path d="M7 4h10l3 6-3 10H7L4 10z" />
      <path d="m13 6-4 7h4l-2 5 5-8h-4z" />
    </>
  ),
  cash: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      <path d="M12 4.5v3M10.5 6h3" />
    </>
  ),
  ore: (
    <>
      <path d="m7 3 8-1 6 6-3 11-9 3-6-7z" />
      <path d="m7 3 5 6 9-1m-9 1-3 13m3-13 6 10M3 15l9-6" />
    </>
  ),
  durability: (
    <>
      <path d="M4 14h4l2-8h4l2 8h4" />
      <path d="M3 14h18v6H3z" />
      <path d="M8 17h8" />
    </>
  ),
  power: (
    <>
      <path d="M13 2 5 13h6l-1 9 9-13h-6z" />
    </>
  ),
  heat: (
    <>
      <path d="M12 3c2.5 3 1 4.5 3 6.5 1.6 1.6 3 3 3 5.5a6 6 0 0 1-12 0c0-2.7 1.5-4.5 3.5-6.5.2 2 1.2 3 2 3.5.7-2.7-.7-4.4.5-9z" />
    </>
  ),
  depth: (
    <>
      <path d="M12 3v16" />
      <path d="m7 14 5 5 5-5" />
      <path d="M4 5h16" />
      <path d="M6 9h3m6 0h3" />
    </>
  ),
  risk: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  retreat: (
    <>
      <path d="M10 5 3 12l7 7" />
      <path d="M3 12h12a6 6 0 0 1 6 6v1" />
    </>
  ),
  blackmarket: (
    <>
      <path d="M4 9h16l-2-5H6z" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
      <path d="M8 7h.01M12 7h.01M16 7h.01" />
    </>
  ),
  warehouse: (
    <>
      <path d="m3 9 9-6 9 6v12H3z" />
      <path d="M7 13h10v8H7z" />
      <path d="M7 17h10M10 13v8m4-8v8" />
    </>
  ),
  shop: (
    <>
      <path d="M4 10v10h16V10" />
      <path d="M3 10 5 4h14l2 6" />
      <path d="M3 10c0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0 0 2 3 2 3 0" />
      <path d="M9 20v-5h6v5" />
    </>
  ),
  leaderboard: (
    <>
      <path d="M8 4h8v4a4 4 0 0 1-8 0z" />
      <path d="M8 6H4v1a4 4 0 0 0 4 4m8-5h4v1a4 4 0 0 1-4 4" />
      <path d="M12 12v5m-4 4h8m-7-4h6v4H9z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      <circle cx="12" cy="12" r="8" />
    </>
  ),
  codex: (
    <>
      <path d="M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4z" />
      <path d="M20 4h-6v17a3 3 0 0 1 3-3h3z" />
      <path d="M7 8h4m-4 4h4m6-4h1m-1 4h1" />
    </>
  ),
  "route-rich": (
    <>
      <path d="M4 20c3-7 5-8 8-8s4-5 8-8" />
      <path d="m6 4 3-2 3 3-3 4-4-1z" />
      <path d="m15 14 3-2 3 3-3 4-4-1z" />
    </>
  ),
  "route-facility": (
    <>
      <path d="M3 20h18" />
      <path d="M5 20V9l5 3V8l5 3V5h4v15" />
      <path d="M8 16h2m4 0h2" />
    </>
  ),
  "route-safe": (
    <>
      <path d="M4 20c3-6 4-11 8-11s5 5 8 5" />
      <path d="M12 3v6" />
      <path d="m9 5 3-2 3 2" />
      <path d="M17 17h4m-2-2v4" />
    </>
  ),
  room: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M9 4v6h6v10" />
      <path d="M4 14h5" />
      <circle cx="17" cy="8" r="1" />
    </>
  ),
  module: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" />
    </>
  ),
  base: (
    <>
      <path d="M3 20h18" />
      <path d="M5 20V9l7-5 7 5v11" />
      <path d="M9 20v-6h6v6" />
      <path d="M8 10h8" />
    </>
  ),
  boss: (
    <>
      <path d="m7 5 2 3h6l2-3 3 4-2 10H6L4 9z" />
      <path d="M8 13h.01M16 13h.01" />
      <path d="m9 17 3-2 3 2" />
      <path d="m4 9-2-3m18 3 2-3" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4z" />
      <path d="M16 9a4 4 0 0 1 0 6m2.5-8.5a8 8 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 10v4h4l5 4V6l-5 4z" />
      <path d="m17 10 5 5m0-5-5 5" />
    </>
  ),
  close: (
    <>
      <path d="M5 5 19 19M19 5 5 19" />
    </>
  ),
  check: (
    <>
      <path d="m4 12 5 5L20 6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2.8 20h18.4z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  star: (
    <>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="M7 3v6m10 0v6M9 15v6" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "color"> {
  name: IconName;
  size?: number | string;
  color?: string;
}

/** 24×24 工业工具轮廓图标；无标签时默认对读屏隐藏。 */
export function Icon({
  name,
  size = 24,
  color = "#9aa5b1",
  style,
  "aria-label": ariaLabel,
  ...props
}: IconProps) {
  return (
    <svg
      {...props}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      focusable="false"
      height={size}
      role={ariaLabel ? "img" : undefined}
      viewBox="0 0 24 24"
      width={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      style={{ color, flex: "none", ...style }}
    >
      {ICONS[name]}
    </svg>
  );
}
