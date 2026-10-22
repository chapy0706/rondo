/**
 * 場面と BGM の対応（issue-63）。データはここ 1 か所に持つ。
 *
 * - 開始画面・選択画面・ロビー（・設定）: top
 * - veryare の画面: ゲームが知らせた BGM（鬼選出は top、準備移動から答え合わせは game、終了は無音）。
 *   ゲームが知らせる前（起動画面・接続中）は、待機ルームの手前なので top
 * - 結果画面: 無音（game を小さくして止める）
 * - veryare 以外のゲームの画面: 無音（決めた範囲の外）
 */

import type { BgmKey, SoundKey } from "./keys";

/** BGM を鳴らすゲームの画面（/play/<id>）。 */
const BGM_GAMES: readonly string[] = ["veryare"];

/** top を鳴らす画面。 */
function isTopPage(path: string): boolean {
	return (
		path === "/" ||
		path === "/select" ||
		path === "/settings" ||
		path.startsWith("/lobby/")
	);
}

function trimPath(path: string): string {
	return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function bgmGameOf(path: string): string | null {
	const match = /^\/play\/([^/]+)$/.exec(path);
	if (match === null) return null;
	const id = match[1] as string;
	return BGM_GAMES.includes(id) ? id : null;
}

/**
 * いまの BGM。game はゲームが知らせた BGM（undefined は、まだ知らせていない。null は無音）。
 * result は結果画面を出しているか。
 */
export function bgmFor(scene: {
	readonly path: string;
	readonly game: BgmKey | null | undefined;
	readonly result: boolean;
}): BgmKey | null {
	const path = trimPath(scene.path);
	if (isTopPage(path)) return "bgm-top";
	if (bgmGameOf(path) === null) return null;
	if (scene.result) return null;
	return scene.game === undefined ? "bgm-top" : scene.game;
}

/** 最初の操作のあとに読む素材（順番どおり）。効果音は小さいので先に、game は最後に読む。 */
export function preloadKeysFor(rawPath: string): readonly SoundKey[] {
	const first: SoundKey[] = ["bgm-top", "se-count", "se-start"];
	if (bgmGameOf(trimPath(rawPath)) === null) return first;
	return [...first, "se-hit", "se-miss", "se-paint", "bgm-game"];
}
