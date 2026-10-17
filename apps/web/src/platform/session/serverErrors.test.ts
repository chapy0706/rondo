import { describe, expect, it } from "vitest";
import { DEFAULT_NOTICE, SERVER_ERROR_CODES, noticeFor } from "./serverErrors";

describe("noticeFor - サーバーのエラーの種類を、やさしい文言と次の行動に直す（issue-60）", () => {
	it("サーバーが返す種類は、すべて、既定ではない文言を持つ", () => {
		// server/src/rondo_server/connection/（session.gleam・connection.gleam・websocket.gleam）が返す全部。
		expect([...SERVER_ERROR_CODES].sort()).toEqual(
			[
				"already-in-room",
				"already-joined",
				"bad-message",
				"game-already-started",
				"invalid-settings",
				"reconnect-failed",
				"room-closed",
				"room-full",
				"room-limit",
				"room-not-found",
				"server-error",
				"unknown-game",
			].sort(),
		);
		for (const code of SERVER_ERROR_CODES) {
			const notice = noticeFor(code);
			expect(notice.code, code).toBe(code);
			expect(notice.text.length, code).toBeGreaterThan(0);
		}
	});

	it("知らない種類は、「うまくつながりません。もう一度お試しください」に落ちる", () => {
		expect(noticeFor("something-new")).toEqual({
			...DEFAULT_NOTICE,
			code: "something-new",
		});
		expect(DEFAULT_NOTICE.text).toBe(
			"うまくつながりません。もう一度お試しください",
		);
		expect(DEFAULT_NOTICE.actions).toEqual(["retry"]);
	});

	it("ルームがいっぱい: 少し待つか、ひとり用のゲームへ", () => {
		const notice = noticeFor("room-limit");
		expect(notice.text).toBe(
			"いまは、ルームがいっぱいです。少し待つか、ひとり用のゲームで遊んでください",
		);
		expect(notice.actions).toEqual(["solo", "refresh"]);
	});

	it("参加の競合（満員・始まった・もう無い）は、一覧を取り直す", () => {
		expect(noticeFor("room-full").text).toBe(
			"ちょうど満員になりました。ほかのルームを選んでください",
		);
		for (const code of [
			"room-full",
			"game-already-started",
			"room-not-found",
		]) {
			expect(noticeFor(code).refreshList, code).toBe(true);
		}
		expect(noticeFor("room-limit").refreshList).toBe(true);
		expect(noticeFor("server-error").refreshList).toBe(false);
	});

	it("前のルームに入ったまま: 読み込み直す。ルームが閉じた・戻れない: ロビーへ", () => {
		expect(noticeFor("already-in-room").actions).toEqual(["reload"]);
		expect(noticeFor("room-closed").actions).toEqual(["lobby"]);
		expect(noticeFor("reconnect-failed").actions).toEqual(["lobby"]);
	});
});
