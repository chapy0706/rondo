/**
 * 動ける隠れ側の規則（ADR 0053）の代表の 1 本（make e2e）。実接続（Gleam サーバー）で、フェーズの時間は既定のまま。
 *
 * A がロビーで「隠れ側の動き: 探索中も動ける」を選んで作り、B が入る（ロビーの選択肢は、web を
 * NEXT_PUBLIC_VERYARE_ROAMING=1 で起動したときだけ出る / playwright.config.ts）。A が鬼、B が隠れ側。
 *
 * - 両方の画面がルームの規則を知る（data-roaming）
 * - B の画面: ペイントと探索の間に、移動パッドとペイントの板が出る。襖のボタンは出ない
 * - 探索の間に B が動くと、A に動く隠れ側の通知（roaming）で、B のいまの位置が届く
 * - B が襖へ近づくと、サーバーが襖を開け、A の画面の開いている襖が増える。B が離れても、閉じない
 * - B が塗り直すと、A に見た目の通知（look）が届く
 *
 * B の動きと塗り直しは、サーバーへの電文で代える（テスト用の口を使わない構成のため）。
 */

import { expect } from "@playwright/test";
import { cellOf, centerOf, findPath, pickDoorShot } from "@rondo/bots/plan";
import { readStageNotice } from "@rondo/bots/stage";
import {
	type Tab,
	expectArea,
	expectPhase,
	receivedPayloads,
	roamingRoomWithTwo,
	test,
	touchArea,
} from "./flows";

function controlsOf(tab: Tab): Promise<string[]> {
	return tab.page
		.getByTestId("veryare")
		.getAttribute("data-controls")
		.then((value) => (value ?? "").split(" "));
}

function sendAs(tab: Tab, roomId: string, payload: Record<string, unknown>) {
	tab.link.inject({ type: "game-event", gameType: "veryare", roomId, payload });
}

/** A に届いた、いちばん新しい動く隠れ側の通知での、id の位置。 */
function roamingAt(a: Tab, id: string): { x: number; z: number } | null {
	const notices = receivedPayloads(a, "roaming");
	const last = notices.at(-1)?.hiders as
		| { playerId: string; x: number; z: number }[]
		| undefined;
	const entry = last?.find((h) => h.playerId === id);
	return entry === undefined ? null : { x: entry.x, z: entry.z };
}

function openDoorsOf(tab: Tab): Promise<number> {
	return tab.page
		.getByTestId("veryare")
		.getAttribute("data-open-doors")
		.then((value) => Number(value ?? "0"));
}

test("動ける隠れ側の規則: 探索の間に動けて塗れ、近づくと襖が開く", async ({
	openTab,
}) => {
	test.setTimeout(240_000);
	const { a, b, roomId } = await roamingRoomWithTwo(openTab);
	await expectArea(a, "green");
	for (const tab of [a, b]) {
		await expect(tab.page.getByTestId("veryare")).toHaveAttribute(
			"data-roaming",
			"true",
		);
	}

	touchArea(a, roomId);
	await expectPhase(b, "painting", 90_000);
	await expect
		.poll(() => controlsOf(b))
		.toEqual(expect.arrayContaining(["move", "paint"]));

	await expectPhase(b, "exploration", 90_000);
	await expectPhase(a, "exploration", 30_000);
	await expect
		.poll(() => controlsOf(b))
		.toEqual(expect.arrayContaining(["move", "look", "paint"]));
	expect(await controlsOf(b)).not.toContain("open-door");

	// B のいまの位置（玄関）と ID は、探索の開始の一括配信で分かる。
	const [hiders] = receivedPayloads(a, "hiders");
	const hider = (hiders?.hiders as { playerId: string }[] | undefined)?.[0];
	expect(hider).toBeDefined();
	const id = hider?.playerId as string;
	const [notice] = receivedPayloads(b, "stage");
	const stage = readStageNotice(notice);
	if (stage === null) throw new Error("ステージの通知が届いていない");
	const plan = pickDoorShot(stage);
	if (plan === null) throw new Error("襖が見つからない");

	// 探索の間に、B が玄関から襖の前（廊下側のマス）まで歩く。A に、B のいまの位置が届く。
	const before = await openDoorsOf(a);
	const path = findPath(stage, cellOf(stage, stage.spawn), plan.c, "closed");
	if (path === null) throw new Error("襖の前へ歩けない");
	for (const cell of path)
		sendAs(b, roomId, { type: "move", ...centerOf(stage, cell) });
	const target = centerOf(stage, plan.c);
	await expect
		.poll(() => roamingAt(a, id))
		.toEqual({ x: target.x, z: target.z });
	// 近づくと、サーバーが襖を開ける。
	await expect.poll(() => openDoorsOf(a)).toBeGreaterThan(before);
	const opened = await openDoorsOf(a);

	// 玄関へ戻っても、襖は開いたまま。
	const back = findPath(stage, plan.c, cellOf(stage, stage.spawn), "open");
	for (const cell of back ?? []) {
		sendAs(b, roomId, { type: "move", ...centerOf(stage, cell) });
	}
	await expect
		.poll(() => roamingAt(a, id))
		.toEqual(centerOf(stage, cellOf(stage, stage.spawn)));
	expect(await openDoorsOf(a)).toBeGreaterThanOrEqual(opened);

	// 探索の間の塗り直しが、A に届く。
	sendAs(b, roomId, {
		type: "paint",
		paint: {
			kind: "strokes",
			strokes: [
				{
					part: "torso",
					color: "#123456",
					size: 0.05,
					points: [{ u: 0.5, v: 0.5 }],
				},
			],
		},
	});
	await expect
		.poll(() =>
			receivedPayloads(a, "look").some((look) => look.playerId === id),
		)
		.toBe(true);
});
