/**
 * 体の動きの E2E（@motion）の部品。テスト用の口（apps/web の testHooks.ts）から、体ごとの動きの状態と
 * 止まりの記録を読み、移動の傾きを与える（パッドを触らずに、歩く・止まる・走るを決まった時間で再現する）。
 *
 * 体の名前（scene.ts の motionInfos）: self（自分の体）、self-oni（鬼本人の体）、oni（ほかの人の画面の
 * 鬼。人間と CPU）、member:<プレイヤー ID>（待機ルームのほかのメンバー）。
 */

import { type Page, expect } from "@playwright/test";
import { readState } from "../tests/extended/state";
import type { Tab } from "../tests/flows";

export interface MotionInfo {
	readonly name: string;
	readonly state: string;
	readonly speed: number;
	readonly rate: number;
	readonly clips: readonly {
		readonly name: string;
		readonly time: number;
		readonly weight: number;
	}[];
}

export interface Stall {
	readonly body: string;
	readonly state: string;
	readonly at: number;
	readonly reason: string;
}

/** 見えている体ごとの動きの状態。口がまだ無ければ空。 */
export function readMotions(page: Page): Promise<MotionInfo[]> {
	return page.evaluate(
		() =>
			(
				window as unknown as {
					__rondoTest?: { veryare?: { motions?(): MotionInfo[] } };
				}
			).__rondoTest?.veryare?.motions?.() ?? [],
	);
}

/** 止まりの記録。口がまだ無ければ空。 */
export function readStalls(page: Page): Promise<Stall[]> {
	return page.evaluate(
		() =>
			(
				window as unknown as {
					__rondoTest?: { veryare?: { stalls?(): Stall[] } };
				}
			).__rondoTest?.veryare?.stalls?.() ?? [],
	);
}

/** 移動の傾きを与える（x は右が正、y は下が正。y = -1 で前へ）。 */
export async function setMove(tab: Tab, x: number, y: number): Promise<void> {
	const ok = await tab.page.evaluate(
		({ x, y }) =>
			(
				window as unknown as {
					__rondoTest?: {
						veryare?: { setMove?(x: number, y: number): boolean };
					};
				}
			).__rondoTest?.veryare?.setMove?.(x, y) ?? false,
		{ x, y },
	);
	expect(ok, "テスト用の口の setMove が無い").toBe(true);
}

/** 与えた傾きをやめ、パッドの入力に戻す。 */
export async function clearMove(tab: Tab): Promise<void> {
	await tab.page.evaluate(() =>
		(
			window as unknown as {
				__rondoTest?: { veryare?: { clearMove?(): void } };
			}
		).__rondoTest?.veryare?.clearMove?.(),
	);
}

/** 体の動きの1回の読み取り。time は、いまの状態の動きの再生の時間（再生していなければ null）。 */
export interface Sample {
	readonly at: number;
	readonly label: string;
	readonly name: string;
	readonly state: string;
	readonly time: number | null;
}

function toSamples(
	infos: readonly MotionInfo[],
	at: number,
	label: string,
): Sample[] {
	return infos.map((info) => ({
		at,
		label,
		name: info.name,
		state: info.state,
		time: info.clips.find((clip) => clip.name === info.state)?.time ?? null,
	}));
}

/** ms ミリ秒のあいだ、every ミリ秒ごとに、体の動きを読んで out に足す。 */
export async function sampleFor(
	page: Page,
	ms: number,
	label: string,
	out: Sample[],
	every = 200,
): Promise<void> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		out.push(...toSamples(await readMotions(page), Date.now(), label));
		await page.waitForTimeout(every);
	}
}

/**
 * 体 name が、状態 state のとき、再生の時間が進んでいたか（同じ状態が続いた、となりあう2回の読み取りで、
 * 時間が変わった組があるか）。
 */
export function advancedIn(
	samples: readonly Sample[],
	name: string,
	state: string,
): boolean {
	const own = samples.filter((sample) => sample.name === name);
	for (let i = 1; i < own.length; i++) {
		const before = own[i - 1] as Sample;
		const after = own[i] as Sample;
		if (
			before.state === state &&
			after.state === state &&
			before.time !== null &&
			after.time !== null &&
			before.time !== after.time
		) {
			return true;
		}
	}
	return false;
}

/** 体 name が通った状態。 */
export function statesOf(samples: readonly Sample[], name: string): string[] {
	return [
		...new Set(
			samples.filter((sample) => sample.name === name).map((s) => s.state),
		),
	];
}

/** 体が素材の体（動きの素材つき）に差し替わるまで待つ。 */
export async function expectAssetBody(tab: Tab): Promise<void> {
	await expect
		.poll(async () => (await readState(tab.page))?.body ?? null, {
			timeout: 90_000,
			message:
				"素材の体に差し替わらない（素材の配信と manifest.json を確かめる）",
		})
		.toBe("asset");
	await expect
		.poll(
			async () =>
				(await readMotions(tab.page)).find((info) => info.name === "self")
					?.clips.length ?? 0,
			{ message: "動きの素材が読めていない（character-motions）" },
		)
		.toBeGreaterThan(0);
}

/** 視点の自動追従を切る（移動の向きを、視点の向きのまま保つため）。ページを開く前に呼ぶ。 */
export async function disableAutoCamera(page: Page): Promise<void> {
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem("rondo.veryare.autoCamera", "off");
		} catch {
			// 書けなければ、既定のまま。
		}
	});
}
