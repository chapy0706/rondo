import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "rondo",
	description:
		"スマホで遊ぶ、複数のゲームをプラグインとして差し込めるブラウザゲームプラットフォーム",
};

// スマホ縦画面・タッチ操作を基本ターゲットとする（ADR 0012）
export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="ja">
			<body>{children}</body>
		</html>
	);
}
