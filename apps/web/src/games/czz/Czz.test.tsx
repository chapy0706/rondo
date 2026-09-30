import { GameHostProvider } from "@rondo/game-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Czz from "./Czz";
import { czzManifest } from "./manifest";

function render(): string {
	return renderToStaticMarkup(
		<GameHostProvider value={{ reportResult: () => {}, realtime: null }}>
			<Czz />
		</GameHostProvider>,
	);
}

describe("czz の起動画面（launchScreen: custom）", () => {
	it("マニフェストは自前の起動画面を宣言している", () => {
		expect(czzManifest.launchScreen).toBe("custom");
	});

	it("開くとまず czz 自身の起動画面が出て、出題はまだ始まらない", () => {
		const html = render();
		expect(html).toContain("スタート");
		expect(html).toContain("初心者モード");
		expect(html).toContain("クレジット");
		expect(html).not.toContain("採点");
	});

	it("初心者モードで始まり、タイトルは「指示厨ゲーム」を1文字ずつ出す", () => {
		const html = render();
		for (const ch of "指示厨ゲーム") expect(html).toContain(`>${ch}<`);
	});
});
