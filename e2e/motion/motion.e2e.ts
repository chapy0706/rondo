/**
 * 体の動きの E2E（@motion / issue-57 の後半）。動きの見張り（apps/web の motionWatch.ts）の止まりの記録が
 * 0 件で、待機・歩く・走るのそれぞれで、動きの再生の時間が進んでいることを、テスト用の口で確かめる
 * （canvas のピクセルは比べない）。移動は、テスト用の口から傾きを与えて、パッドを触らずに再現する。
 *
 * 実行: pnpm --filter @rondo/e2e e2e:motion（playwright.motion.config.ts。make e2e の外。素材の配信つき）
 *
 * 場面:
 * 1. 鬼本人の画面: 歩く 3 秒・止まる 2 秒・走る 3 秒・止まる 2 秒を 5 周
 * 2. 2 つのタブ（1 つ目が鬼、2 つ目が隠れ側）: 2 つ目の画面で、鬼の体が歩く・待機で切り替わる
 * 3. ランダム間取りで、鬼 CPU のルーム: 鬼 CPU の体が、歩く（か走る）・待機で切り替わる
 * 4. 待機ルームのほかのメンバー: 2 つ目の画面で、1 つ目の体が歩く・待機で切り替わる
 */

import { expect } from "@playwright/test";
import {
	type Tab,
	expectPhase,
	joinFromLobby,
	test,
	touchArea,
} from "../tests/flows";
import {
	type Sample,
	advancedIn,
	clearMove,
	disableAutoCamera,
	expectAssetBody,
	readStalls,
	sampleFor,
	setMove,
	statesOf,
} from "./motionHooks";

/** 歩く傾き（1.35 m/秒。待機 → 歩くの 0.3 m/秒より速く、歩く → 走るの 2.8 m/秒より遅い）と、走る傾き。 */
const WALK = 0.3;
const RUN = 1;

/** タブを開き、視点の自動追従を切る（移動の向きを保つ）。 */
async function open(openTab: () => Promise<Tab>): Promise<Tab> {
	const tab = await openTab();
	await disableAutoCamera(tab.page);
	return tab;
}

/** ロビーでルームを作る。options はプルダウンの表示名。ルーム ID を返す。 */
async function createRoom(
	tab: Tab,
	options: { readonly exploration?: string; readonly cpu?: string } = {},
): Promise<string> {
	await tab.page.goto("/lobby/veryare");
	await tab.page
		.getByLabel("ステージ")
		.selectOption({ label: "ランダム間取り" });
	if (options.exploration !== undefined) {
		await tab.page
			.getByLabel("探索時間")
			.selectOption({ label: options.exploration });
	}
	if (options.cpu !== undefined) {
		await tab.page
			.getByLabel("CPU", { exact: true })
			.selectOption({ label: options.cpu });
	}
	await tab.page.getByRole("button", { name: "新しいルームを作る" }).click();
	await expect(tab.page.getByTestId("veryare-area")).toBeVisible();
	await expect.poll(() => tab.link.roomId()).not.toBeNull();
	return tab.link.roomId() as string;
}

/** A が作り（探索 120 秒）、B が入った 2 人のルーム。どちらも素材の体に差し替わるまで待つ。 */
async function roomOfTwo(
	openTab: () => Promise<Tab>,
): Promise<{ a: Tab; b: Tab; roomId: string }> {
	const a = await open(openTab);
	const b = await open(openTab);
	const roomId = await createRoom(a, { exploration: "120" });
	await joinFromLobby(b, roomId);
	await expectAssetBody(a);
	await expectAssetBody(b);
	return { a, b, roomId };
}

/** A を鬼にして、探索フェーズまで進める（鬼選出 10 秒・準備移動 20 秒・ペイント 20 秒）。 */
async function startAsOni(a: Tab, b: Tab, roomId: string): Promise<void> {
	touchArea(a, roomId);
	await expectPhase(a, "exploration", 90_000);
	await expectPhase(b, "exploration", 30_000);
}

/** 傾きを与えて ms ミリ秒たつまで、watcher の画面の体の動きを読む。 */
async function hold(
	mover: Tab,
	watcher: Tab,
	input: { readonly x: number; readonly y: number },
	ms: number,
	label: string,
	out: Sample[],
): Promise<void> {
	await setMove(mover, input.x, input.y);
	await sampleFor(watcher.page, ms, label, out);
}

/** 歩く・止まる・走る・止まるを cycles 周（前へ歩き、後ろへ走る。壁で止まっても待機に戻るだけ）。 */
async function walkStopRun(
	mover: Tab,
	watcher: Tab,
	cycles: number,
	out: Sample[],
): Promise<void> {
	for (let cycle = 0; cycle < cycles; cycle++) {
		await hold(mover, watcher, { x: 0, y: -WALK }, 3000, `${cycle}:walk`, out);
		await hold(mover, watcher, { x: 0, y: 0 }, 2000, `${cycle}:stop`, out);
		await hold(mover, watcher, { x: 0, y: RUN }, 3000, `${cycle}:run`, out);
		await hold(mover, watcher, { x: 0, y: 0 }, 2000, `${cycle}:stop`, out);
	}
	await clearMove(mover);
}

/** 読み取りの要約（失敗したときに、どの状態を通ったかを出す）。 */
function summary(samples: readonly Sample[], name: string): string {
	return samples
		.filter((sample) => sample.name === name)
		.map((s) => `${s.label}=${s.state}@${s.time?.toFixed(2) ?? "-"}`)
		.join(" ");
}

test("場面1: 鬼本人の画面で、歩く・止まる・走る・止まるを 5 周しても、動きが止まらない @motion", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomOfTwo(openTab);
	await startAsOni(a, b, roomId);
	const samples: Sample[] = [];
	await walkStopRun(a, a, 5, samples);
	expect(await readStalls(a.page)).toEqual([]);
	const detail = summary(samples, "self-oni");
	for (const state of ["idle", "walk", "run"]) {
		expect(advancedIn(samples, "self-oni", state), `${state}: ${detail}`).toBe(
			true,
		);
	}
});

test("場面2: 隠れ側の画面で、人間の鬼の体が、歩く・待機で切り替わり、止まらない @motion", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomOfTwo(openTab);
	await startAsOni(a, b, roomId);
	const samples: Sample[] = [];
	// 鬼（A）を歩かせ・止め、隠れ側（B）の画面で、鬼の体（oni）を読む。
	for (let cycle = 0; cycle < 3; cycle++) {
		await hold(
			a,
			b,
			{ x: 0, y: cycle % 2 === 0 ? -WALK : WALK },
			3000,
			`${cycle}:walk`,
			samples,
		);
		await hold(a, b, { x: 0, y: 0 }, 2000, `${cycle}:stop`, samples);
	}
	await clearMove(a);
	expect(await readStalls(b.page)).toEqual([]);
	expect(await readStalls(a.page)).toEqual([]);
	const detail = summary(samples, "oni");
	expect(advancedIn(samples, "oni", "idle"), `idle: ${detail}`).toBe(true);
	expect(
		advancedIn(samples, "oni", "walk") || advancedIn(samples, "oni", "run"),
		`walk: ${detail}`,
	).toBe(true);
});

test("場面3: ランダム間取りの鬼 CPU のルームで、鬼 CPU の体が、歩く・待機で切り替わり、止まらない @motion", async ({
	openTab,
}) => {
	const a = await open(openTab);
	const roomId = await createRoom(a, { exploration: "40", cpu: "鬼 CPU" });
	await expectAssetBody(a);
	// 鬼 CPU がいれば、抽選をせずに鬼 CPU が鬼になる。A は隠れ側。
	touchArea(a, roomId);
	await expectPhase(a, "exploration", 90_000);
	const samples: Sample[] = [];
	// 探索（40 秒）と答え合わせの間、鬼 CPU の体を読む。終わったら（結果画面へ）やめる。
	const until = Date.now() + 60_000;
	while (Date.now() < until) {
		await sampleFor(a.page, 2000, "explore", samples);
		const phase = await a.page
			.getByTestId("veryare")
			.getAttribute("data-phase")
			.catch(() => null);
		if (phase !== "exploration" && phase !== "reveal") break;
	}
	expect(await readStalls(a.page)).toEqual([]);
	const detail = summary(samples, "oni");
	expect(statesOf(samples, "oni"), detail).toContain("idle");
	expect(
		advancedIn(samples, "oni", "walk") || advancedIn(samples, "oni", "run"),
		`walk: ${detail}`,
	).toBe(true);
	expect(advancedIn(samples, "oni", "idle"), `idle: ${detail}`).toBe(true);
});

test("場面4: 待機ルームのほかのメンバーの体が、歩く・待機で切り替わり、止まらない @motion", async ({
	openTab,
}) => {
	const { a, b } = await roomOfTwo(openTab);
	const samples: Sample[] = [];
	// 待機ルームの円（半径 3.5 m）の中で、前へ歩き、止まり、後ろへ歩き、止まる。
	for (let cycle = 0; cycle < 2; cycle++) {
		await hold(a, b, { x: 0, y: -WALK }, 2000, `${cycle}:walk`, samples);
		await hold(a, b, { x: 0, y: 0 }, 2000, `${cycle}:stop`, samples);
		await hold(a, b, { x: 0, y: WALK }, 2000, `${cycle}:back`, samples);
		await hold(a, b, { x: 0, y: 0 }, 2000, `${cycle}:stop`, samples);
	}
	await clearMove(a);
	expect(await readStalls(b.page)).toEqual([]);
	expect(await readStalls(a.page)).toEqual([]);
	const member = samples.find((sample) => sample.name.startsWith("member:"));
	expect(member, "ほかのメンバーの体が見えない").toBeDefined();
	const name = (member as Sample).name;
	const detail = summary(samples, name);
	expect(advancedIn(samples, name, "walk"), `walk: ${detail}`).toBe(true);
	expect(advancedIn(samples, name, "idle"), `idle: ${detail}`).toBe(true);
	// 自分の体（A の画面の self）も、同じ見張りで止まりが無い（上の readStalls(a)）。
});
