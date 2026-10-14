/**
 * veryare のクライアントが送るゲーム内イベントの見本（issue-27 / ADR 0009）。
 *
 * TS の型で書いた見本を、fixtures/veryare-events.json の valid と一致させる
 * （veryareEventSamples.test.ts）。Gleam 側は同じ JSON を読み、サーバーの decoder が
 * valid を受け付け、invalid を拒むことを確かめる
 * （server/test/rondo_server/games/veryare/shoot_fixture_test.gleam）。
 */

import type {
	VeryareDoorsNotice,
	VeryareLikeEvent,
	VeryareLikesNotice,
	VeryareMembersNotice,
	VeryareOpenDoorEvent,
	VeryarePaintEvent,
	VeryareShootEvent,
	VeryareSightEvent,
	VeryareStageNotice,
	VeryareWaitingPoseEvent,
} from "./veryare";

export const shootEventSamples = [
	{ type: "shoot", target: "p-2" },
	{ type: "shoot", target: null },
] satisfies VeryareShootEvent[];

/**
 * ステージの通知の見本（issue-29a）。fixtures/veryare-stage.json の valid と一致させる。
 * 1つ目は 1 m・原点 (0, 0) の小さな屋敷、2つ目は同じ地図を 0.3 m・ずれた原点にしたもの。
 * 1つ目は、移動の規則の共有の見本（fixtures/veryare-movement.json）の地図でもある。
 */
const tinyStage = {
	type: "stage",
	cellSize: 1,
	origin: { x: 0, z: 0 },
	width: 5,
	depth: 5,
	rows: ["..A##", "..A##", "..A..", "..B##", "..###"],
	regions: { ".": "open", A: "A", B: "B" },
	rooms: { A: "washitsu", B: "oshiire" },
	doors: [
		{ a: { x: 1, z: 1 }, b: { x: 2, z: 1 }, kind: "fusuma" },
		{ a: { x: 2, z: 2 }, b: { x: 3, z: 2 }, kind: "fusuma" },
		{ a: { x: 1, z: 3 }, b: { x: 2, z: 3 }, kind: "always-open" },
		{ a: { x: 1, z: 4 }, b: { x: 2, z: 4 }, kind: "always-closed" },
	],
	spawn: { x: 0.5, z: 4.5 },
} satisfies VeryareStageNotice;

export const stageNoticeSamples = [
	tinyStage,
	{
		...tinyStage,
		cellSize: 0.3,
		origin: { x: -6.225, z: -0.275 },
		spawn: { x: -6.075, z: 1.075 },
	},
] satisfies VeryareStageNotice[];

/** 襖を開ける報告の見本（issue-29b）。fixtures/veryare-events.json の openDoor.valid と一致させる。 */
export const openDoorEventSamples = [
	{ type: "open-door", door: { a: { x: 1, z: 1 }, b: { x: 2, z: 1 } } },
	{ type: "open-door", door: { a: { x: 2, z: 2 }, b: { x: 2, z: 3 } } },
] satisfies VeryareOpenDoorEvent[];

/** 襖の通知の見本（issue-29b）。fixtures/veryare-events.json の doorsNotice.valid と一致させる。 */
export const doorsNoticeSamples = [
	{ type: "doors", open: [] },
	{
		type: "doors",
		open: [
			{ a: { x: 1, z: 1 }, b: { x: 2, z: 1 } },
			{ a: { x: 2, z: 2 }, b: { x: 3, z: 2 } },
		],
	},
] satisfies VeryareDoorsNotice[];

/** ペイントの確定（issue-25）。fixtures/veryare-paint.json の valid と同じ。 */
export const paintEventSamples = [
	{
		type: "paint",
		paint: {
			kind: "strokes",
			strokes: [
				{
					part: "torso",
					color: "#a07850",
					size: 0.04,
					points: [
						{ u: 0, v: 0.5 },
						{ u: 0.25, v: 0.5 },
					],
				},
			],
		},
	},
	{
		type: "paint",
		paint: {
			kind: "strokes",
			strokes: [
				{
					part: "torso",
					color: "#b5a46a",
					size: 0.01,
					points: [
						{ u: 1, v: 0 },
						{ u: 0.999, v: 1 },
					],
				},
				{
					part: "torso",
					color: "#6b5440",
					size: 0.15,
					points: [{ u: 0.5, v: 0.123 }],
				},
			],
		},
	},
	{ type: "paint", paint: null, pose: "maleCrouch" },
	{
		type: "paint",
		paint: {
			kind: "strokes",
			strokes: [
				{
					part: "torso",
					color: "#a07850",
					size: 0.04,
					points: [
						{ u: 0, v: 0.5 },
						{ u: 0.25, v: 0.5 },
					],
				},
			],
		},
		pose: "femaleDance",
	},
	// 腕・脚の部位（issue-54 / ADR 0037）。
	{
		type: "paint",
		paint: {
			kind: "strokes",
			strokes: [
				{
					part: "left-arm",
					color: "#a07850",
					size: 0.04,
					points: [{ u: 0.25, v: 0.5 }],
				},
				{
					part: "right-arm",
					color: "#b5a46a",
					size: 0.04,
					points: [{ u: 0.25, v: 0.5 }],
				},
				{
					part: "left-leg",
					color: "#6b5440",
					size: 0.04,
					points: [{ u: 0.25, v: 0.5 }],
				},
				{
					part: "right-leg",
					color: "#000000",
					size: 0.04,
					points: [{ u: 0.25, v: 0.5 }],
				},
			],
		},
	},
] as const satisfies readonly VeryarePaintEvent[];

/**
 * 待機ルームのメンバーの通知の見本（issue-59）。fixtures/veryare-members.json の membersNotice.valid と
 * 一致させる。Gleam 側は同じ JSON を読む（server/test/rondo_server/games/veryare/members_fixture_test.gleam）。
 */
export const membersNoticeSamples = [
	{ type: "members", members: [] },
	{
		type: "members",
		members: [
			{ playerId: "p-1", x: 2, z: 0, facing: 1.55, pose: "femaleDance" },
			{ playerId: "p-2", x: -1.25, z: 0.5, facing: null, pose: null },
		],
	},
] satisfies VeryareMembersNotice[];

/** 待機ポーズの変更の見本（issue-59）。fixtures/veryare-members.json の waitingPose.valid と一致させる。 */
export const waitingPoseEventSamples = [
	{ type: "waiting-pose", pose: "femaleDance" },
	{ type: "waiting-pose", pose: "idle" },
] satisfies VeryareWaitingPoseEvent[];

/**
 * 見逃しポイントといいねの見本（issue-32）。fixtures/veryare-missed.json の各 valid と一致させる。
 * Gleam 側は同じ JSON を読む（server/test/rondo_server/games/veryare/missed_fixture_test.gleam）。
 */
export const sightEventSamples = [
	{ type: "sight", playerIds: [] },
	{ type: "sight", playerIds: ["p-2", "p-3"] },
] satisfies VeryareSightEvent[];

export const likeEventSamples = [
	{ type: "like", target: "p-2" },
] satisfies VeryareLikeEvent[];

export const likesNoticeSamples = [
	{ type: "likes", likes: [] },
	{
		type: "likes",
		likes: [
			{ playerId: "p-2", count: 2 },
			{ playerId: "p-3", count: 0 },
		],
	},
] satisfies VeryareLikesNotice[];
