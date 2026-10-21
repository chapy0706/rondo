import type { RoomSummary } from "@rondo/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomListItem } from "./RoomListItem";
import { availabilityLabel, roomAvailability } from "./roomAvailability";
import { SPECTATE_READY, spectateAllowed } from "./spectateFlag";

/**
 * ロビーの一覧の観戦ルームの行（issue-67）。spectate: true の行は「観戦」と出し、押すと観戦者として入る
 * （外側の電文は変えない。入り方は、ふつうの参加と同じ）。旗 SPECTATE_READY（既定 false）が下りている間は、
 * 行が出ても押せない（開発用の NEXT_PUBLIC_RONDO_SPECTATE_DEV=1 のときだけ押せる）。
 */

const noop = () => {};

const spectateRoom: RoomSummary = {
	roomId: "room-5",
	gameType: "veryare",
	name: "観戦ルーム",
	playerCount: 2,
	capacity: 20,
	status: "playing",
	spectate: true,
};

describe("観戦ルームの行の状態（issue-67）", () => {
	it("観戦ルームは、試合中でも「観戦」（プレイ中にしない）", () => {
		expect(roomAvailability(spectateRoom)).toBe("spectate");
		expect(availabilityLabel("spectate")).toBe("観戦");
	});

	it("観戦者が上限に達していれば、満員", () => {
		expect(roomAvailability({ ...spectateRoom, playerCount: 20 })).toBe("full");
	});

	it("spectate の無い行は、これまでどおり", () => {
		const { spectate: _, ...plain } = spectateRoom;
		expect(roomAvailability(plain)).toBe("playing");
	});
});

describe("旗 SPECTATE_READY（issue-67）", () => {
	it("既定は下りている。開発用の値が 1 のときだけ、観戦できる", () => {
		expect(SPECTATE_READY).toBe(false);
		expect(spectateAllowed(false, undefined)).toBe(false);
		expect(spectateAllowed(false, "0")).toBe(false);
		expect(spectateAllowed(false, "1")).toBe(true);
		expect(spectateAllowed(true, undefined)).toBe(true);
	});
});

describe("RoomListItem - 観戦ルームの行（issue-67）", () => {
	it("「観戦」と出し、旗が上がっていれば押せる", () => {
		const html = renderToStaticMarkup(
			<RoomListItem
				room={spectateRoom}
				disabled={false}
				onJoin={noop}
				canSpectate
			/>,
		);
		expect(html).toContain('data-availability="spectate"');
		expect(html).toContain("観戦");
		expect(html).toContain("2/20");
		expect(html).not.toContain('disabled=""');
	});

	it("旗が下りていれば、行が出ても押せない", () => {
		const html = renderToStaticMarkup(
			<RoomListItem
				room={spectateRoom}
				disabled={false}
				onJoin={noop}
				canSpectate={false}
			/>,
		);
		expect(html).toContain('data-availability="spectate"');
		expect(html).toContain('disabled=""');
	});

	it("返事を待っている間は、旗が上がっていても押せない", () => {
		const html = renderToStaticMarkup(
			<RoomListItem room={spectateRoom} disabled onJoin={noop} canSpectate />,
		);
		expect(html).toContain('disabled=""');
	});
});
