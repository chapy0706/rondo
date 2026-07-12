import type { GameManifest } from "@rondo/contracts";
import type { ComponentType } from "react";
import { tetrisManifest } from "./tetris/manifest";
import { tiltMazeManifest } from "./tilt-maze/manifest";

/**
 * 全ゲームのマニフェストの集約点（ADR 0003）。
 *
 * ここだけが全ゲームを知る。ゲームを追加するときは games/<id>/manifest.ts を作り、
 * その manifest をこの配列に登録する（描画コンポーネントは gameComponents に登録する）。
 * 基盤の選択画面・ルーティング・ホストは registry を読むだけで、個々のゲームの中身を
 * 知らない。選択肢を増やしても基盤側のコードは変わらない。
 */
export const registry: readonly GameManifest[] = [
	tetrisManifest,
	tiltMazeManifest,
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
};

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
