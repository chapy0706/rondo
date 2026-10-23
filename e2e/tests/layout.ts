/**
 * iPhone の縦画面で、ゲーム画面がスクロールなしで収まるかを測る（layout-fit.e2e.ts）。
 *
 * 測るもの（画面ごと）:
 * - 縦: document.documentElement.scrollHeight と window.innerHeight の差（0 以下なら、縦のスクロールなし）
 * - 横: document.documentElement.scrollWidth と window.innerWidth の差（0 以下なら、横のはみ出しなし）
 * - 表示領域の外にはみ出した部品（data-testid で探す。出ていない部品は数えない）
 * - 部品どうしの重なり（片方が、もう片方の中にある組は除く。3D の画面は、上に重ねる前提なので除く）
 */

import { type Page, type TestInfo, expect } from "@playwright/test";

/** 見える領域（幅 × 高さ。CSS の px = iOS の pt）。 */
export interface LayoutSize {
	readonly name: string;
	readonly width: number;
	readonly height: number;
}

/**
 * 測る大きさ。ツールバーが出ている、実際に見える高さ（端末の高さの約 8 割）と、ツールバーが
 * 引っ込んだ高さ（iPhone 16 Pro の全高）。
 */
export const LAYOUT_SIZES: readonly LayoutSize[] = [
	{ name: "SE", width: 375, height: 553 },
	{ name: "12-14", width: 390, height: 675 },
	{ name: "15-16", width: 393, height: 682 },
	{ name: "Plus-ProMax", width: 430, height: 745 },
	{ name: "16Pro-全高", width: 402, height: 874 },
];

/** 測る部品（data-testid と、表に出す名前）。 */
const PARTS: readonly { readonly id: string; readonly label: string }[] = [
	{ id: "veryare-move-pad", label: "移動パッド" },
	{ id: "veryare-look-pad", label: "視点パッド" },
	{ id: "veryare-shoot", label: "撃つ" },
	{ id: "veryare-open-door", label: "襖を開ける" },
	{ id: "veryare-waiting-pose", label: "ポーズ（待機）" },
	{ id: "veryare-game-pose", label: "ポーズ" },
	// ペイントの板と答え合わせの切り替えは、左下のシート（中だけスクロールする）。シートを測る。
	{ id: "veryare-sheet", label: "シート（ペイント・答え合わせ）" },
	{ id: "veryare-paint-done", label: "塗り終わり" },
	{ id: "veryare-status", label: "時間の表示" },
	{ id: "veryare-area", label: "エリアの円の表示" },
	{ id: "veryare-view", label: "3D の画面" },
	{ id: "result-screen", label: "結果の一覧" },
	// 観戦の画面（issue-67 / spectate.e2e.ts）。
	{ id: "play-bar", label: "上部バー" },
	{ id: "spectate-status", label: "観戦の状態の行" },
	{ id: "spectate-canvas", label: "観戦の 3D の画面" },
	{ id: "spectate-follow-list", label: "追う相手の選択" },
	// ひとり用のゲーム（layout-fit.e2e.ts の「ひとり用」）。
	{ id: "launch-start", label: "はじめる" },
	{ id: "tetris-stats", label: "テ〇〇スの得点の行" },
	{ id: "tetris-board", label: "テ〇〇スの盤" },
	{ id: "tetris-pad", label: "テ〇〇スのパッド" },
	{ id: "nikaku-board", label: "二角消去の盤" },
	{ id: "nikaku-actions", label: "二角消去のボタン" },
	{ id: "minichess-board", label: "チェスの盤" },
	{ id: "minichess-actions", label: "チェスのボタン" },
];

/** 重なりを数えない部品（ほかの部品を、上に重ねる下地）。 */
const BACKDROPS = ["veryare-view"];

export interface LayoutMeasure {
	readonly innerWidth: number;
	readonly innerHeight: number;
	/** scrollHeight - innerHeight（正なら、縦にスクロールする）。 */
	readonly overflowY: number;
	/** scrollWidth - innerWidth（正なら、横にはみ出す）。 */
	readonly overflowX: number;
	/** 表示領域の外にはみ出した部品（名前と、はみ出した向き・量）。 */
	readonly outside: readonly string[];
	/** 重なった部品の組。 */
	readonly overlaps: readonly string[];
	/** 出ていた部品。 */
	readonly shown: readonly string[];
}

/** いまの画面を測る（ページの先頭にスクロールしてから）。 */
export async function measureLayout(page: Page): Promise<LayoutMeasure> {
	return page.evaluate(
		({ parts, backdrops }) => {
			window.scrollTo(0, 0);
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const root = document.documentElement;
			const found = parts.flatMap((part) => {
				const el = document.querySelector(`[data-testid="${part.id}"]`);
				if (el === null) return [];
				const r = el.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) return [];
				return [{ ...part, el, r }];
			});
			const round = (n: number) => Math.round(n);
			const outside = found.flatMap(({ label, r }) => {
				const sides = [
					r.top < -0.5 ? `上 ${round(-r.top)}` : null,
					r.bottom > vh + 0.5 ? `下 ${round(r.bottom - vh)}` : null,
					r.left < -0.5 ? `左 ${round(-r.left)}` : null,
					r.right > vw + 0.5 ? `右 ${round(r.right - vw)}` : null,
				].filter((s) => s !== null);
				return sides.length === 0 ? [] : [`${label}（${sides.join("・")}）`];
			});
			const overlaps: string[] = [];
			const fronts = found.filter((f) => !backdrops.includes(f.id));
			for (let i = 0; i < fronts.length; i++) {
				for (let j = i + 1; j < fronts.length; j++) {
					const a = fronts[i];
					const b = fronts[j];
					if (a === undefined || b === undefined) continue;
					if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
					const w =
						Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
					const h =
						Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
					if (w > 1 && h > 1) {
						overlaps.push(`${a.label} × ${b.label}（${round(w)}×${round(h)}）`);
					}
				}
			}
			return {
				innerWidth: vw,
				innerHeight: vh,
				overflowY: root.scrollHeight - vh,
				overflowX: root.scrollWidth - vw,
				outside,
				overlaps,
				shown: found.map((f) => f.label),
			};
		},
		{ parts: PARTS, backdrops: BACKDROPS },
	);
}

/** 表の 1 行（標準出力に出す。報告の表に貼る）。 */
export function layoutRow(
	size: LayoutSize,
	screen: string,
	m: LayoutMeasure,
): string {
	const list = (items: readonly string[]) =>
		items.length === 0 ? "なし" : items.join("、");
	return [
		"[layout]",
		`${size.name} ${m.innerWidth}x${m.innerHeight}`,
		screen,
		`縦 ${m.overflowY > 0 ? `+${m.overflowY}` : "0"}`,
		`横 ${m.overflowX > 0 ? `+${m.overflowX}` : "0"}`,
		`外: ${list(m.outside)}`,
		`重なり: ${list(m.overlaps)}`,
	].join(" | ");
}

/**
 * 画面を測り、行を出し、画像と数字をレポートに添付してから、(a)〜(d) を確かめる。確かめは soft
 * （失敗しても、続く画面を測り終えてから、テストを失敗にする）。
 */
export async function checkLayout(
	page: Page,
	testInfo: TestInfo,
	size: LayoutSize,
	screen: string,
): Promise<void> {
	const m = await measureLayout(page);
	const row = layoutRow(size, screen, m);
	console.log(row);
	await testInfo.attach(`${size.name}-${screen}.png`, {
		body: await page.screenshot(),
		contentType: "image/png",
	});
	await testInfo.attach(`${size.name}-${screen}.json`, {
		body: JSON.stringify(m, null, 2),
		contentType: "application/json",
	});
	expect.soft(m.overflowY, `${screen}: 縦のスクロール`).toBeLessThanOrEqual(0);
	expect.soft(m.overflowX, `${screen}: 横のはみ出し`).toBeLessThanOrEqual(0);
	expect.soft(m.outside, `${screen}: 表示領域の外の部品`).toEqual([]);
	expect.soft(m.overlaps, `${screen}: 部品の重なり`).toEqual([]);
}
