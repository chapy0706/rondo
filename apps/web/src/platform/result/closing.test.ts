import { describe, expect, it } from "vitest";
import { closingDeadline, closingText, secondsUntil } from "./closing";

describe("結果画面の、ルームが閉じるまでの残り（issue-70）", () => {
	it("閉じる時刻は、受け取った時刻 + 残り。残りが無ければ null（表示しない）", () => {
		expect(closingDeadline(180000, 1000)).toBe(181000);
		expect(closingDeadline(null, 1000)).toBeNull();
	});

	it("残りの秒は切り上げ。過ぎていれば 0", () => {
		expect(secondsUntil(181000, 1000)).toBe(180);
		expect(secondsUntil(181000, 1001)).toBe(180);
		expect(secondsUntil(181000, 180001)).toBe(1);
		expect(secondsUntil(181000, 181000)).toBe(0);
		expect(secondsUntil(181000, 999999)).toBe(0);
	});

	it("表示の文", () => {
		expect(closingText(42)).toBe("あと 42 秒で、ロビーへ戻ります");
		expect(closingText(0)).toBe("まもなく、ロビーへ戻ります");
	});
});
