import { GameHostProvider, VirtualPadProvider } from "@rondo/game-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TiltMaze from "./TiltMaze";
import { tiltMazeManifest } from "./manifest";

function render(): string {
	return renderToStaticMarkup(
		<GameHostProvider value={{ reportResult: () => {}, realtime: null }}>
			<VirtualPadProvider>
				<TiltMaze />
			</VirtualPadProvider>
		</GameHostProvider>,
	);
}

describe("rolling の画面（issue-36）", () => {
	it("開くとまずモード選択が出て、本編（迷路）はまだ始まらない", () => {
		const html = render();
		expect(html).toContain("1人モード");
		expect(html).toContain("対戦モード");
		expect(html).not.toContain("<canvas");
	});

	it("画面上の名前は rolling で、内部の gameType は tilt-maze のまま", () => {
		expect(tiltMazeManifest.title).toBe("rolling");
		expect(tiltMazeManifest.id).toBe("tilt-maze");
		expect(JSON.stringify(tiltMazeManifest)).not.toMatch(/Tilt ?Maze/i);
	});
});
