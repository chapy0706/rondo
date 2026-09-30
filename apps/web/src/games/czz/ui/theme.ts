/**
 * czz の配色（本家 apps/user/app/globals.css の再現）。
 *
 * 通常モードは Kanagawa 風のダーク、初心者モードは黄から青へのパステル。色は czz の外枠の
 * 要素に CSS 変数として持たせ、中の部品は bg-[var(--czz-card)] のように参照する。
 * rondo の globals.css には何も足さない（czz の中だけで閉じる）。
 */

import type { CSSProperties } from "react";
import type { UiMode } from "../presentation";

type Vars = CSSProperties & Record<`--czz-${string}`, string>;

const ADVANCED: Vars = {
	"--czz-bg": "hsl(240 14.3% 11%)",
	"--czz-fg": "hsl(51.2 32.7% 79.6%)",
	"--czz-card": "hsl(240 12.7% 13.9%)",
	"--czz-primary": "hsl(220 53.6% 67.1%)",
	"--czz-primary-fg": "hsl(240 13.7% 10%)",
	"--czz-muted": "hsl(240 13.4% 19%)",
	"--czz-muted-fg": "hsl(257.4 15.3% 60.2%)",
	"--czz-accent": "hsl(204.8 39.2% 29%)",
	"--czz-accent-fg": "hsl(51.2 32.7% 79.6%)",
	"--czz-destructive": "hsl(0 81% 52.5%)",
	"--czz-border": "hsl(240 12.9% 24.3%)",
	"--czz-radius": "0.5rem",
	colorScheme: "dark",
	background: "hsl(240 14.3% 11%)",
};

const BEGINNER: Vars = {
	"--czz-bg": "hsl(48 100% 94%)",
	"--czz-fg": "hsl(230 20% 18%)",
	"--czz-card": "hsl(0 0% 100%)",
	"--czz-primary": "hsl(330 80% 62%)",
	"--czz-primary-fg": "hsl(0 0% 100%)",
	"--czz-muted": "hsl(48 100% 88%)",
	"--czz-muted-fg": "hsl(230 12% 32%)",
	"--czz-accent": "hsl(205 100% 86%)",
	"--czz-accent-fg": "hsl(230 20% 18%)",
	"--czz-destructive": "hsl(0 80% 60%)",
	"--czz-border": "hsl(230 18% 70%)",
	"--czz-radius": "1rem",
	colorScheme: "light",
	// 本家の body の背景（黄 → 青のグラデーションと、ふわっとした円）を czz の枠に敷く。
	background: [
		"radial-gradient(circle at 85% 20%, hsl(205 100% 88%) 0%, transparent 45%)",
		"radial-gradient(circle at 20% 15%, hsl(52 100% 90%) 0%, transparent 45%)",
		"radial-gradient(circle at 50% 92%, hsl(48 100% 90%) 0%, transparent 52%)",
		"linear-gradient(135deg, hsl(50 100% 92%) 0%, hsl(54 100% 95%) 35%, hsl(205 100% 92%) 100%)",
	].join(", "),
};

/** czz の外枠に当てる配色。 */
export function themeStyle(mode: UiMode): CSSProperties {
	return mode === "beginner" ? BEGINNER : ADVANCED;
}

/** よく使う組み合わせ（Tailwind が拾えるよう、クラス名は文字列のまま書く）。 */
export const T = {
	fg: "text-[var(--czz-fg)]",
	muted: "text-[var(--czz-muted-fg)]",
	card: "bg-[var(--czz-card)] text-[var(--czz-fg)]",
	mutedBg: "bg-[var(--czz-muted)]",
	border: "border border-[var(--czz-border)]",
	ring: "ring-1 ring-inset ring-[var(--czz-border)]",
	primary: "bg-[var(--czz-primary)] text-[var(--czz-primary-fg)]",
	accent: "bg-[var(--czz-accent)] text-[var(--czz-accent-fg)]",
	radius: "rounded-[var(--czz-radius)]",
} as const;
