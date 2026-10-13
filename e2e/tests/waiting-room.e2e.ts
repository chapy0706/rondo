/**
 * 待機ルームのメンバーの同期（issue-59 / ADR 0044）。2つのタブで、お互いの体が1人ずつ見え、待機
 * ポーズの変更が相手の画面に反映され、ステージに移ったあとは 0 人になることを、描画の入れ物の属性
 * （data-visible-members・data-member-poses）で確かめる。
 *
 * make e2e は素材なし（仮のカプセル）で起動するので、待機ルームのポーズボタンは出ない。待機ポーズの
 * 変更と移動は、そのタブの接続からサーバーへの電文で代える（判定はサーバーがいつもどおり行う）。
 */

import { expect } from "@playwright/test";
import {
	changeWaitingPose,
	expectArea,
	expectMemberPoses,
	expectPhase,
	expectVisibleMembers,
	moveInWaitingRoom,
	receivedPayloads,
	roomWithTwo,
	test,
	touchArea,
} from "./flows";

test("待機ルームで、お互いが1人ずつ見え、待機ポーズが相手に届き、ステージに移ると0人になる", async ({
	openTab,
}) => {
	const { a, b, roomId } = await roomWithTwo(openTab);
	await expectArea(a, "green");

	// お互いが1人ずつ見える（自分は数えない）。待機ポーズはまだ選んでいない。
	await expectVisibleMembers(a, 1);
	await expectVisibleMembers(b, 1);
	await expectMemberPoses(a, "-");

	// B が動き、待機ポーズを変えると、A の画面に反映される。
	moveInWaitingRoom(b, roomId, 1.5, 1);
	changeWaitingPose(b, roomId, "femaleDance");
	await expectMemberPoses(a, "femaleDance");
	// サーバーの持つ位置（円に丸めた後）が、通知で届いている。
	await expect
		.poll(() => {
			const latest = receivedPayloads(a, "members").at(-1);
			const members = (latest?.members ?? []) as {
				x?: unknown;
				z?: unknown;
				pose?: unknown;
			}[];
			return members.find((m) => m.pose === "femaleDance");
		})
		.toMatchObject({ x: 1.5, z: 1 });

	// A が立候補し、カウント（10 秒）のあとステージへ移ると、どちらの画面でも 0 人になる。
	touchArea(a, roomId);
	await expectArea(b, "blue");
	await expectPhase(a, "preparation", 20_000);
	await expectVisibleMembers(a, 0);
	await expectVisibleMembers(b, 0);
	// 移ったあとも、待機の通知は増えない（サーバーが止める）。
	const before = receivedPayloads(b, "members").length;
	await b.page.waitForTimeout(1_000);
	expect(receivedPayloads(b, "members").length).toBe(before);
});
