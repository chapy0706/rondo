/**
 * rolling（内部名 tilt-maze）の表示文字列（issue-36）。
 *
 * 画面に出す名前・説明・案内はここにまとめ、名称変更の影響をこのファイルに閉じる。
 * 内部の識別子（gameType の tilt-maze、ディレクトリ名）は契約と Gleam 側の対応
 * （ADR 0009）に関わるため変えない。
 */

import { TOTAL_LEVELS } from "./engine";

export const TEXT = {
	/** 画面上の名前（英小文字）。 */
	name: "rolling",
	description: `パッドで球を転がして、${TOTAL_LEVELS}つの迷路を抜けよう。`,
	tagline: "転がして、抜けろ。",
	howToPlay: [
		"パッドを倒した向きに球が転がる",
		"ゴールに入ると次の迷路へ進む",
		`${TOTAL_LEVELS}つの迷路をすべて抜けるとクリア`,
	],
	chooseMode: "モードを選んでください",
	soloMode: "1人モード",
	soloModeNote: "自分のペースで迷路を抜ける",
	versusMode: "対戦モード",
	versusModeNote: "みんなで速さを競う",
	versusUnavailable: "対戦モードは準備中です。もうしばらくお待ちください。",
	close: "閉じる",
	padHint: "パッドを倒した向きに球が転がる",
	stage: (current: number, total: number) => `面 ${current} / ${total}`,
	cleared: (total: number) => `全 ${total} 面クリア。上が今回の軌跡です。`,
} as const;
