import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RulesEntryRoot } from "../platform/lobby/RulesEntryRoot";
import { SoundRoot } from "../platform/sound/SoundRoot";
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
	// 画面の端（ノッチ・ホームインジケータの下）まで描き、ゲーム画面の操作部品と表示は、セーフエリアの
	// 内側に置く（globals.css の .game-frame）。拡大の禁止はしない。
	viewportFit: "cover",
	// globals.css の --color-ink と揃える
	themeColor: "#13111f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="ja">
			<body>
				{children}
				{/* 音の入口（issue-63）。ページをまたいで BGM を続けるため、ここに 1 つ。 */}
				<SoundRoot />
				{/* 新しい規則の選択肢の入口（?rules=1 / ADR 0053）。どのページで開いても、端末に覚える。 */}
				<RulesEntryRoot />
			</body>
		</html>
	);
}
