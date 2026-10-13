/**
 * 2本パッドのタッチ操作（issue-52）。移動パッドと視点パッドを、2本の指で同時に倒す。
 *
 * Playwright の page.touchscreen は1本の指のタップしかできないため、Chromium の CDP
 * （Input.dispatchTouchEvent）で、2本の指のタッチを送る。WebKit には CDP が無く、複数の指の
 * タッチを送る手段が無いので、WebKit では流さない（実機の iPhone で目視する / docs/e2e.md）。
 * 結果は、テスト用の口の状態（自分の位置と、視点の向き）で確かめる。
 */

import { expect } from "@playwright/test";
import { playNew, test } from "../flows";
import { readState } from "./state";

test("2本の指で、移動パッドと視点パッドを同時に倒すと、歩きながら視点が回る", async ({
	openTab,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== "mobile-chrome",
		"複数の指のタッチは、Chromium の CDP だけで送れる（タッチのある端末設定の mobile-chrome で流す）",
	);
	const a = await openTab();
	await playNew(a);
	const movePad = a.page.getByLabel("仮想パッド（move）");
	const lookPad = a.page.getByLabel("仮想パッド（look）");
	await expect(movePad).toBeVisible();
	await expect(lookPad).toBeVisible();
	await expect
		.poll(async () => (await readState(a.page))?.phase)
		.toBe("oni-selection");
	const before = await readState(a.page);
	if (before === null) throw new Error("状態が読めない");

	const center = async (pad: typeof movePad) => {
		const box = await pad.boundingBox();
		if (box === null) throw new Error("パッドが見えない");
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	};
	const move = await center(movePad);
	const look = await center(lookPad);
	const cdp = await a.page.context().newCDPSession(a.page);
	const touch = (
		type: "touchStart" | "touchMove" | "touchEnd",
		dy: number,
		dx: number,
	) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints:
				type === "touchEnd"
					? []
					: [
							{ x: move.x, y: move.y - dy, id: 1 },
							{ x: look.x + dx, y: look.y, id: 2 },
						],
		});

	await touch("touchStart", 0, 0);
	// 移動パッドを上へ、視点パッドを右へ、少しずつ倒していき、倒したまま保つ。
	for (let step = 1; step <= 10; step++) {
		await touch("touchMove", step * 4, step * 4);
	}
	await expect
		.poll(async () => {
			const now = await readState(a.page);
			if (now === null) return false;
			const moved = Math.hypot(
				now.position.x - before.position.x,
				now.position.z - before.position.z,
			);
			return moved > 0.3 && Math.abs(now.yaw - before.yaw) > 0.1;
		})
		.toBe(true);
	await touch("touchEnd", 0, 0);

	// 指を離すと止まる。止まったこと（変わらないこと）は、待つべき状態が無いので、離した直後の
	// 1 コマを過ぎてから、0.5 秒の間、位置が変わらないことで確かめる。
	await expect
		.poll(async () => {
			const first = await readState(a.page);
			await a.page.waitForTimeout(500);
			const second = await readState(a.page);
			return (
				JSON.stringify(first?.position) === JSON.stringify(second?.position)
			);
		})
		.toBe(true);
});
