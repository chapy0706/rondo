/**
 * テスト用の口で、3D の状態を読む（issue-52）。画面の data 属性（フェーズ、開いている襖の数）と
 * 同じ値を返し、待機ルームでは、隠れ側の体は見えず、体は仮のカプセル（素材の配信が無い）。
 */

import { expect } from "@playwright/test";
import { playNew, test } from "../flows";
import { serveAssets } from "./assetRoutes";
import { hasTestHook, readState } from "./state";

test("テスト用の口: 状態を読める（フェーズ・位置・視点の向き・襖・見えている隠れ側・体）", async ({
	openTab,
}) => {
	const a = await openTab();
	await serveAssets(a.page, "manifest-missing");
	await playNew(a);
	// 口は、3D のシーンの読み込み（遅延読み込み）の後に作られるので、できるまで待つ。
	await expect.poll(() => hasTestHook(a.page)).toBe(true);
	await expect
		.poll(async () => (await readState(a.page))?.phase)
		.toBe("oni-selection");
	const state = await readState(a.page);
	if (state === null) throw new Error("状態が読めない");
	const root = a.page.getByTestId("veryare");
	expect(state.phase).toBe(await root.getAttribute("data-phase"));
	expect(String(state.openDoors)).toBe(
		await root.getAttribute("data-open-doors"),
	);
	expect(Number.isFinite(state.position.x)).toBe(true);
	expect(Number.isFinite(state.position.z)).toBe(true);
	expect(Number.isFinite(state.yaw)).toBe(true);
	expect(state.visibleHiders).toBe(0);
	expect(state.body).toBe("placeholder");
});
