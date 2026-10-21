/**
 * ボットの観戦者（issue-67）が受け取った、観戦用の通知（契約: VeryareSpectateNotice）の流れを確かめる
 * 純粋な関数。./tools/load.sh spectate（trials/spectate.ts）が使う。
 *
 * - 形: actors の各人は、参加者（CPU）で、位置はステージの中、ポーズは隠れ場所の 3 種類か walking
 * - 見た目（looks）: 数は隠れ CPU の数、色は "#rrggbb"、ポーズは隠れ場所の 3 種類。試合ごとに届く
 * - ポーズ: 着いた隠れ CPU（walking でない）のポーズは、その試合の見た目のポーズと同じ
 * - 間隔: 全員宛ての通知（game-state）は、100 ms より明らかに短い間隔（80 ms 未満）では届かない。
 *   入室・復帰の本人宛ての 1 通（game-state-to）は、間隔に数えない
 * - 試合: game-started で、次の試合として数え直す（試合ごとの通知の数）
 */

import type { ServerMessage } from "@rondo/contracts";
import type { StageMap } from "./stage.ts";

/** 通知の間隔の下限（ms）。サーバーは 100 ms ごとに確かめるので、これより短ければ、おかしい。 */
export const MIN_GAP_MS = 80;

const ACTOR_POSES = new Set(["standing", "crouching", "lying", "walking"]);
const LOOK_POSES = new Set(["standing", "crouching", "lying"]);

export interface SpectateContext {
	/** ルームの参加者（CPU だけ）。 */
	readonly players: readonly string[];
	readonly hiderCpus: number;
	/** 試合 game（0 から）のステージの地図。分からなければ null（範囲を確かめない）。 */
	readonly stageOf: (game: number) => StageMap | null;
}

export interface SpectateResult {
	readonly problems: readonly string[];
	/** 試合ごとの、観戦用の通知の数。 */
	readonly noticesPerGame: readonly number[];
	/** 同じ試合の中の、全員宛ての通知の間隔（ms）。 */
	readonly gapsMs: readonly number[];
	/** 見た目（looks）が届いた試合の数。 */
	readonly gamesWithLooks: number;
}

interface Actor {
	readonly playerId: string;
	readonly x: number;
	readonly z: number;
	readonly pose: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function readActors(value: unknown): Actor[] | null {
	if (!Array.isArray(value)) return null;
	const actors: Actor[] = [];
	for (const entry of value as unknown[]) {
		if (!isRecord(entry)) return null;
		const { playerId, x, z, facing, pose } = entry;
		if (typeof playerId !== "string" || typeof pose !== "string") return null;
		if (!finite(x) || !finite(z) || !finite(facing)) return null;
		if (!ACTOR_POSES.has(pose)) return null;
		actors.push({ playerId, x, z, pose });
	}
	return actors;
}

function inside(map: StageMap, x: number, z: number): boolean {
	const right = map.origin.x + map.width * map.cellSize;
	const bottom = map.origin.z + map.depth * map.cellSize;
	return x >= map.origin.x && x <= right && z >= map.origin.z && z <= bottom;
}

/** 受け取った電文（時刻つき）から、観戦用の通知の流れを確かめる。 */
export function checkSpectateStream(
	received: readonly { readonly at: number; readonly message: ServerMessage }[],
	context: SpectateContext,
): SpectateResult {
	const problems = new Set<string>();
	const players = new Set(context.players);
	const noticesPerGame: number[] = [0];
	const gapsMs: number[] = [];
	let game = 0;
	let lastBroadcast: number | null = null;
	let looks = new Map<string, string>();
	let gamesWithLooks = 0;
	let looksThisGame = false;

	for (const { at, message } of received) {
		if (message.type === "game-started") {
			game++;
			noticesPerGame.push(0);
			lastBroadcast = null;
			looks = new Map();
			looksThisGame = false;
			continue;
		}
		if (message.type !== "game-state" && message.type !== "game-state-to") {
			continue;
		}
		const payload = message.payload;
		if (!isRecord(payload) || payload.type !== "spectate") continue;
		noticesPerGame[game] = (noticesPerGame[game] ?? 0) + 1;
		if (message.type === "game-state") {
			if (lastBroadcast !== null) {
				const gap = at - lastBroadcast;
				gapsMs.push(gap);
				if (gap < MIN_GAP_MS) problems.add(`通知の間隔が短すぎる: ${gap} ms`);
			}
			lastBroadcast = at;
		}

		if (payload.looks !== undefined) {
			const list = Array.isArray(payload.looks) ? payload.looks : null;
			if (list === null) {
				problems.add("形が違う通知");
			} else {
				if (list.length !== context.hiderCpus) {
					problems.add(`見た目の数が隠れ CPU の数と違う: ${list.length}`);
				}
				looks = new Map();
				for (const entry of list as unknown[]) {
					if (!isRecord(entry) || typeof entry.playerId !== "string") {
						problems.add("形が違う通知");
						continue;
					}
					const { playerId, pose, paint } = entry;
					if (!players.has(playerId)) {
						problems.add(`参加者でない人が載っている: ${playerId}`);
					}
					if (typeof pose !== "string" || !LOOK_POSES.has(pose)) {
						problems.add(`見た目のポーズが違う: ${playerId} ${String(pose)}`);
					}
					const color = isRecord(paint) ? paint.color : undefined;
					if (
						!isRecord(paint) ||
						paint.kind !== "uniform" ||
						typeof color !== "string" ||
						!/^#[0-9a-f]{6}$/i.test(color)
					) {
						problems.add(`色の形が違う: ${playerId} ${String(color)}`);
					}
					if (typeof pose === "string") looks.set(playerId, pose);
				}
				if (!looksThisGame) gamesWithLooks++;
				looksThisGame = true;
			}
		}

		const actors = readActors(payload.actors);
		if (actors === null) {
			problems.add("形が違う通知");
			continue;
		}
		const map = context.stageOf(game);
		for (const a of actors) {
			if (!players.has(a.playerId)) {
				problems.add(`参加者でない人が載っている: ${a.playerId}`);
			}
			if (map !== null && !inside(map, a.x, a.z)) {
				problems.add(`ステージの外: ${a.playerId} (${a.x}, ${a.z})`);
			}
			const look = looks.get(a.playerId);
			if (a.pose !== "walking" && look !== undefined && a.pose !== look) {
				problems.add(
					`ポーズが見た目と違う: ${a.playerId} ${a.pose}（見た目は ${look}）`,
				);
			}
		}
	}
	return { problems: [...problems], noticesPerGame, gapsMs, gamesWithLooks };
}
