import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { noticeFor } from "../session/serverErrors";
import { LobbyNotice } from "./LobbyNotice";

const noop = () => {};
const render = (code: string) =>
	renderToStaticMarkup(
		<LobbyNotice
			notice={noticeFor(code)}
			onRefresh={noop}
			onReload={noop}
			onRetry={noop}
		/>,
	);

describe("LobbyNotice - ロビーの案内の枠（issue-60）", () => {
	it("ルームがいっぱい: 案内と、ひとり用のゲームの一覧と、更新のボタン。種類は data-code に出す", () => {
		const html = render("room-limit");
		expect(html).toContain('data-testid="lobby-notice"');
		expect(html).toContain('data-code="room-limit"');
		expect(html).toContain("いまは、ルームがいっぱいです");
		expect(html).toContain('data-testid="lobby-solo-games"');
		expect(html).toContain("一覧を更新");
	});

	it("前のルームに入ったまま: 「読み込み直す」のボタン", () => {
		const html = render("already-in-room");
		expect(html).toContain("読み込み直す");
		expect(html).not.toContain('data-testid="lobby-solo-games"');
	});

	it("知らない種類: 既定の文言と「もう一度」。サーバーの文は出さない", () => {
		const html = render("mystery");
		expect(html).toContain("うまくつながりません。もう一度お試しください");
		expect(html).toContain("もう一度");
	});

	it("参加の競合: 文言だけ（一覧は、取り直してある）", () => {
		const html = render("room-full");
		expect(html).toContain("ちょうど満員になりました");
		expect(html).not.toContain("<button");
	});
});
