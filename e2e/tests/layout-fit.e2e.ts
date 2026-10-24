/**
 * iPhone の縦画面で、ゲーム画面がスクロールなしで収まるか（WebKit。大きさは layout.ts の LAYOUT_SIZES）。
 *
 * 画面ごとに、(a) 縦のスクロールなし、(b) 横のスクロールなし、(c) 主な部品が表示領域の内側に完全に
 * 収まる、(d) 部品どうしが重ならない、を確かめる。数字は `[layout]` の行で標準出力に出し、画面の画像と
 * 数字を、レポートに添付する（失敗しても、続く画面を測り終えてから失敗にする）。
 *
 * - make e2e: 代表の 2 画面（待機ルームと探索）。大きさごとに、探索まで進む（約 1 分）
 * - pnpm --filter @rondo/e2e e2e:layout（@layout）: すべての画面（待機ルーム、準備移動、ペイント、探索、
 *   答え合わせ、結果）。大きさごとに、結果画面まで進む（約 2 分）
 *
 * - @layout の動ける隠れ側の規則（ADR 0053）: ペイントと探索の隠れ側（移動パッドと、上に出すペイントの板。
 *   板を閉じた画面も）と、探索の鬼
 *
 * 2 人（A が鬼、B が隠れ側）で、フェーズの時間は本番の既定のまま。素材なし（カプセル）で測る。
 * 襖を開けるボタンは、鬼が襖の前に立ったときだけ出るので、ここでは出ない（目視で確かめる）。
 */

import type { Page } from "@playwright/test";
import {
	type Tab,
	expectArea,
	expectPhase,
	roamingRoomWithTwo,
	roomWithTwo,
	test,
	touchArea,
} from "./flows";
import { LAYOUT_SIZES, type LayoutSize, checkLayout } from "./layout";

/** 鬼選出から探索まで。待機ルームと探索を測る。full なら、その間と、その後の画面も測る。 */
async function walkScreens(
	open: () => Promise<Tab>,
	size: LayoutSize,
	full: boolean,
): Promise<void> {
	const info = test.info();
	const { a, b, roomId } = await roomWithTwo(open);
	await expectArea(a, "green");
	await checkLayout(a.page, info, size, "待機ルーム");

	// A が中央の円に触れて、ただ 1 人の立候補者になる（A が鬼、B が隠れ側）。
	touchArea(a, roomId);
	if (full) {
		await expectPhase(b, "preparation", 60_000);
		await checkLayout(b.page, info, size, "準備移動（隠れ側）");
		await checkLayout(a.page, info, size, "準備移動（鬼）");
		await expectPhase(b, "painting", 60_000);
		await b.page.getByTestId("veryare-paint").waitFor();
		await checkLayout(b.page, info, size, "ペイント（隠れ側）");
	}

	for (const tab of [a, b]) await expectPhase(tab, "exploration", 90_000);
	await checkLayout(a.page, info, size, "探索（鬼）");
	await checkLayout(b.page, info, size, "探索（隠れ側）");
	if (!full) return;

	for (const tab of [a, b]) await expectPhase(tab, "reveal", 90_000);
	await checkLayout(a.page, info, size, "答え合わせ（鬼）");
	await checkLayout(b.page, info, size, "答え合わせ（隠れ側）");

	for (const tab of [a, b]) {
		await tab.page.getByTestId("result-screen").waitFor({ timeout: 90_000 });
	}
	await checkLayout(a.page, info, size, "結果（鬼）");
	await checkLayout(b.page, info, size, "結果（隠れ側）");
}

/**
 * 動ける隠れ側の規則（ADR 0053）。ペイントと探索の隠れ側に、移動パッドと、上に出すペイントの板が、
 * 重ならずに収まるか。板を閉じたときの画面も測る。
 */
async function walkRoamingScreens(
	open: () => Promise<Tab>,
	size: LayoutSize,
): Promise<void> {
	const info = test.info();
	const { a, b, roomId } = await roamingRoomWithTwo(open);
	await expectArea(a, "green");
	touchArea(a, roomId);
	await expectPhase(b, "painting", 90_000);
	await b.page.getByTestId("veryare-paint").waitFor();
	await b.page.getByTestId("veryare-move-pad").waitFor();
	await checkLayout(b.page, info, size, "ペイント（動ける隠れ側）");
	await expectPhase(b, "exploration", 90_000);
	await b.page.getByTestId("veryare-move-pad").waitFor();
	await checkLayout(b.page, info, size, "探索（動ける隠れ側・板を開く）");
	await b.page.getByTestId("veryare-sheet-close").click();
	await checkLayout(b.page, info, size, "探索（動ける隠れ側・板を閉じる）");
	await checkLayout(a.page, info, size, "探索（動ける隠れ側の鬼）");
}

for (const size of LAYOUT_SIZES) {
	test.describe(`${size.name}（${size.width}×${size.height}）`, () => {
		test.use({ viewport: { width: size.width, height: size.height } });

		test("待機ルームと探索が、スクロールなしで収まる", async ({ openTab }) => {
			test.setTimeout(150_000);
			await walkScreens(openTab, size, false);
		});

		test("すべてのゲーム画面が、スクロールなしで収まる @layout", async ({
			openTab,
		}) => {
			test.setTimeout(240_000);
			await walkScreens(openTab, size, true);
		});

		test("動ける隠れ側の規則の、ペイントと探索の画面が、スクロールなしで収まる @layout", async ({
			openTab,
		}) => {
			test.setTimeout(240_000);
			await walkRoamingScreens(openTab, size);
		});
	});
}

/**
 * ひとり用のゲーム（と、ひとりで遊べる傾きの迷路）の画面。共通の起動画面（tetris・nikaku-keshi・minichess・
 * tilt-maze）は、起動画面と、「はじめる」を押した後を測る。傾きの迷路は、モード選択・迷路の大きさの選択と、
 * 1人モードの中（8×8）の迷路も測る。サーバーの準備は要らない（傾きの迷路はルームを作る）。
 *
 * 直していない画面は、別のテストにして「期待された失敗」（test.fail）として記録する（2026-10-23）。
 * 直って収まったら、test.fail が「期待に反して通った」として失敗するので、そのときに外す。
 */
const FITTED_GAMES = ["tetris", "nikaku-keshi", "minichess"] as const;

/** 本体の読み込み（遅延読み込み）と、最初の描画を待つ。 */
const SETTLE_MS = 1500;

/** ボタンがあれば押す（無ければ false）。 */
async function pressIfShown(page: Page, name: string): Promise<boolean> {
	const button = page.getByRole("button", { name });
	const shown = await button.waitFor({ timeout: 5000 }).then(
		() => true,
		() => false,
	);
	if (shown) await button.click();
	return shown;
}

/** 共通の起動画面を測り、「はじめる」を押す。 */
async function launch(page: Page, size: LayoutSize, id: string): Promise<void> {
	await page.goto(`/play/${id}`);
	await page.waitForTimeout(SETTLE_MS);
	await checkLayout(page, test.info(), size, `${id}（起動画面）`);
	await pressIfShown(page, "はじめる");
	await page.waitForTimeout(SETTLE_MS);
}

for (const size of LAYOUT_SIZES) {
	test.describe(`${size.name}（${size.width}×${size.height}） ひとり用`, () => {
		test.use({ viewport: { width: size.width, height: size.height } });

		test("ひとり用のゲームが、スクロールなしで収まる @layout", async ({
			page,
		}) => {
			test.setTimeout(180_000);
			const info = test.info();
			for (const id of FITTED_GAMES) {
				await launch(page, size, id);
				await checkLayout(page, info, size, id);
			}
			await launch(page, size, "tilt-maze");
			await checkLayout(page, info, size, "tilt-maze（モード選択）");
			await pressIfShown(page, "1人モード");
			await page.waitForTimeout(SETTLE_MS);
			await checkLayout(page, info, size, "tilt-maze（迷路の大きさ）");
		});

		test("傾きの迷路の 1 人・中（8×8）の迷路が、スクロールなしで収まる @layout", async ({
			page,
		}) => {
			// 期待された失敗（2026-10-23）: 迷路の画面は、縦に積む形のままで、迷路とパッドが縦に収まらない。
			// 画面を作り直す作業（画面いっぱいの枠にし、迷路の大きさを見える領域から決める）が、別に要る
			// （リアルタイムのゲームなので、ルームの導線も上部バーへ移る）。大（11×11）は選択肢から外した。
			test.fail();
			test.setTimeout(120_000);
			await launch(page, size, "tilt-maze");
			await pressIfShown(page, "1人モード");
			await page.waitForTimeout(SETTLE_MS);
			await pressIfShown(page, "中");
			await page.waitForTimeout(SETTLE_MS);
			await checkLayout(page, test.info(), size, "tilt-maze（1人・中）");
		});

		test("czz のタイトルとプレイが、スクロールなしで収まる @layout", async ({
			page,
		}) => {
			// 期待された失敗（2026-10-23）: czz のプレイ画面は、命令の一覧が遊ぶほど伸びる作りで、スクロールが
			// 前提。収めるには、画面の構成から作り直す必要がある。
			test.fail();
			test.setTimeout(120_000);
			const info = test.info();
			await page.goto("/play/czz");
			await page.waitForTimeout(SETTLE_MS);
			await checkLayout(page, info, size, "czz（タイトル）");
			if (await pressIfShown(page, "スタート")) {
				await page.waitForTimeout(SETTLE_MS);
				await checkLayout(page, info, size, "czz（プレイ）");
			}
		});
	});
}
