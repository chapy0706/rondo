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
	VeryareOpenDoorEvent,
	VeryareShootEvent,
	VeryareStageNotice,
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
