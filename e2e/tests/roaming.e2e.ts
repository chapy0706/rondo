/**
 * 動ける隠れ側の規則（ADR 0053）の代表の 1 本（make e2e）。実接続（Gleam サーバー）で、フェーズの時間は既定のまま。
 *
 * 本番と同じ道を通る: A は選択画面を ?rules=1 で開いて、新しい規則の入口を開き（端末に覚える）、URL に何も
 * 付けずにロビーを開いて「隠れ側の動き: 動ける（新）」を選んで作る（作成の電文に roaming: 1 が載る）。B が入る。
 * A が鬼、B が隠れ側。開発用の環境変数（NEXT_PUBLIC_VERYARE_ROAMING）は使わない（playwright.config.ts）。
 *
 * - 両方の画面がルームの規則を知る（data-roaming）。上部バーに「動ける」が出る
 * - B の画面: ペイントと探索の間に、移動パッドとペイントの板が出る。襖のボタンは出ない
 * - 探索の間に B が動くと、A に動く隠れ側の通知（roaming）で、B のいまの位置が届く
 * - B が襖へ近づくと、サーバーが襖を開け、A の画面の開いている襖が増える。B が離れても、閉じない
 * - B が塗り直すと、A に見た目の通知（look）が届く
 *
 * - B の画面: 「全身を塗る」で 5 本（部位ごと）が足され、「1つ戻す」でまとめて消える。板を閉じると、小さな
 *   「塗る」（下の中央）だけになり、移動パッドは出たまま
 * - B の画面（探索）: 鬼の視点の切り替えは、板を開いている間は板の見出しの中、閉じると左上（「塗る」と
 *   重ならない）
 *
 * B の動きと塗り直しは、サーバーへの電文で代える（テスト用の口を使わない構成のため）。
 *
 * もう 1 本: クライアントの既定（2026-10-25）。?rules=1 を付けない来場者が「新しく遊ぶ」で作ったルームも、
 * 動ける規則になる（作成の電文に roaming: 1。上部バーに「動ける」）。ロビーの作成フォームの既定の選択は、
 * 「動ける（新）」と「ふつう」で、「その場から動けない（従来）」も選べる。
 */

import { expect } from "@playwright/test";
import { cellOf, centerOf, findPath, pickDoorShot } from "@rondo/bots/plan";
import { readStageNotice } from "@rondo/bots/stage";
import {
	type Tab,
	chooseVeryare,
	expectArea,
	expectPhase,
	playNew,
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
		await expect(tab.page.getByTestId("play-rules")).toHaveText("動ける");
	}

	touchArea(a, roomId);
	await expectPhase(b, "painting", 90_000);
	await expect
		.poll(() => controlsOf(b))
		.toEqual(expect.arrayContaining(["move", "paint"]));
	// 全身を塗る: 部位ごとに 1 本（5 本）。1つ戻すで、まとめて取り消せる。
	const panel = b.page.getByTestId("veryare-paint");
	await b.page.getByTestId("veryare-paint-fill").click();
	await expect(panel).toHaveAttribute("data-strokes", "5");
	await panel.getByRole("button", { name: "1つ戻す" }).click();
	await expect(panel).toHaveAttribute("data-strokes", "0");
	// 板を閉じると、小さな「塗る」だけになり、移動パッドは出たまま。開き直しても、出たまま。
	await b.page.getByTestId("veryare-sheet-close").click();
	await expect(b.page.getByTestId("veryare-sheet-open")).toHaveText("塗る");
	await expect(b.page.getByTestId("veryare-move-pad")).toBeVisible();
	await b.page.getByTestId("veryare-sheet-open").click();
	await expect(panel).toBeVisible();
	await expect(b.page.getByTestId("veryare-move-pad")).toBeVisible();

	await expectPhase(b, "exploration", 90_000);
	await expectPhase(a, "exploration", 30_000);
	await expect
		.poll(() => controlsOf(b))
		.toEqual(expect.arrayContaining(["move", "look", "paint"]));
	expect(await controlsOf(b)).not.toContain("open-door");

	// 鬼の視点の切り替え: 板を開いている間は、板の見出しの中。板を閉じると左上に出て、下の中央の「塗る」
	// （移動パッドと視点パッドの間）と重ならない。
	const sheet = b.page.getByTestId("veryare-sheet");
	await expect(sheet.getByTestId("veryare-oni-view")).toBeVisible();
	await b.page.getByTestId("veryare-sheet-close").click();
	const oniView = b.page.getByTestId("veryare-oni-view");
	await expect(oniView).toBeVisible();
	const [paintBox, moveBox, lookBox, oniBox] = await Promise.all(
		[
			b.page.getByTestId("veryare-sheet-open"),
			b.page.getByTestId("veryare-move-pad"),
			b.page.getByTestId("veryare-look-pad"),
			oniView,
		].map((locator) => locator.boundingBox()),
	);
	if (!paintBox || !moveBox || !lookBox || !oniBox) {
		throw new Error("部品の位置が取れない");
	}
	expect(paintBox.x).toBeGreaterThanOrEqual(moveBox.x + moveBox.width);
	expect(paintBox.x + paintBox.width).toBeLessThanOrEqual(lookBox.x);
	expect(oniBox.y + oniBox.height).toBeLessThan(paintBox.y);
	await b.page.getByTestId("veryare-sheet-open").click();
	await expect(sheet.getByTestId("veryare-oni-view")).toBeVisible();

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

test("クライアントの既定: 「新しく遊ぶ」のルームは動ける規則。ロビーの既定の選択も動ける（従来も選べる）", async ({
	openTab,
}) => {
	const a = await openTab();
	// ?rules=1 を付けない来場者（入口の覚えも無い）。
	await chooseVeryare(a.page);
	expect(
		await a.page.evaluate(() => localStorage.getItem("rondo.lobby.rules")),
	).toBeNull();
	await playNew(a);
	const created = a.link.sent("create-room").at(-1)?.message.settings as
		| Record<string, unknown>
		| undefined;
	expect(created?.roaming).toBe(1);
	await expect(a.page.getByTestId("veryare")).toHaveAttribute(
		"data-roaming",
		"true",
	);
	await expect(a.page.getByTestId("play-rules")).toHaveText("動ける");

	const b = await openTab();
	await b.page.goto("/lobby/veryare");
	const roaming = b.page.getByTestId("lobby-option-roaming");
	await expect(roaming).toHaveValue("1");
	await expect(b.page.getByTestId("lobby-option-spreading")).toHaveValue("0");
	await expect(roaming.locator("option")).toHaveText([
		"その場から動けない（従来）",
		"動ける（新）",
	]);
});
