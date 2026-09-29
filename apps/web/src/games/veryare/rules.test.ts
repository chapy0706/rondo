import { describe, expect, it } from "vitest";
import {
	ONI_AREA_RADIUS,
	type Phase,
	STAGE_HALF,
	WAITING_ROOM_HALF,
	canMove,
	canPaintWhileWaiting,
	halfWidthOf,
	parsePhaseNotice,
	parseRoomInfo,
	roleOf,
	spaceOf,
	spawnOf,
	stepPosition,
} from "./rules";

const phases: readonly Phase[] = [
	"oni-selection",
	"preparation",
	"painting",
	"exploration",
	"ended",
];

describe("parsePhaseNotice - サーバー（room.gleam）のフェーズ通知を検証して読む", () => {
	it("正しい通知を読む", () => {
		expect(
			parsePhaseNotice({
				type: "phase",
				phase: "preparation",
				durationMs: 20000,
				oni: "p1",
				outcome: null,
			}),
		).toEqual({
			phase: "preparation",
			durationMs: 20000,
			oni: "p1",
			outcome: null,
		});
	});

	it("終了の通知は勝敗を持つ", () => {
		expect(
			parsePhaseNotice({
				type: "phase",
				phase: "ended",
				durationMs: null,
				oni: "p1",
				outcome: "oni-wins",
			})?.outcome,
		).toBe("oni-wins");
	});

	it("知らないフェーズ・形の違う値は捨てる", () => {
		const base = {
			type: "phase",
			phase: "painting",
			durationMs: 1,
			oni: null,
			outcome: null,
		};
		expect(parsePhaseNotice({ ...base, phase: "dance" })).toBeNull();
		expect(parsePhaseNotice({ ...base, durationMs: "1" })).toBeNull();
		expect(parsePhaseNotice({ ...base, oni: 1 })).toBeNull();
		expect(parsePhaseNotice({ ...base, outcome: "draw" })).toBeNull();
		expect(parsePhaseNotice({ ...base, type: "room-info" })).toBeNull();
		expect(parsePhaseNotice(null)).toBeNull();
	});
});

describe("parseRoomInfo - 入室後の案内（探索時間）", () => {
	it("探索時間を読む", () => {
		expect(
			parseRoomInfo({ type: "room-info", explorationSeconds: 60 }),
		).toEqual({ explorationSeconds: 60 });
	});

	it("形の違う値は捨てる", () => {
		expect(
			parseRoomInfo({ type: "room-info", explorationSeconds: "60" }),
		).toBeNull();
		expect(parseRoomInfo({ type: "phase" })).toBeNull();
	});
});

describe("roleOf - 自分の役割", () => {
	it("鬼が決まる前は未定、決まれば鬼か隠れ側", () => {
		expect(roleOf(null, "me")).toBe("undecided");
		expect(roleOf("me", "me")).toBe("oni");
		expect(roleOf("other", "me")).toBe("hider");
		expect(roleOf("other", null)).toBe("undecided");
	});
});

describe("spaceOf - 自分がいる空間（ADR 0024）", () => {
	it("鬼選出中は全員が待機ルーム", () => {
		expect(spaceOf("oni-selection", "undecided")).toBe("waiting-room");
	});

	it("準備・ペイント中、隠れ側はステージ、鬼は待機ルームに残る", () => {
		for (const phase of ["preparation", "painting"] as const) {
			expect(spaceOf(phase, "hider")).toBe("stage");
			expect(spaceOf(phase, "oni")).toBe("waiting-room");
		}
	});

	it("探索開始で鬼もステージへ移る", () => {
		expect(spaceOf("exploration", "oni")).toBe("stage");
		expect(spaceOf("exploration", "hider")).toBe("stage");
	});

	it("鬼が決まらないまま終わったら待機ルームのまま", () => {
		expect(spaceOf("ended", "undecided")).toBe("waiting-room");
	});
});

describe("canMove - 移動入力を受け付けるか", () => {
	it("探索フェーズ中、隠れ側は動けない（クライアント側でも無視する）", () => {
		expect(canMove("exploration", "hider")).toBe(false);
		expect(canMove("exploration", "oni")).toBe(true);
	});

	it("終了後は誰も動けない", () => {
		expect(canMove("ended", "oni")).toBe(false);
		expect(canMove("ended", "hider")).toBe(false);
	});

	it("それ以外のフェーズでは動ける", () => {
		for (const phase of ["oni-selection", "preparation", "painting"] as const) {
			expect(canMove(phase, "hider")).toBe(true);
			expect(canMove(phase, "oni")).toBe(true);
		}
		expect(canMove("oni-selection", "undecided")).toBe(true);
	});
});

describe("canPaintWhileWaiting - 鬼の待機中ペイント", () => {
	it("鬼だけが、準備・ペイント中に塗れる", () => {
		for (const phase of phases) {
			const expected = phase === "preparation" || phase === "painting";
			expect(canPaintWhileWaiting(phase, "oni")).toBe(expected);
			expect(canPaintWhileWaiting(phase, "hider")).toBe(false);
		}
	});
});

describe("stepPosition - 移動の計算", () => {
	it("パッドの上（y < 0）でカメラの向いている方へ進む", () => {
		// yaw 0 のカメラは -z 方向を向く。
		const next = stepPosition({ x: 0, z: 0 }, { x: 0, y: -1 }, 0, 2, 0.5, 5);
		expect(next.x).toBeCloseTo(0);
		expect(next.z).toBeCloseTo(-1);
	});

	it("カメラを右に90度回すと、前進は +x 方向になる", () => {
		const next = stepPosition(
			{ x: 0, z: 0 },
			{ x: 0, y: -1 },
			-Math.PI / 2,
			2,
			0.5,
			5,
		);
		expect(next.x).toBeCloseTo(1);
		expect(next.z).toBeCloseTo(0);
	});

	it("空間の範囲の外へは出ない", () => {
		expect(
			stepPosition(
				{ x: 1.7, z: 0 },
				{ x: 1, y: 0 },
				0,
				10,
				1,
				WAITING_ROOM_HALF,
			),
		).toEqual({ x: WAITING_ROOM_HALF, z: 0 });
	});
});

describe("空間の大きさと初期位置", () => {
	it("待機ルームは約3.6m四方、ステージは仮に10m四方", () => {
		expect(halfWidthOf("waiting-room")).toBe(WAITING_ROOM_HALF);
		expect(halfWidthOf("stage")).toBe(STAGE_HALF);
		expect(WAITING_ROOM_HALF * 2).toBeCloseTo(3.6);
	});

	it("待機ルームの初期位置は鬼希望エリアの外（入らなければ立候補にならない）", () => {
		const { x, z } = spawnOf("waiting-room");
		expect(Math.hypot(x, z)).toBeGreaterThan(ONI_AREA_RADIUS);
		expect(Math.abs(x)).toBeLessThanOrEqual(WAITING_ROOM_HALF);
		expect(Math.abs(z)).toBeLessThanOrEqual(WAITING_ROOM_HALF);
	});
});
