import { describe, expect, it } from "vitest";
import {
	ONI_AREA_RADIUS,
	type Phase,
	STAGE_HALF,
	WAITING_ROOM_RADIUS,
	areaLook,
	canMove,
	canPaintWhileWaiting,
	clampToSpace,
	parseHidersNotice,
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
	"reveal",
	"ended",
];

const notice = {
	type: "phase",
	phase: "painting",
	durationMs: 1,
	oni: null,
	outcome: null,
	area: null,
};

describe("parsePhaseNotice - サーバー（room.gleam）のフェーズ通知を検証して読む", () => {
	it("正しい通知を読む", () => {
		expect(
			parsePhaseNotice({
				...notice,
				phase: "preparation",
				durationMs: 20000,
				oni: "p1",
			}),
		).toEqual({
			phase: "preparation",
			durationMs: 20000,
			oni: "p1",
			outcome: null,
			area: null,
		});
	});

	it("鬼選出中はエリアの色（waiting / ready / counting）を持つ", () => {
		for (const area of ["waiting", "ready", "counting"] as const) {
			expect(
				parsePhaseNotice({
					...notice,
					phase: "oni-selection",
					durationMs: null,
					area,
				})?.area,
			).toBe(area);
		}
	});

	it("答え合わせと終了の通知は勝敗を持つ", () => {
		expect(
			parsePhaseNotice({
				...notice,
				phase: "reveal",
				durationMs: 20000,
				oni: "p1",
				outcome: "hiders-win",
			}),
		).toMatchObject({ phase: "reveal", outcome: "hiders-win" });
		expect(
			parsePhaseNotice({
				...notice,
				phase: "ended",
				durationMs: null,
				outcome: "oni-wins",
			})?.outcome,
		).toBe("oni-wins");
	});

	it("知らないフェーズ・形の違う値は捨てる", () => {
		expect(parsePhaseNotice({ ...notice, phase: "dance" })).toBeNull();
		expect(parsePhaseNotice({ ...notice, durationMs: "1" })).toBeNull();
		expect(parsePhaseNotice({ ...notice, oni: 1 })).toBeNull();
		expect(parsePhaseNotice({ ...notice, outcome: "draw" })).toBeNull();
		expect(parsePhaseNotice({ ...notice, area: "purple" })).toBeNull();
		expect(parsePhaseNotice({ ...notice, type: "room-info" })).toBeNull();
		expect(parsePhaseNotice(null)).toBeNull();
	});

	it("area が無い古い形の通知は、エリアなしとして読む", () => {
		const { area: _area, ...old } = notice;
		expect(parsePhaseNotice(old)?.area).toBeNull();
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

describe("areaLook - 鬼希望エリアの見た目（ADR 0024）", () => {
	it("赤・待機 / 緑・開始 / 青・鬼希望", () => {
		expect(areaLook("waiting")).toEqual({ color: "red", label: "待機" });
		expect(areaLook("ready")).toEqual({ color: "green", label: "開始" });
		expect(areaLook("counting")).toEqual({ color: "blue", label: "鬼希望" });
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

	it("探索開始で鬼もステージへ移り、答え合わせ・終了もステージ", () => {
		for (const phase of ["exploration", "reveal", "ended"] as const) {
			expect(spaceOf(phase, "oni")).toBe("stage");
			expect(spaceOf(phase, "hider")).toBe("stage");
		}
	});

	it("鬼が決まらないまま終わったら待機ルームのまま", () => {
		expect(spaceOf("ended", "undecided")).toBe("waiting-room");
	});
});

describe("canMove - 移動入力を受け付けるか", () => {
	it("準備移動の後（ペイント・探索）、隠れ側は動けない（クライアント側でも無視する）", () => {
		for (const phase of ["painting", "exploration"] as const) {
			expect(canMove(phase, "hider")).toBe(false);
			expect(canMove(phase, "oni")).toBe(true);
		}
	});

	it("答え合わせ・終了後は誰も動けない", () => {
		for (const phase of ["reveal", "ended"] as const) {
			expect(canMove(phase, "oni")).toBe(false);
			expect(canMove(phase, "hider")).toBe(false);
		}
	});

	it("鬼選出・準備移動では動ける", () => {
		for (const phase of ["oni-selection", "preparation"] as const) {
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

describe("clampToSpace - 空間の範囲（待機ルームは円柱形）", () => {
	it("待機ルームは半径2mの円。外に出ると円の縁へ寄せる", () => {
		expect(WAITING_ROOM_RADIUS).toBe(2);
		const p = clampToSpace("waiting-room", { x: 6, z: 0 });
		expect(p.x).toBeCloseTo(2);
		expect(p.z).toBeCloseTo(0);
		const q = clampToSpace("waiting-room", { x: 3, z: 3 });
		expect(Math.hypot(q.x, q.z)).toBeCloseTo(2);
	});

	it("円の内側ならそのまま", () => {
		expect(clampToSpace("waiting-room", { x: 1, z: -1 })).toEqual({
			x: 1,
			z: -1,
		});
	});

	it("ステージは仮の四角（issue-29 まで）", () => {
		expect(clampToSpace("stage", { x: 9, z: -9 })).toEqual({
			x: STAGE_HALF,
			z: -STAGE_HALF,
		});
	});
});

describe("stepPosition - 移動の計算", () => {
	it("パッドの上（y < 0）でカメラの向いている方へ進む", () => {
		// yaw 0 のカメラは -z 方向を向く。
		const next = stepPosition(
			{ x: 0, z: 0 },
			{ x: 0, y: -1 },
			0,
			2,
			0.5,
			"stage",
		);
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
			"stage",
		);
		expect(next.x).toBeCloseTo(1);
		expect(next.z).toBeCloseTo(0);
	});

	it("待機ルームの円の外へは出ない", () => {
		const next = stepPosition(
			{ x: 1.9, z: 0 },
			{ x: 1, y: 0 },
			0,
			10,
			1,
			"waiting-room",
		);
		expect(Math.hypot(next.x, next.z)).toBeCloseTo(WAITING_ROOM_RADIUS);
	});
});

describe("初期位置", () => {
	it("待機ルームの初期位置は鬼希望エリアの外で、円の内側（入らなければ立候補にならない）", () => {
		const { x, z } = spawnOf("waiting-room");
		expect(Math.hypot(x, z)).toBeGreaterThan(ONI_AREA_RADIUS);
		expect(Math.hypot(x, z)).toBeLessThan(WAITING_ROOM_RADIUS);
	});
});

describe("parseHidersNotice - 探索開始時の一括配信（issue-33）", () => {
	const cpu = {
		playerId: "cpu-1",
		x: 3.5,
		z: 10.5,
		facing: 1.2,
		pose: "crouching",
		paint: { kind: "uniform", color: "#b5a46a" },
	};
	const human = {
		playerId: "p-2",
		x: 0,
		z: 1,
		facing: null,
		pose: null,
		paint: null,
	};

	it("CPU の状態も、まだ状態を持たない人間（null）も読む", () => {
		expect(parseHidersNotice({ type: "hiders", hiders: [cpu, human] })).toEqual(
			{ type: "hiders", hiders: [cpu, human] },
		);
	});

	it("形が違えば null（境界での unknown 検証）", () => {
		expect(parseHidersNotice({ type: "phase" })).toBeNull();
		expect(parseHidersNotice({ type: "hiders", hiders: "x" })).toBeNull();
		expect(
			parseHidersNotice({ type: "hiders", hiders: [{ ...cpu, pose: "jump" }] }),
		).toBeNull();
		expect(
			parseHidersNotice({
				type: "hiders",
				hiders: [{ ...cpu, paint: { kind: "strokes" } }],
			}),
		).toBeNull();
		expect(
			parseHidersNotice({ type: "hiders", hiders: [{ ...cpu, x: "1" }] }),
		).toBeNull();
	});
});
