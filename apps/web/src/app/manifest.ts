import type { MetadataRoute } from "next";
import { PWA_ICON_SIZES, RONDO_ICON_COLORS } from "../platform/brand/rondoIcon";

/**
 * Web App Manifest（issue-69）。スマホのホーム画面に追加したとき、rondo のアイコンと名前が出る。
 * 表示は "browser"（アドレスバーのある、ふつうのブラウザの画面のまま。"standalone" にしない）。
 */
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "rondo",
		short_name: "rondo",
		description:
			"スマホで遊ぶ、複数のゲームをプラグインとして差し込めるブラウザゲームプラットフォーム",
		start_url: "/",
		display: "browser",
		background_color: RONDO_ICON_COLORS.background,
		theme_color: RONDO_ICON_COLORS.background,
		icons: [
			...PWA_ICON_SIZES.map((size) => ({
				src: `/pwa-icon/${size}`,
				sizes: `${size}x${size}`,
				type: "image/png",
			})),
			{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
		],
	};
}
