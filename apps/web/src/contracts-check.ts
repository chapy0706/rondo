/**
 * 受け入れ条件の確認用。
 *
 * web から契約型（@rondo/contracts）を import して型チェックが通ることを示す。
 * TOP 画面・選択画面・基盤 UI の実装は issue-05 / issue-06。ここはその起点となる
 * 最小 skeleton であり、契約に依存できることだけを保証する。
 */

import type { GameManifest } from "@rondo/contracts";

/** 型チェック確認用のプレースホルダーとなるソロゲームのマニフェスト。 */
export const placeholderManifest: GameManifest = {
	id: "placeholder",
	title: "Placeholder",
	kind: "solo",
	minPlayers: 1,
	maxPlayers: 1,
	thumbnail: "/games/placeholder.png",
	description: "契約型の型チェック確認用",
};
