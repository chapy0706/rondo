/**
 * 動きの定数と、答え合わせの点滅（issue-29d）。純粋関数で、three.js と React を使わない。
 *
 * - 歩く速さ: 準備移動（20 秒）のうちに、玄関から屋敷のいちばん遠いマスまで歩ける速さ。
 *   10種の骨格の最長は 67 マス（骨格10）で、見回しや向きを変える時間に 5 秒を残し、15 秒で
 *   歩ける 4.5 m/秒にする。リハーサルで変えられるよう、ここだけを書き換える（鬼と隠れ側は同じ）
 * - 位置の報告は 50 ms ごとに間引く（速さを上げたので、1回で進む距離を 22.5 cm に抑え、
 *   角での位置の合わせ直しを減らす）
 * - 点滅（ADR 0033）: 答え合わせ中、探索の開始に届いた隠れ側全員（見つかった人も逃げ切った
 *   人も）を、1秒周期で赤く光らせる。被りで失格した人は一覧に無いので、点滅しない。
 *   「視差効果を減らす」設定の人には、点滅させず、赤で光らせたままにする
 */

import type { Phase, Point } from "./rules";
import type { Cell, StageGrid } from "./stage";
import { cellAt, passable } from "./stage";

/** 歩く速さ（m/秒）。 */
export const WALK_SPEED = 4.5;
/** 位置の報告の最短間隔（ミリ秒）。 */
export const SEND_INTERVAL_MS = 50;
/** 向きだけが変わったときに報告し直す角度の差（ラジアン）。 */
export const FACING_EPSILON = 0.05;
/** 準備移動の長さ（サーバーの既定 game.preparation_ms と同じ）。速さの根拠に使う。 */
export const PREPARATION_MS = 20_000;
/** 準備移動のうち、見回しや向きを変える時間に残す長さ。 */
export const WALK_MARGIN_MS = 5_000;
/** 点滅の周期（ミリ秒）。 */
export const BLINK_PERIOD_MS = 1000;

/**
 * 玄関から、襖を全部開けた道（準備移動の間の状態）で、いちばん遠いマスまでの距離（メートル）。
 * 通れる境だけを上下左右にたどる、最短のマスの数にマスの大きさを掛ける。
 */
export function farthestWalk(grid: StageGrid): number {
	const allOpen = new Set(
		[...grid.doors].filter(([, kind]) => kind === "fusuma").map(([key]) => key),
	);
	const start = cellAt(grid, grid.spawn);
	const key = (c: Cell) => `${c.x},${c.z}`;
	const distance = new Map<string, number>([[key(start), 0]]);
	const queue: Cell[] = [start];
	let farthest = 0;
	for (let i = 0; i < queue.length; i++) {
		const here = queue[i] as Cell;
		const d = distance.get(key(here)) ?? 0;
		farthest = Math.max(farthest, d);
		for (const [dx, dz] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		] as const) {
			const next = { x: here.x + dx, z: here.z + dz };
			if (distance.has(key(next))) continue;
			if (!passable(grid, allOpen, here, next)) continue;
			distance.set(key(next), d + 1);
			queue.push(next);
		}
	}
	return farthest * grid.cellSize;
}

/** 位置の報告を送るか。動いたか向きが変わったときだけ、前の報告から 50 ms 空けて送る。 */
export function shouldReport(options: {
	readonly time: number;
	readonly lastSent: number;
	readonly position: Point;
	readonly sentPosition: Point | null;
	readonly facing: number;
	readonly sentFacing: number | null;
}): boolean {
	const { time, lastSent, position, sentPosition, facing, sentFacing } =
		options;
	const moved =
		sentPosition === null ||
		sentPosition.x !== position.x ||
		sentPosition.z !== position.z;
	const turned =
		sentFacing === null || Math.abs(facing - sentFacing) > FACING_EPSILON;
	return (moved || turned) && time - lastSent >= SEND_INTERVAL_MS;
}

/** 答え合わせで点滅させる相手。others は自分以外の隠れ側、self は自分も点滅させるか。 */
export function blinkTargets(
	phase: Phase,
	hiders: readonly string[] | null,
	you: string | null,
): { readonly others: readonly string[]; readonly self: boolean } {
	if (phase !== "reveal" || hiders === null) return { others: [], self: false };
	return {
		others: hiders.filter((id) => id !== you),
		self: you !== null && hiders.includes(you),
	};
}

/** 点滅の明るさ（0〜1）。elapsedMs は答え合わせの開始からの時間。 */
export function blinkLevel(elapsedMs: number, reduceMotion: boolean): number {
	if (reduceMotion) return 1;
	return (1 - Math.cos((2 * Math.PI * elapsedMs) / BLINK_PERIOD_MS)) / 2;
}
