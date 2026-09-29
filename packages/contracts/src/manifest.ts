/**
 * ゲームマニフェスト。
 *
 * ゲームは自分自身を記述したマニフェストを持つ。基盤はこれを registry で集約し、
 * 選択画面を自動生成する。基盤は個々のゲームの中身を知らず、この自己紹介だけを読む。
 */

/** ゲーム種別。ソロ / リアルタイムの2層を宣言する（ADR 0004）。 */
export type GameKind = "solo" | "realtime";

/**
 * 選択画面の自動生成に使うゲームの自己記述。
 *
 * ソロゲームは kind を "solo" とし、minPlayers / maxPlayers は 1 を宣言する。
 * リアルタイムゲームは参加可能な人数の範囲を宣言する。
 */
export interface GameManifest {
	/** ゲームの一意な識別子。registry のキー、多重化の gameType と対応する。 */
	readonly id: string;
	/** 選択画面に表示する名称。 */
	readonly title: string;
	/** ソロ / リアルタイムの別。 */
	readonly kind: GameKind;
	/** 参加可能な最小人数。ソロは 1。 */
	readonly minPlayers: number;
	/** 参加可能な最大人数。ソロは 1。 */
	readonly maxPlayers: number;
	/** サムネイル画像のパス。 */
	readonly thumbnail: string;
	/** 選択画面に表示する短い説明。 */
	readonly description: string;
	/**
	 * ルーム作成時に作成者が選ぶ設定（リアルタイムゲームのみ）。ロビーはこの宣言から
	 * プルダウンを組み立てるだけで、個々のゲームを知らない（ADR 0003）。
	 * 選んだ値はルーム一覧には出さない（入室後に初めて分かる / ADR 0024）。
	 */
	readonly roomOptions?: readonly RoomOption[];
}

/** ルーム作成時に選ぶ設定1つ。数値の選択肢から1つを選ぶ。 */
export interface RoomOption {
	/** create-room の settings に載せるキー。 */
	readonly key: string;
	/** プルダウンの見出し。 */
	readonly label: string;
	/** 選べる値。 */
	readonly choices: readonly number[];
	/** 既定値。choices のいずれか。 */
	readonly default: number;
}
