/**
 * rolling（内部名 tilt-maze）の表示文字列（issue-36 / issue-39）。
 *
 * 画面に出す名前・説明・案内はここにまとめ、名称変更の影響をこのファイルに閉じる。
 * 内部の識別子（gameType の tilt-maze、ディレクトリ名）は契約と Gleam 側の対応
 * （ADR 0009）に関わるため変えない。
 */

import type { Difficulty } from "./engine";

export const TEXT = {
	/** 画面上の名前（英小文字）。 */
	name: "rolling",
	description: "パッドで球を転がして、毎回生まれる迷路を抜けよう。",
	tagline: "転がして、抜けろ。",
	howToPlay: [
		"パッドを倒した向きに球が転がる",
		"迷路の大きさを選ぶ。迷路は毎回新しく作られる",
		"迷ったら「お助け」。最短の道を教えてくれる",
	],
	chooseMode: "モードを選んでください",
	soloMode: "1人モード",
	soloModeNote: "自分のペースで迷路を抜ける",
	versusMode: "対戦モード",
	versusModeNote: "みんなで速さを競う",
	versusUnavailable: "対戦モードは準備中です。もうしばらくお待ちください。",
	close: "閉じる",
	chooseDifficulty: "迷路の大きさを選んでください",
	difficulty: {
		small: "小",
		medium: "中",
		large: "大",
	} satisfies Record<Difficulty, string>,
	difficultyNote: (cells: number) => `${cells}×${cells} マス`,
	padHint: "パッドを倒した向きに球が転がる",
	/** 画面の隅に出す、使っているアルゴリズムの名前。 */
	algorithmMaze: "迷路づくり: クラスカル法（ユニオンファインド）",
	algorithmPath: "お助け: 幅優先探索",
	seed: (seed: number) => `seed ${seed}`,
	revealing: "最短経路を表示しています",
	cleared: "クリア！",
	shortestSteps: "最短経路",
	yourSteps: "あなたが通ったマス",
	hintsUsed: "お助け",
	steps: (n: number) => `${n} マス`,
	times: (n: number) => `${n} 回`,
	retry: "もう一度（新しい迷路）",
	changeDifficulty: "大きさを選び直す",
	finish: "おわる",
} as const;
