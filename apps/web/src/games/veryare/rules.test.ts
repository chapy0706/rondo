import type { VeryareShootEvent } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import {
	ONI_AREA_RADIUS,
	type Phase,
	SHOT_RELOAD_MS,
	WAITING_ROOM_RADIUS,
	WAITING_ROOM_SPAWN,
	areaLook,
	canMove,
	canPaintWhileWaiting,
	canShoot,
	clampToWaitingRoom,
	facingOfYaw,
	foundByShot,
	isSpectator,
	moveReport,
	parseHidersNotice,
	parseHidingNotice,
	parseOniNotice,
	parsePhaseNotice,
	parseRoomInfo,
	reloadRemainingMs,
	roleOf,
	shootEvent,
	spaceOf,
	viewOf,
	walkTarget,
	yawOfFacing,
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

describe("clampToWaitingRoom - 待機ルームは半径2mの円", () => {
	it("円の外は、円周に丸める。内側はそのまま", () => {
		const p = clampToWaitingRoom({ x: 6, z: 0 });
		expect(p.x).toBeCloseTo(WAITING_ROOM_RADIUS);
		expect(p.z).toBeCloseTo(0);
		const q = clampToWaitingRoom({ x: 3, z: 3 });
		expect(Math.hypot(q.x, q.z)).toBeCloseTo(WAITING_ROOM_RADIUS);
		expect(clampToWaitingRoom({ x: 1, z: -1 })).toEqual({ x: 1, z: -1 });
	});
});

describe("walkTarget - 進もうとする位置", () => {
	it("パッドの上（y < 0）でカメラの向いている方へ進む", () => {
		// yaw 0 のカメラは -z 方向を向く。
		const next = walkTarget({ x: 0, z: 0 }, { x: 0, y: -1 }, 0, 2, 0.5);
		expect(next.x).toBeCloseTo(0);
		expect(next.z).toBeCloseTo(-1);
	});

	it("カメラを右に90度回すと、前進は +x 方向になる", () => {
		const next = walkTarget(
			{ x: 0, z: 0 },
			{ x: 0, y: -1 },
			-Math.PI / 2,
			2,
			0.5,
		);
		expect(next.x).toBeCloseTo(1);
		expect(next.z).toBeCloseTo(0);
	});
});

describe("初期位置", () => {
	it("待機ルームの初期位置は鬼希望エリアの外で、円の内側（入らなければ立候補にならない）", () => {
		const { x, z } = WAITING_ROOM_SPAWN;
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

describe("観戦（issue-28）", () => {
	const oni = {
		type: "oni",
		playerId: "cpu-1",
		x: 3.5,
		z: 10.5,
		facing: -1.57,
		pose: "standing",
		openDoors: [{ a: { x: 2, z: 2 }, b: { x: 3, z: 2 } }],
	};

	it("鬼の状態の通知を検証して読む", () => {
		expect(parseOniNotice(oni)).toEqual(oni);
		expect(parseOniNotice({ ...oni, x: "1" })).toBeNull();
		expect(parseOniNotice({ ...oni, pose: "jump" })).toBeNull();
		expect(parseOniNotice({ ...oni, openDoors: [{ a: 1 }] })).toBeNull();
		// 襖は境 {a, b} で指す（issue-29b）。前の {corridor, slot} の形は読まない。
		expect(
			parseOniNotice({
				...oni,
				openDoors: [{ corridor: { x: 3, z: 2 }, slot: { x: 2, z: 2 } }],
			}),
		).toBeNull();
		expect(parseOniNotice({ type: "hiders" })).toBeNull();
	});

	it("まだ隠れている一覧の通知を検証して読む", () => {
		expect(
			parseHidingNotice({ type: "hiding", playerIds: ["a", "b"] }),
		).toEqual({ playerIds: ["a", "b"] });
		expect(parseHidingNotice({ type: "hiding", playerIds: [1] })).toBeNull();
		expect(parseHidingNotice({ type: "oni" })).toBeNull();
	});

	it("一覧から外れた隠れ側は観戦になる（見つかった・失格）。鬼や、一覧に残る人はならない", () => {
		expect(isSpectator("exploration", "hider", ["b"], "a")).toBe(true);
		expect(isSpectator("painting", "hider", [], "a")).toBe(true);
		expect(isSpectator("exploration", "hider", ["a"], "a")).toBe(false);
		expect(isSpectator("exploration", "oni", [], "a")).toBe(false);
		// 一覧がまだ届いていなければ観戦にしない。
		expect(isSpectator("exploration", "hider", null, "a")).toBe(false);
		// 答え合わせ・終了は全員が同じ景色を見るので、観戦の扱いはしない。
		expect(isSpectator("reveal", "hider", [], "a")).toBe(false);
	});

	it("鬼 TPS 視点になるのは、探索中に鬼の状態が届いていて、観戦者か、選んだ隠れ側", () => {
		const base = { phase: "exploration", oniKnown: true } as const;
		expect(
			viewOf({ ...base, role: "hider", spectator: true, choseOni: false }),
		).toBe("oni");
		expect(
			viewOf({ ...base, role: "hider", spectator: false, choseOni: true }),
		).toBe("oni");
		expect(
			viewOf({ ...base, role: "hider", spectator: false, choseOni: false }),
		).toBe("self");
		// 鬼自身は常に自分の視点。
		expect(
			viewOf({ ...base, role: "oni", spectator: false, choseOni: true }),
		).toBe("self");
		// 鬼の状態がまだ届いていなければ、自分の視点のまま。
		expect(
			viewOf({
				...base,
				oniKnown: false,
				role: "hider",
				spectator: true,
				choseOni: false,
			}),
		).toBe("self");
		expect(
			viewOf({
				...base,
				phase: "painting",
				role: "hider",
				spectator: true,
				choseOni: false,
			}),
		).toBe("self");
	});

	it("観戦者は移動できない", () => {
		expect(canMove("exploration", "hider")).toBe(false);
	});

	it("カメラの向き（yaw）とサーバーの向き（facing）を相互に変換する", () => {
		// yaw 0 は -z を向く。サーバーの向きでは -π/2。
		expect(facingOfYaw(0)).toBeCloseTo(-Math.PI / 2);
		// yaw π/2 は -x を向く。サーバーの向きでは π。
		expect(Math.abs(facingOfYaw(Math.PI / 2))).toBeCloseTo(Math.PI);
		for (const yaw of [-2, -0.5, 0, 1, 2.5]) {
			expect(yawOfFacing(facingOfYaw(yaw))).toBeCloseTo(yaw);
		}
	});

	it("移動の報告に向きを載せられる", () => {
		expect(moveReport({ x: 1, z: 2 }, 0.5)).toEqual({
			type: "move",
			x: 1,
			z: 2,
			facing: 0.5,
		});
		expect(moveReport({ x: 1, z: 2 })).toEqual({ type: "move", x: 1, z: 2 });
	});
});

describe("射撃（issue-27）- 鬼の画面の判断", () => {
	it("撃てるのは、探索フェーズの鬼だけ（観戦中は撃てない）", () => {
		expect(canShoot("exploration", "oni", false)).toBe(true);
		expect(canShoot("exploration", "hider", false)).toBe(false);
		expect(canShoot("exploration", "oni", true)).toBe(false);
		for (const phase of [
			"oni-selection",
			"preparation",
			"painting",
			"reveal",
			"ended",
		] as const) {
			expect(canShoot(phase, "oni", false)).toBe(false);
		}
	});

	it("撃つ間隔は 3 秒。撃ってからの残りを、自分のタイマーで数える", () => {
		expect(SHOT_RELOAD_MS).toBe(3000);
		expect(reloadRemainingMs(null, 10_000)).toBe(0);
		expect(reloadRemainingMs(10_000, 10_000)).toBe(3000);
		expect(reloadRemainingMs(10_000, 11_500)).toBe(1500);
		expect(reloadRemainingMs(10_000, 13_000)).toBe(0);
		expect(reloadRemainingMs(10_000, 20_000)).toBe(0);
	});

	it("申告は契約の形（VeryareShootEvent）。照準に何もなければ target は null", () => {
		const hit: VeryareShootEvent = shootEvent("p-2");
		expect(hit).toEqual({ type: "shoot", target: "p-2" });
		expect(shootEvent(null)).toEqual({ type: "shoot", target: null });
	});

	it("撃った相手が、まだ隠れている一覧から外れたら、見つけたと分かる", () => {
		expect(foundByShot("p-2", ["p-2", "p-3"], ["p-3"])).toBe(true);
		// 狙いなし・もともと外れていた・まだ一覧にいる、は見つけたことにしない。
		expect(foundByShot(null, ["p-2"], [])).toBe(false);
		expect(foundByShot("p-2", ["p-3"], ["p-3"])).toBe(false);
		expect(foundByShot("p-2", ["p-2", "p-3"], ["p-2", "p-3"])).toBe(false);
		expect(foundByShot("p-2", null, ["p-3"])).toBe(false);
	});
});
