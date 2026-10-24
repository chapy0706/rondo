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
