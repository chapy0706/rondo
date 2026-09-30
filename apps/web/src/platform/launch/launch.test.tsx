import type { GameManifest } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchGate } from "./LaunchGate";
import { LaunchScreen } from "./LaunchScreen";
import { needsLaunchScreen } from "./launch";

const shared: GameManifest = {
	id: "tetris",
	title: "テトリス",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	thumbnail: "/games/tetris.png",
	description: "",
	launchScreen: "shared",
	tagline: "積んで、揃えて、消す。",
	howToPlay: ["左右で動かす", "上で回転"],
};

const custom: GameManifest = { ...shared, id: "czz", launchScreen: "custom" };

const GAME = <p>GAME-BODY</p>;

/** ゲームホストと同じく、起動済みかどうかの初期値をマニフェストから決めて描く。 */
function renderGate(manifest: GameManifest): string {
	return renderToStaticMarkup(
		<LaunchGate
			manifest={manifest}
			launched={!needsLaunchScreen(manifest)}
			onStart={() => {}}
		>
			{GAME}
		</LaunchGate>,
	);
}

describe("needsLaunchScreen - 起動画面の振り分け", () => {
	it("shared は共通起動画面を挟み、custom は挟まない", () => {
		expect(needsLaunchScreen(shared)).toBe(true);
		expect(needsLaunchScreen(custom)).toBe(false);
	});
});

describe("LaunchGate - ゲームホストでの分岐", () => {
	it("shared のゲームは、はじめるを押すまで本編を出さない", () => {
		const html = renderGate(shared);
		expect(html).toContain("はじめる");
		expect(html).not.toContain("GAME-BODY");
	});

	it("custom のゲームは共通起動画面を経由せず、そのまま本編を出す", () => {
		const html = renderGate(custom);
		expect(html).toContain("GAME-BODY");
		expect(html).not.toContain("はじめる");
	});

	it("起動済みなら shared でも本編を出す（もう一度遊ぶ等）", () => {
		const html = renderToStaticMarkup(
			<LaunchGate manifest={shared} launched onStart={() => {}}>
				{GAME}
			</LaunchGate>,
		);
		expect(html).toContain("GAME-BODY");
	});
});

describe("LaunchScreen - 共通起動画面", () => {
	it("タイトル・タグライン・遊び方・はじめるを出す", () => {
		const html = renderToStaticMarkup(
			<LaunchScreen manifest={shared} onStart={() => {}} />,
		);
		expect(html).toContain("テトリス");
		expect(html).toContain("積んで、揃えて、消す。");
		expect(html).toContain("左右で動かす");
		expect(html).toContain("上で回転");
		expect(html).toContain("はじめる");
	});

	it("タイトル画像が無ければ、頭文字のフォールバックだけで描く", () => {
		const html = renderToStaticMarkup(
			<LaunchScreen manifest={shared} onStart={() => {}} />,
		);
		expect(html).toContain("テ");
		expect(html).not.toContain("background-image");
	});

	it("タイトル画像があれば、フォールバックの上に重ねる（実体が無くても崩れない）", () => {
		const html = renderToStaticMarkup(
			<LaunchScreen
				manifest={{ ...shared, titleScreenImage: "/games/tetris-title.png" }}
				onStart={() => {}}
			/>,
		);
		expect(html).toContain("/games/tetris-title.png");
		expect(html).toContain("テ");
	});

	it("タグライン・遊び方が無くても描ける", () => {
		const { tagline: _t, howToPlay: _h, ...bare } = shared;
		const html = renderToStaticMarkup(
			<LaunchScreen manifest={bare} onStart={() => {}} />,
		);
		expect(html).toContain("はじめる");
		expect(html).not.toContain("<ul");
	});
});
