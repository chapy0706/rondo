/**
 * テスト用の口（apps/web の testHooks.ts）から、ゲームの状態を読む（issue-52）。値は読むだけで、
 * ゲームの状態は書き換えない。canvas のピクセルは比べない。
 */

import type { Page } from "@playwright/test";

export interface VeryareTestState {
	readonly phase: string;
	readonly position: { readonly x: number; readonly z: number };
	readonly yaw: number;
	readonly openDoors: number;
	readonly visibleHiders: number;
	readonly body: "asset" | "placeholder";
}

/** いまの状態。口がまだ無い（読み込み中）・シーンがまだ無いときは null。 */
export function readState(page: Page): Promise<VeryareTestState | null> {
	return page.evaluate(() => {
		const hook = (
			window as unknown as {
				__rondoTest?: { veryare?: { state?: () => unknown } };
			}
		).__rondoTest;
		return (hook?.veryare?.state?.() ?? null) as VeryareTestState | null;
	});
}

/** テスト用の口が window にあるか。 */
export function hasTestHook(page: Page): Promise<boolean> {
	return page.evaluate(() => "__rondoTest" in window);
}

/** 素材の読み込みの記録（console.info の "[assets] ..."）を集める。 */
export function collectAssetLogs(page: Page): string[] {
	const logs: string[] = [];
	page.on("console", (message) => {
		const text = message.text();
		if (text.startsWith("[assets]")) logs.push(text);
	});
	return logs;
}
