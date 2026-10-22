/**
 * 音の素材の key（issue-63）。素材の配信の manifest の audio 欄で、この key を引く
 * （ゲームのコードに、ファイル名を直接書かない）。鳴らすのは、この 7 つだけ。
 */

export const BGM_KEYS = ["bgm-top", "bgm-game"] as const;
export const SE_KEYS = [
	"se-hit",
	"se-miss",
	"se-count",
	"se-start",
	"se-paint",
] as const;
export const SOUND_KEYS = [...BGM_KEYS, ...SE_KEYS] as const;

export type BgmKey = (typeof BGM_KEYS)[number];
export type SeKey = (typeof SE_KEYS)[number];
export type SoundKey = BgmKey | SeKey;

export function isBgmKey(key: SoundKey): key is BgmKey {
	return (BGM_KEYS as readonly string[]).includes(key);
}
