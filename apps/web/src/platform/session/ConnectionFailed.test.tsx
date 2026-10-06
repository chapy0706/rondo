import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionFailed } from "./ConnectionFailed";

const noop = () => {};

describe("ConnectionFailed - つながらないときの表示（issue-47）", () => {
	it("「つながりません」と、もう一度・ロビーへ・ゲーム選択へを出す", () => {
		const html = renderToStaticMarkup(
			<ConnectionFailed onRetry={noop} onLobby={noop} onSelect={noop} />,
		);
		expect(html).toContain("つながりません");
		expect(html).toContain("もう一度");
		expect(html).toContain("ロビーへ");
		expect(html).toContain("ゲーム選択へ");
	});

	it("ロビーの操作を渡さなければ、ロビーへは出さない（ロビーの中・ロビーのないゲーム）", () => {
		const html = renderToStaticMarkup(
			<ConnectionFailed onRetry={noop} onSelect={noop} />,
		);
		expect(html).not.toContain("ロビーへ");
		expect(html).toContain("もう一度");
	});
});
