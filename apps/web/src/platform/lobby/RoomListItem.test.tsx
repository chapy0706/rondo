import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomListItem } from "./RoomListItem";

const noop = () => {};

const room = {
	roomId: "room-0123456789abcdef",
	gameType: "veryare",
	playerCount: 2,
	capacity: 5,
	status: "waiting",
} as const;

describe("RoomListItem - ルーム一覧の1行（issue-58）", () => {
	it("名前・人数・状態を出し、識別子は出さない", () => {
		const html = renderToStaticMarkup(
			<RoomListItem
				room={{ ...room, name: "たのしい部屋" }}
				disabled={false}
				onJoin={noop}
			/>,
		);
		expect(html).toContain("たのしい部屋");
		expect(html).toContain("2/5");
		expect(html).toContain("待機中");
		expect(html).not.toContain(room.roomId);
	});

	it("名前の HTML の記号は、そのまま文字として出す", () => {
		const html = renderToStaticMarkup(
			<RoomListItem
				room={{ ...room, name: "<b>&amp;</b>" }}
				disabled={false}
				onJoin={noop}
			/>,
		);
		expect(html).toContain("&lt;b&gt;&amp;amp;&lt;/b&gt;");
		expect(html).not.toContain("<b>");
	});

	it("名前のない古い形でも、識別子は出さない", () => {
		const html = renderToStaticMarkup(
			<RoomListItem
				room={{ ...room, status: "playing" }}
				disabled
				onJoin={noop}
			/>,
		);
		expect(html).toContain("名前のないルーム");
		expect(html).toContain("進行中");
		expect(html).not.toContain(room.roomId);
	});
});
