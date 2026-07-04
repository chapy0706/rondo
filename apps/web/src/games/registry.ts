import type { GameManifest } from "@rondo/contracts";

/**
 * 全ゲームのマニフェストの集約点（ADR 0003）。
 *
 * ここだけが全ゲームを知る。ゲームを追加するときは games/<id>/manifest.ts を作り、
 * その manifest をこの配列に登録する。基盤の選択画面・ルーティングは registry を
 * 読むだけで、個々のゲームの中身を知らない。選択肢を増やしても基盤側のコードは変わらない。
 *
 * 例（issue-07 以降で登録する）:
 *   import { tetrisManifest } from "./tetris/manifest";
 *   export const registry = [tetrisManifest] as const;
 */
export const registry: readonly GameManifest[] = [];

/**
 * id からマニフェストを引く。ゲームホスト（play ルート）が、選ばれたゲームを
 * 起動する際に使う。未登録の id には undefined を返す。
 */
export function findManifest(id: string): GameManifest | undefined {
	return registry.find((manifest) => manifest.id === id);
}
