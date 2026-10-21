import type { PlayerInfo } from "@rondo/contracts";
import { GameHostProvider, type RealtimeHost } from "@rondo/game-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Veryare from "./Veryare";

/**
 * 観戦の画面（issue-67）。観戦ルームの観戦者（自分が参加者の一覧に載らない）として開くと、観戦の画面に
 * なり、操作の部品（移動・視点のパッド、撃つ、襖、ポーズ、塗る）は出さない。追う相手の選択（鬼・隠れ）と、
 * E2E 用の画面の属性を出す。
 */

const cpus: PlayerInfo[] = [
	{ playerId: "cpu-1", name: "CPU 1" },
	{ playerId: "cpu-2", name: "CPU 2" },
	{ playerId: "cpu-3", name: "CPU 3" },
];

function render(you: string): string {
	const realtime: RealtimeHost = {
		port: { send: () => {}, subscribe: () => () => {} },
		roomId: "room-1",
		you,
		players: cpus,
	};
	return renderToStaticMarkup(
		<GameHostProvider value={{ reportResult: () => {}, realtime }}>
			<Veryare />
		</GameHostProvider>,
	);
}

const CONTROLS = [
	"veryare-move-pad",
	"veryare-look-pad",
	"veryare-shoot",
	"veryare-open-door",
	"veryare-pose",
	"veryare-game-pose",
	"veryare-waiting-pose",
	"veryare-paint",
	"veryare-sheet",
];

describe("観戦の画面（issue-67）", () => {
	it("観戦者として開くと、観戦の画面の属性を出す", () => {
		const html = render("s-1");
		expect(html).toContain('data-testid="veryare-spectate"');
		expect(html).toContain('data-spectating="true"');
		expect(html).toContain('data-visible-actors="0"');
		// 鬼が分かる前は、全員を隠れの番号で並べ、最初の人を追う。
		expect(html).toContain('data-follow-target="cpu-1"');
	});

	it("操作の部品は出さない", () => {
		const html = render("s-1");
		for (const id of CONTROLS) {
			expect(html).not.toContain(`data-testid="${id}"`);
		}
	});

	it("追う相手を、横にスクロールできる選択で出す", () => {
		const html = render("s-1");
		expect(html).toContain('data-testid="spectate-follow-list"');
		expect(html.match(/data-testid="spectate-follow"/g)?.length).toBe(3);
		expect(html).toContain("隠れ 1");
		expect(html).toContain("試合の始まりを待っています");
	});
});
