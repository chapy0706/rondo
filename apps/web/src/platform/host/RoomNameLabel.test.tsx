import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomNameLabel } from "./RoomNameLabel";

describe("RoomNameLabel - ゲーム画面のルーム名（issue-58）", () => {
	it("ルーム名を出す", () => {
		expect(
			renderToStaticMarkup(<RoomNameLabel name="たのしい部屋" />),
		).toContain("たのしい部屋");
	});

	it("名前の HTML の記号は、そのまま文字として出す", () => {
		const html = renderToStaticMarkup(
			<RoomNameLabel name={'<img src=x onerror="alert(1)">&'} />,
		);
		expect(html).toContain(
			"&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;",
		);
		expect(html).not.toContain("<img");
	});
});
