/**
 * 素材の失敗と、正常な差し替え（issue-52）。素材の配信を page.route で差し替え（assetRoutes.ts）、
 * テスト用の口（state.ts）で、体が素材か仮の表示かを読む。
 *
 * - 失敗4種（404、壊れた glb、応答しない、manifest の欠落）: 原因が記録され、体は仮のカプセルのまま、
 *   画面は止まらずに続く（2人目が入ると、鬼希望エリアの円が緑になる）
 * - 正常: 小さな骨つきの体に差し替わる
 */

import { expect } from "@playwright/test";
import { expectArea, joinFromLobby, playNew, test } from "../flows";
import { type AssetBehavior, serveAssets } from "./assetRoutes";
import { collectAssetLogs, readState } from "./state";

const failures: [AssetBehavior, string][] = [
	["glb-404", "[assets] http-error"],
	["broken-glb", "[assets] invalid-glb"],
	["glb-timeout", "[assets] timeout"],
	["manifest-missing", "[assets] manifest-unavailable"],
];

for (const [behavior, logged] of failures) {
	test(`素材の失敗（${behavior}）: 仮の表示のまま、画面が止まらずに続く`, async ({
		openTab,
	}) => {
		// 応答しない素材は、web のローダーの待ち時間の上限（15 秒）で中止される。
		test.setTimeout(90_000);
		const a = await openTab();
		const b = await openTab();
		const logs = collectAssetLogs(a.page);
		await serveAssets(a.page, behavior);
		const roomId = await playNew(a);

		await expect
			.poll(() => logs.some((line) => line.startsWith(logged)), {
				timeout: 30_000,
			})
			.toBe(true);
		await expect
			.poll(async () => (await readState(a.page))?.body)
			.toBe("placeholder");

		// 失敗の後も、画面は続く（2人目が入ると、円が緑になる。状態も読める）。
		await joinFromLobby(b, roomId);
		await expectArea(a, "green");
		expect((await readState(a.page))?.phase).toBe("oni-selection");
	});
}

test("素材が正常なら、待機ルームの間に、素材の体に差し替わる", async ({
	openTab,
}) => {
	const a = await openTab();
	const logs = collectAssetLogs(a.page);
	await serveAssets(a.page, "ok");
	await playNew(a);
	await expect
		.poll(async () => (await readState(a.page))?.body, { timeout: 30_000 })
		.toBe("asset");
	// 体とポーズの表は読めている（動きは manifest に無いので、載っていないと記録される）。
	expect(logs.some((line) => line.includes("character-body"))).toBe(false);
	expect(logs.some((line) => line.includes("character-poses"))).toBe(false);
});
