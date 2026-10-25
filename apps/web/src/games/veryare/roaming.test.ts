import type { VeryareHiderState, VeryareStroke } from "@rondo/contracts";
import { VERYARE_ROAMING } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import roamingFixture from "../../../../../packages/contracts/src/fixtures/veryare-roaming.json";
import { initialSettings } from "../../platform/lobby/roomOptions";
import { playCreateSettings } from "../registry";
import {
	type ControlsContext,
	canMoveNow,
	controlsFor,
	roleIn,
	viewOf,
} from "./controls";
import {
	ROAMING_DEFAULT,
	ROAMING_ENABLED,
	ROAMING_READY,
	SPREADING_ENABLED,
	SPREADING_READY,
	veryareManifest,
	veryarePlaySettings,
	veryareRoomOptions,
} from "./manifest";
import { WALK_SPEED } from "./motion";
import { canEditPaint } from "./paint";
import { avatarPoseFixed } from "./poseChoice";
import { canChangePose } from "./poses";
import {
	LOOK_SEND_INTERVAL_MS,
	NO_ROAMING,
	ROAMING_DELAY_MS,
	ROAMING_HIDER_SPEED,
	ROAMING_INTERVAL_MS,
	applyLook,
	applyOtherOnis,
	applyRoamingNotice,
	lookDue,
	parseLookNotice,
	parseRoamingNotice,
	placeRoaming,
	roamingHiderSpeed,
	roamingInPhase,
	roamingOfRoomInfo,
	spreadingOfRoomInfo,
	walkSpeedOf,
} from "./roaming";
import { type Phase, canMove, parseOniNotice } from "./rules";
import { mirrorMove } from "./stage";

const phase = (name: Phase, oni: string | null = "a") => ({
	type: "phase",
	phase: name,
	durationMs: 20_000,
	oni,
	outcome: null,
	area: null,
});
const roamingInfo = {
	type: "room-info",
	explorationSeconds: 60,
	roaming: true,
};
const classicInfo = { type: "room-info", explorationSeconds: 60 };
const context = (
	overrides: Partial<ControlsContext> = {},
): ControlsContext => ({
	you: "b",
	posable: true,
	paintSubmitted: false,
	nearDoor: false,
	...overrides,
});

describe("ルーム情報の規則（ADR 0053）", () => {
	it("roaming: true なら動ける規則。載っていなければ従来。ルーム情報でなければ null", () => {
		expect(roamingOfRoomInfo(roamingInfo)).toBe(true);
		expect(roamingOfRoomInfo(classicInfo)).toBe(false);
		expect(roamingOfRoomInfo({ type: "phase" })).toBeNull();
		expect(roamingOfRoomInfo(null)).toBeNull();
	});
});

describe("通知の読み取り（共有の見本 fixtures/veryare-roaming.json）", () => {
	it("動く隠れ側の通知: valid はすべて読め、invalid はすべて拒む", () => {
		for (const sample of roamingFixture.roamingNotice.valid) {
			expect(parseRoamingNotice(sample)).toEqual(sample.hiders);
		}
		for (const sample of roamingFixture.roamingNotice.invalid) {
			expect(parseRoamingNotice(sample)).toBeNull();
		}
	});

	it("見た目の通知: valid はすべて読め、invalid（一覧に無いポーズ・全面 1 色・別の種類）はすべて拒む", () => {
		for (const sample of roamingFixture.lookNotice.valid) {
			expect(parseLookNotice(sample)).toEqual(sample);
		}
		for (const sample of roamingFixture.lookNotice.invalid) {
			expect(parseLookNotice(sample)).toBeNull();
		}
	});

	it("サーバーへ送る間は、サーバーの間より長い", () => {
		expect(LOOK_SEND_INTERVAL_MS).toBeGreaterThan(
			VERYARE_ROAMING.lookIntervalMs,
		);
		expect(ROAMING_DELAY_MS).toBe(ROAMING_INTERVAL_MS * 1.5);
	});
});

describe("動く隠れ側の補間", () => {
	const hider = (playerId: string, x: number, facing: number | null = 1) => ({
		playerId,
		x,
		z: 0,
		facing,
	});

	it("自分を除いて持ち、遅らせた時刻の位置を補間する。通知の無い人は、そのまま描く", () => {
		let tracks = applyRoamingNotice(
			NO_ROAMING,
			[hider("me", 0), hider("b", 0)],
			{ self: "me", at: 1000, phase: "exploration" },
		);
		tracks = applyRoamingNotice(tracks, [hider("b", 1.2)], {
			self: "me",
			at: 1120,
			phase: "exploration",
		});
		expect([...tracks.keys()]).toEqual(["b"]);
		const drawn = placeRoaming(
			[
				{ id: "b", x: 9, z: 9, facing: null },
				{ id: "cpu-1", x: 3, z: 3, facing: 0.5 },
			],
			tracks,
			1060 + ROAMING_DELAY_MS,
		);
		expect(drawn[0]?.x).toBeCloseTo(0.6);
		expect(drawn[0]).toMatchObject({ id: "b", moving: true, facing: 1 });
		expect(drawn[1]).toEqual({ id: "cpu-1", x: 3, z: 3, facing: 0.5 });
	});

	it("一覧に載らなくなった人（見つかった人）は、最後の位置のまま残す", () => {
		const first = applyRoamingNotice(NO_ROAMING, [hider("b", 2)], {
			self: "me",
			at: 0,
			phase: "exploration",
		});
		const next = applyRoamingNotice(first, [], {
			self: "me",
			at: 120,
			phase: "exploration",
		});
		expect(next.get("b")?.at(-1)?.x).toBe(2);
	});

	it("探索・答え合わせの外では、遅れて届いた通知を捨て、持っている通知も捨てる", () => {
		const tracks = applyRoamingNotice(NO_ROAMING, [hider("b", 2)], {
			self: "me",
			at: 0,
			phase: "painting",
		});
		expect(tracks).toBe(NO_ROAMING);
		const kept = applyRoamingNotice(NO_ROAMING, [hider("b", 2)], {
			self: "me",
			at: 0,
			phase: "reveal",
		});
		expect(roamingInPhase(kept, "reveal")).toBe(kept);
		expect(roamingInPhase(kept, "ended")).toBe(NO_ROAMING);
	});

	it("見た目の通知で、その人のポーズとペイントを置き換える", () => {
		const hiders: VeryareHiderState[] = [
			{ playerId: "b", x: 0, z: 0, facing: null, pose: null, paint: null },
			{
				playerId: "c",
				x: 1,
				z: 0,
				facing: null,
				pose: "idle",
				paint: null,
			},
		];
		const paint = {
			kind: "strokes" as const,
			strokes: [
				{
					part: "torso" as const,
					color: "#112233",
					size: 0.05,
					points: [{ u: 0.5, v: 0.5 }],
				},
			],
		};
		const next = applyLook(hiders, {
			type: "look",
			playerId: "b",
			pose: "maleCrouch",
			paint,
		});
		expect(next?.[0]).toMatchObject({ pose: "maleCrouch", paint });
		expect(next?.[1]).toBe(hiders[1]);
		expect(
			applyLook(null, {
				type: "look",
				playerId: "b",
				pose: null,
				paint: null,
			}),
		).toBeNull();
	});
});

describe("自分の見た目を送る間", () => {
	const strokes: VeryareStroke[] = [
		{ part: "torso", color: "#112233", size: 0.05, points: [{ u: 0, v: 0 }] },
	];

	it("塗っていなくてポーズも無ければ送らない。初めては、すぐ送る", () => {
		expect(lookDue({ sent: null, strokes: [], pose: null, now: 0 })).toEqual({
			kind: "none",
		});
		expect(lookDue({ sent: null, strokes, pose: null, now: 0 })).toEqual({
			kind: "send",
		});
	});

	it("送ったものと同じなら送らない。変わったら、間が明けるまで待ってから送る", () => {
		const sent = { strokes, pose: null, at: 1000 };
		expect(lookDue({ sent, strokes, pose: null, now: 5000 })).toEqual({
			kind: "none",
		});
		expect(lookDue({ sent, strokes, pose: "idle", now: 1500 })).toEqual({
			kind: "wait",
			waitMs: LOOK_SEND_INTERVAL_MS - 500,
		});
		expect(
			lookDue({
				sent,
				strokes: [...strokes],
				pose: null,
				now: 1000 + LOOK_SEND_INTERVAL_MS,
			}),
		).toEqual({ kind: "send" });
	});
});

describe("動ける隠れ側の規則の、動きと操作", () => {
	it("歩く速さ: 動ける規則の、ペイントと探索の間の隠れ側だけ遅い。鬼と従来の規則は、これまでどおり", () => {
		expect(ROAMING_HIDER_SPEED).toBe(3.0);
		expect(WALK_SPEED).toBe(4.5);
		expect(
			walkSpeedOf({ phase: "exploration", role: "hider", roaming: true }),
		).toBe(3.0);
		expect(
			walkSpeedOf({ phase: "painting", role: "hider", roaming: true }),
		).toBe(3.0);
		expect(
			walkSpeedOf({ phase: "preparation", role: "hider", roaming: true }),
		).toBe(WALK_SPEED);
		expect(
			walkSpeedOf({ phase: "exploration", role: "oni", roaming: true }),
		).toBe(WALK_SPEED);
		expect(
			walkSpeedOf({ phase: "exploration", role: "hider", roaming: false }),
		).toBe(WALK_SPEED);
		expect(
			walkSpeedOf({
				phase: "exploration",
				role: "hider",
				roaming: true,
				hiderSpeed: 2.5,
			}),
		).toBe(2.5);
	});

	it("canMove・mirrorMove: 動ける規則では、ペイントと探索の間も、隠れ側が動ける", () => {
		expect(canMove("exploration", "hider")).toBe(false);
		expect(canMove("exploration", "hider", true)).toBe(true);
		expect(canMove("painting", "hider", true)).toBe(true);
		expect(canMove("reveal", "hider", true)).toBe(false);
		const rule = {
			phase: "exploration" as const,
			role: "hider" as const,
			space: "waiting-room" as const,
			grid: null,
			open: new Set<string>(),
			from: { x: 0, z: 0 },
			to: { x: 1, z: 0 },
		};
		expect(mirrorMove(rule)).toEqual({ x: 0, z: 0 });
		expect(mirrorMove({ ...rule, roaming: true })).toEqual({ x: 1, z: 0 });
	});

	it("操作部品: 探索の間の隠れ側に、移動パッドとペイントの板。見つかった人には出さない", () => {
		const view = viewOf([roamingInfo, phase("exploration")]);
		expect(view.roaming).toBe(true);
		expect(canMoveNow(view, "b")).toBe(true);
		expect(controlsFor(view, context())).toEqual(["move", "look", "paint"]);
		const found = viewOf([
			roamingInfo,
			phase("exploration"),
			{ type: "hiding", playerIds: ["c"] },
		]);
		expect(controlsFor(found, context())).toEqual(["look"]);
		// ペイントの間も、動けて塗れる。
		const painting = viewOf([roamingInfo, phase("painting")]);
		expect(controlsFor(painting, context())).toEqual(["move", "look", "paint"]);
	});

	it("移動パッド: 動ける規則の隠れ側には、準備移動・ペイント・探索のどの時間にも出す（確定・ポーズ・襖のそば・板の有無で消えない）", () => {
		const contexts = [
			context(),
			context({ paintSubmitted: true }),
			context({ posable: false }),
			context({ nearDoor: true }),
			context({ paintSubmitted: true, posable: false, nearDoor: true }),
		];
		for (const name of ["preparation", "painting", "exploration"] as const) {
			const view = viewOf([
				roamingInfo,
				phase(name),
				{ type: "hiding", playerIds: ["b"] },
			]);
			expect(canMoveNow(view, "b")).toBe(true);
			for (const c of contexts) {
				expect(controlsFor(view, c)).toContain("move");
			}
		}
		// 従来の規則は、いまのまま（準備移動だけ動ける）。
		for (const name of ["painting", "exploration"] as const) {
			const classic = viewOf([
				classicInfo,
				phase(name),
				{ type: "hiding", playerIds: ["b"] },
			]);
			expect(controlsFor(classic, context())).not.toContain("move");
		}
		expect(
			controlsFor(viewOf([classicInfo, phase("preparation")]), context()),
		).toContain("move");
	});

	it("操作部品: 動ける規則では、襖のそばでも「襖を開ける」を出さない（鬼も）", () => {
		const view = viewOf([roamingInfo, phase("exploration")]);
		expect(controlsFor(view, context({ you: "a", nearDoor: true }))).toEqual([
			"move",
			"look",
			"shoot",
		]);
		const classic = viewOf([classicInfo, phase("exploration")]);
		expect(controlsFor(classic, context({ you: "a", nearDoor: true }))).toEqual(
			["move", "look", "open-door", "shoot"],
		);
		// 従来の規則の隠れ側は、これまでどおり動けない。
		expect(controlsFor(classic, context())).toEqual(["look"]);
	});

	it("塗り直しとポーズ: 動ける規則では、探索の間も、確定のあとも、選び直せる", () => {
		const base = {
			role: "hider" as const,
			spectator: false,
			submitted: true,
			remainingMs: 0,
		};
		expect(canEditPaint({ ...base, phase: "exploration" })).toBe(false);
		expect(canEditPaint({ ...base, phase: "exploration", roaming: true })).toBe(
			true,
		);
		expect(
			canEditPaint({
				...base,
				phase: "exploration",
				roaming: true,
				spectator: true,
			}),
		).toBe(false);
		expect(
			canChangePose({ ...base, phase: "exploration", roaming: true }),
		).toBe(true);
		expect(canChangePose({ ...base, phase: "exploration" })).toBe(false);
	});

	it("自分の体: 動ける規則では、ペイントと探索の間も固定しない（歩く・走る。止まると選んだポーズ）", () => {
		expect(avatarPoseFixed("exploration", "hider")).toBe(true);
		expect(avatarPoseFixed("exploration", "hider", true)).toBe(false);
		expect(avatarPoseFixed("painting", "hider", true)).toBe(false);
		expect(avatarPoseFixed("reveal", "hider", true)).toBe(true);
	});

	it("ロビー: 旗を立てて、全員に出す。既定は動ける（クライアントの既定 ROAMING_DEFAULT）。従来も選べる", () => {
		expect(ROAMING_READY).toBe(true);
		expect(ROAMING_ENABLED).toBe(true);
		expect(ROAMING_DEFAULT).toBe(true);
		const options = veryareRoomOptions(true, true);
		expect(options.at(-1)).toMatchObject({
			key: "roaming",
			choices: [0, 1],
			default: 1,
		});
		expect(veryareRoomOptions(true)).toEqual(options.slice(0, -1));
		// サーバーの既定（契約の写し）は、従来のまま。作成の設定に載せて、動ける規則にする。
		expect(VERYARE_ROAMING.defaultRoaming).toBe(0);
		const sent = veryareManifest.roomOptions ?? [];
		expect(initialSettings(sent).roaming).toBe(1);
	});

	it("「新しく遊ぶ」の作成の設定: 動ける規則（roaming: 1）を付ける。ほかのゲームは、設定を付けない", () => {
		expect(veryarePlaySettings()).toEqual({ roaming: 1 });
		expect(playCreateSettings("veryare")).toEqual({ roaming: 1 });
		expect(playCreateSettings("tetris")).toBeUndefined();
		expect(playCreateSettings("czz")).toBeUndefined();
	});
});

describe("増え鬼（ADR 0053 の最小版）", () => {
	const oni = (others?: unknown) => ({
		type: "oni",
		playerId: "a",
		x: 1,
		z: 2,
		facing: 0,
		pose: "standing",
		openDoors: [],
		...(others === undefined ? {} : { others }),
	});

	it("ルーム情報の spreading: true で増え鬼。載っていなければ従来", () => {
		expect(
			spreadingOfRoomInfo({
				type: "room-info",
				explorationSeconds: 60,
				spreading: true,
			}),
		).toBe(true);
		expect(spreadingOfRoomInfo(classicInfo)).toBe(false);
		expect(spreadingOfRoomInfo({ type: "oni" })).toBeNull();
	});

	it("鬼の通知: others が無ければ従来の形のまま。あれば読み、形が違えば通知ごと捨てる", () => {
		expect(parseOniNotice(oni())).toEqual(oni());
		expect(
			parseOniNotice(oni([{ playerId: "b", x: 1, z: 2, facing: null }]))
				?.others,
		).toEqual([{ playerId: "b", x: 1, z: 2, facing: null }]);
		expect(parseOniNotice(oni("b"))).toBeNull();
		expect(
			parseOniNotice(oni([{ playerId: "b", x: "1", z: 2, facing: null }])),
		).toBeNull();
	});

	it("途中から鬼になった人は、鬼の役割になり、動けて、撃てる（観戦にならない）", () => {
		const view = viewOf([
			phase("exploration"),
			{ type: "hiding", playerIds: ["c"] },
			oni([{ playerId: "b", x: 1, z: 2, facing: 0 }]),
		]);
		expect(view.onis).toEqual(["b"]);
		expect(roleIn(view, "b")).toBe("oni");
		expect(roleIn(view, "c")).toBe("hider");
		expect(canMoveNow(view, "b")).toBe(true);
		expect(controlsFor(view, context())).toEqual(["move", "look", "shoot"]);
		// 従来の規則（others なし）では、見つかった人は観戦。
		const classic = viewOf([
			phase("exploration"),
			{ type: "hiding", playerIds: ["c"] },
			oni(),
		]);
		expect(roleIn(classic, "b")).toBe("hider");
		expect(controlsFor(classic, context())).toEqual(["look"]);
	});

	it("途中から鬼になった人の通知: 自分を除いて持ち、一覧に無い人（離脱）は消す", () => {
		const first = applyOtherOnis(
			NO_ROAMING,
			[
				{ playerId: "me", x: 0, z: 0, facing: 0 },
				{ playerId: "b", x: 1, z: 0, facing: 0 },
				{ playerId: "c", x: 2, z: 0, facing: 0 },
			],
			{ self: "me", at: 0, phase: "exploration" },
		);
		expect([...first.keys()]).toEqual(["b", "c"]);
		const next = applyOtherOnis(
			first,
			[{ playerId: "c", x: 2.5, z: 0, facing: 0 }],
			{
				self: "me",
				at: 120,
				phase: "exploration",
			},
		);
		expect([...next.keys()]).toEqual(["c"]);
	});

	it("ロビー: 旗を立てて、全員に出す。隠れ側の動きの後に、既定（契約の値。ふつう）で足す", () => {
		expect(SPREADING_READY).toBe(true);
		expect(SPREADING_ENABLED).toBe(true);
		expect(initialSettings(veryareManifest.roomOptions ?? []).spreading).toBe(
			0,
		);
		const options = veryareRoomOptions(true, true, true);
		expect(options.map((o) => o.key).slice(-2)).toEqual([
			"roaming",
			"spreading",
		]);
		expect(options.at(-1)).toMatchObject({ choices: [0, 1], default: 0 });
	});
});

describe("調整（ADR 0053）", () => {
	it("隠れ側の歩く速さは、開発用の合図があるときだけ URL で変えられる。範囲の外は既定", () => {
		expect(roamingHiderSpeed(false, "?hiderSpeed=2.5")).toBe(
			ROAMING_HIDER_SPEED,
		);
		expect(roamingHiderSpeed(false, "?roof=1&hiderSpeed=2.5")).toBe(2.5);
		expect(roamingHiderSpeed(true, "?hiderSpeed=2")).toBe(2);
		expect(roamingHiderSpeed(true, "?hiderSpeed=99")).toBe(ROAMING_HIDER_SPEED);
		expect(roamingHiderSpeed(true, "")).toBe(ROAMING_HIDER_SPEED);
	});
});
