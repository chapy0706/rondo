/**
 * ゲームマニフェスト。
 *
 * ゲームは自分自身を記述したマニフェストを持つ。基盤はこれを registry で集約し、
 * 選択画面を自動生成する。基盤は個々のゲームの中身を知らず、この自己紹介だけを読む。
 */

/** ゲーム種別。ソロ / リアルタイムの2層を宣言する（ADR 0004）。 */
export type GameKind = "solo" | "realtime";

/**
 * 起動画面の持ち方（issue-30）。
 *
 * - shared: 基盤共通の起動画面（ロゴ・タイトル・タグライン・遊び方・「はじめる」）を通る
 * - custom: 起動画面をゲーム自身が持つ。基盤は共通画面を挟まず、そのままゲームに委ねる
 */
export type LaunchScreen = "shared" | "custom";

/**
 * 選択画面の自動生成に使うゲームの自己記述。
 *
 * ソロゲームは kind を "solo" とし、minPlayers / maxPlayers は 1 を宣言する。
 * リアルタイムゲームは参加可能な人数の範囲を宣言する。
 */
export interface GameManifest {
	/** ゲームの一意な識別子。registry のキー、多重化の gameType と対応する。 */
	readonly id: string;
	/**
	 * 画面に出す名称（日本語名 / issue-69）。選択画面・ロビー・起動画面・ゲーム画面・結果画面・
	 * ページの題名が、ここから引く。内部の識別子（id）とは別で、変えても id は変わらない。
	 */
	readonly title: string;
	/**
	 * 読み上げ（aria-label）と、ロゴの画像の代替の文字（alt）に使う名称（issue-69）。title が
	 * 読み上げに向かない文字（テ〇〇ス など）のときだけ書く。無ければ title を使う。
	 */
	readonly spokenTitle?: string;
	/** ソロ / リアルタイムの別。 */
	readonly kind: GameKind;
	/** 参加可能な最小人数。ソロは 1。 */
	readonly minPlayers: number;
	/** 参加可能な最大人数。ソロは 1。 */
	readonly maxPlayers: number;
	/**
	 * ゲームのロゴ（ゲームパッケージ / issue-69）。無い・画像が読めないときは、背景の色と、
	 * 表示名の頭文字の仮のタイルを出す。
	 */
	readonly logo?: GameLogo;
	/** 選択画面に表示する短い説明。 */
	readonly description: string;
	/** 起動画面を基盤共通にするか、ゲーム自身が持つか。 */
	readonly launchScreen: LaunchScreen;
	/** 起動画面に出すキャッチコピー的な一文。 */
	readonly tagline?: string;
	/** 起動画面に出す遊び方の要点（箇条書き）。 */
	readonly howToPlay?: readonly string[];
	/**
	 * 起動画面用のビジュアル（thumbnail より高解像度な想定）。画像の実体が無くても、
	 * 共通起動画面はフォールバック表示で崩れない。
	 */
	readonly titleScreenImage?: string;
	/**
	 * ルーム作成時に作成者が選ぶ設定（リアルタイムゲームのみ）。ロビーはこの宣言から
	 * プルダウンを組み立てるだけで、個々のゲームを知らない（ADR 0003）。
	 * 選んだ値はルーム一覧には出さない（入室後に初めて分かる / ADR 0024）。
	 */
	readonly roomOptions?: readonly RoomOption[];
}

/**
 * ゲームのロゴ（issue-69）。画面の側だけが使い、サーバーへは送らない（Gleam の側に対応する型は無い）。
 */
export interface GameLogo {
	/** 画像のパス（apps/web/public/games/<id>/logo.svg など）。無ければ仮のタイル。 */
	readonly src?: string;
	/** 背景の色（"#rrggbb"）。ロゴの下地と、仮のタイルの色。暗い画面でも明るい画面でも見えるよう、ロゴの側に持つ。 */
	readonly background: string;
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
	/**
	 * 値ごとのプルダウンの表示名（任意）。無い値は数値をそのまま出す。送る値は数値のまま。
	 * 例: veryare の CPU（0 = なし、4 = 鬼 CPU）。
	 */
	readonly choiceLabels?: Readonly<Record<number, string>>;
}
