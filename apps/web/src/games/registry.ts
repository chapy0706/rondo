import type { GameManifest, RoomOption } from "@rondo/contracts";
import type { ComponentType } from "react";
import { czzManifest } from "./czz/manifest";
import { minichessManifest } from "./minichess/manifest";
import { nikakuKeshiManifest } from "./nikaku-keshi/manifest";
import { tetrisManifest } from "./tetris/manifest";
import { tiltMazeManifest } from "./tilt-maze/manifest";
import {
	VERYARE_FULLSCREEN,
	VERYARE_SPECTATE_OPTIONS,
	veryareHiddenOptions,
	veryareManifest,
} from "./veryare/manifest";

/**
 * 全ゲームのマニフェストの集約点（ADR 0003）。
 *
 * ここだけが全ゲームを知る。ゲームを追加するときは games/<id>/manifest.ts を作り、
 * その manifest をこの配列に登録する（描画コンポーネントは gameComponents に登録する）。
 * 基盤の選択画面・ルーティング・ホストは registry を読むだけで、個々のゲームの中身を
 * 知らない。選択肢を増やしても基盤側のコードは変わらない。
 */
// 並び順は、選択画面の並び順（仕様）。veryare と czz を先頭に置き、ほかはこれまでの順のまま
// （registryOrder.test.ts で確かめる）。
export const registry: readonly GameManifest[] = [
	veryareManifest,
	czzManifest,
	tetrisManifest,
	tiltMazeManifest,
	nikakuKeshiManifest,
	minichessManifest,
];

/** ゲーム本体（React コンポーネント）の遅延ローダ。 */
export type GameLoader = () => Promise<{ default: ComponentType }>;

/**
 * id からゲーム本体を読み込むローダの対応表。
 *
 * マニフェスト（自己記述）と本体（描画・進行）を分けて登録することで、選択画面は
 * マニフェストだけ、ゲームホストは本体だけを必要な時に読み込める。ここが registry と
 * 並ぶ唯一のゲーム登録点であり、基盤側のホストはこの表を引くだけで個別ゲームを知らない。
 */
const gameComponents: Record<string, GameLoader> = {
	[tetrisManifest.id]: () => import("./tetris/Tetris"),
	[tiltMazeManifest.id]: () => import("./tilt-maze/TiltMaze"),
	[czzManifest.id]: () => import("./czz/Czz"),
	[veryareManifest.id]: () => import("./veryare/Veryare"),
	[nikakuKeshiManifest.id]: () => import("./nikaku-keshi/NikakuKeshi"),
	[minichessManifest.id]: () => import("./minichess/Minichess"),
};

/**
 * ロビーを開いた時点の先読み（issue-46）。何を先読みするか（しないか）は、ゲームの側が決める。
 * 登録の無いゲームは、何もしない。
 */
const lobbyPrefetchers: Record<string, () => Promise<void>> = {
	[veryareManifest.id]: () =>
		import("./veryare/prefetch").then((m) => m.prefetchForLobby()),
};

/**
 * ロビーを開いたときに呼ぶ。失敗しても、ロビーには何も出さない（先読みは無くても動く）。
 * 開発中だけ、失敗を Console に出す（本番では出さない）。
 */
export function prefetchForLobby(id: string): void {
	void lobbyPrefetchers[id]?.().catch((error: unknown) => {
		if (process.env.NODE_ENV !== "production") {
			console.info(`[lobby] ${id} の先読みを始められない`, error);
		}
	});
}

/**
 * ほかの選択肢によって、ロビーに出さない選択肢（issue-46。平屋では CPU を出さない）。何を出さないかは、
 * ゲームの側が決める。登録の無いゲームは、すべて出す。
 */
const roomOptionRules: Record<
	string,
	(settings: Readonly<Record<string, number>>) => readonly string[]
> = {
	[veryareManifest.id]: veryareHiddenOptions,
};

/** 観戦ルームの作成の設定（issue-67）。持たないゲームは登録しない。 */
const spectateOptions: Record<string, readonly RoomOption[]> = {
	[veryareManifest.id]: VERYARE_SPECTATE_OPTIONS,
};

/** ロビー（運営の画面）が呼ぶ。id のゲームの観戦ルームの作成の設定。観戦ルームを持たなければ null。 */
export function spectateRoomOptions(id: string): readonly RoomOption[] | null {
	return spectateOptions[id] ?? null;
}

/** ロビーが呼ぶ。いまの選び方 settings で、出さない選択肢の key。 */
export function hiddenRoomOptions(
	id: string,
	settings: Readonly<Record<string, number>>,
): readonly string[] {
	return roomOptionRules[id]?.(settings) ?? [];
}

/**
 * ゲーム画面を、画面いっぱいの 1 枚にするゲーム（各ゲームの manifest.ts の印）。登録の無いゲームは、
 * これまでの形（縦に積む）のまま。
 */
const fullscreenGames: Record<string, boolean> = {
	[veryareManifest.id]: VERYARE_FULLSCREEN,
};

/** 共通の入れ物（PlayHost）が呼ぶ。id のゲームを、画面いっぱいの 1 枚にするか。 */
export function isFullscreenGame(id: string): boolean {
	return fullscreenGames[id] ?? false;
}

/**
 * id からマニフェストを引く。ゲームホスト（play ルート）が、選ばれたゲームを
 * 起動する際に使う。未登録の id には undefined を返す。
 */
export function findManifest(id: string): GameManifest | undefined {
	return registry.find((manifest) => manifest.id === id);
}

/** id からゲーム本体のローダを引く。未登録の id には undefined を返す。 */
export function findGameLoader(id: string): GameLoader | undefined {
	return gameComponents[id];
}

/**
 * ゲーム画面の場所（issue-40）。ロビーは、参加できたらここへ移る。ゲームの種類ごとの
 * 行き先はここで決め、ロビーはゲームの中身を知らない。
 */
export function playPathOf(id: string): string {
	return `/play/${encodeURIComponent(id)}`;
}

/** ロビーの場所。リアルタイムのゲーム画面から退出したら、ここへ戻る。 */
export function lobbyPathOf(id: string): string {
	return `/lobby/${encodeURIComponent(id)}`;
}

/**
 * game-ended を受けたら、ゲームの代わりに基盤の結果画面を出すゲーム（issue-42）。
 * 勝敗をゲームの画面に出さず、基盤の結果画面に任せるゲームだけを並べる。ほかの
 * リアルタイムのゲーム（tilt-maze）は、これまでどおりゲームの下に結果を並べる。
 */
const resultInsteadOfGame: ReadonlySet<string> = new Set([veryareManifest.id]);

export function showsResultInsteadOfGame(id: string): boolean {
	return resultInsteadOfGame.has(id);
}

/**
 * リアルタイム対戦のゲーム（issue-47）。選択画面で「新しく遊ぶ」と「ルームに参加する」の
 * 入口を分け、ロビーを出す。rolling（tilt-maze）の対戦モードは準備中のため、まだ入れない。
 */
const realtimeMatches: ReadonlySet<string> = new Set([veryareManifest.id]);

export function isRealtimeMatch(id: string): boolean {
	return realtimeMatches.has(id);
}
