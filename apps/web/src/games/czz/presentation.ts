/**
 * czz の演出（起動画面・マスコット・音）の決め方。本家（.reference/czz/apps/user）の
 * bgmRoutes・マスコットの出し分け・マニュアル URL の検証を、画面遷移の代わりに
 * czz 内の画面（Screen）で引けるよう移したもの。副作用は持たない。
 *
 * 素材は本家から、使うものだけを public/games/czz/ に持ち込んでいる。提供元はクレジット
 * （CREDITS）に載せ、起動画面から開けるようにする。
 */

/** czz の中の画面。ルートは持たず、Czz.tsx の中で切り替える。 */
export type Screen = "title" | "credits" | "play" | "result";

/** 初心者モード（パステル・マスコット・BGM）と通常モード（ダーク）。保存しない（ADR 0019）。 */
export type UiMode = "beginner" | "advanced";

export const ASSETS = {
	bgm: {
		top: "/games/czz/audio/bgm/top.m4a",
		stage2loop: "/games/czz/audio/bgm/stage2loop.m4a",
		stage3loop: "/games/czz/audio/bgm/stage3loop.m4a",
		result: "/games/czz/audio/bgm/result.m4a",
	},
	sfx: {
		start: "/games/czz/audio/sfx/start.mp3",
		ok: "/games/czz/audio/sfx/OK.mp3",
		ng: "/games/czz/audio/sfx/NG.mp3",
	},
	characters: {
		studying: "/games/czz/characters/studying.gif",
		indicating: "/games/czz/characters/indicating.gif",
		cheering: "/games/czz/characters/cheering.gif",
		rejoicing: "/games/czz/characters/rejoicing.gif",
		failing: "/games/czz/characters/failing.gif",
	},
} as const;

export interface BgmTrack {
	readonly src: string;
	readonly loop: boolean;
	readonly volume: number;
}

/** 本家と同じ FNV-1a の簡易ハッシュ。お題ごとに曲を決まった形で選ぶ。 */
function stableHash(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/**
 * 画面で流す BGM。本家と同じく初心者モードで BGM がオンのときだけ鳴らす。
 * 起動画面・クレジットは top、出題中はお題ごとに stage2loop / stage3loop、結果は result。
 */
export function bgmFor(
	screen: Screen,
	taskId: string | null,
	settings: { readonly mode: UiMode; readonly bgmEnabled: boolean },
): BgmTrack | null {
	if (settings.mode !== "beginner" || !settings.bgmEnabled) return null;
	switch (screen) {
		case "title":
		case "credits":
			return { src: ASSETS.bgm.top, loop: true, volume: 0.5 };
		case "play": {
			const src =
				stableHash(taskId ?? "") % 2 === 0
					? ASSETS.bgm.stage2loop
					: ASSETS.bgm.stage3loop;
			return { src, loop: true, volume: 0.5 };
		}
		case "result":
			return { src: ASSETS.bgm.result, loop: false, volume: 0.6 };
	}
}

/** マスコットの反応。採点前は一緒に考え、正解で喜び、不正解で励ます。 */
export type MascotMood = "studying" | "success" | "encourage";

export function mascotFor(lastPassed: boolean | null): MascotMood {
	if (lastPassed === null) return "studying";
	return lastPassed ? "success" : "encourage";
}

/** 本家の BeginnerMascotDock の出し分け（画像と一言）。 */
export const MASCOT: Record<MascotMood, { src: string; message: string }> = {
	studying: { src: ASSETS.characters.studying, message: "いっしょにやろう" },
	success: { src: ASSETS.characters.indicating, message: "おめでとう！" },
	encourage: {
		src: ASSETS.characters.cheering,
		message: "もう一回見直してみよう",
	},
};

/** 結果画面のキャラクター。全問正解なら喜び、それ以外はくやしがる。 */
export function resultCharacter(score: number, total: number): string {
	return score >= total
		? ASSETS.characters.rejoicing
		: ASSETS.characters.failing;
}

/**
 * マニュアルの URL を検証する（本家の manual-link と同じ）。https の Google ドキュメント
 * だけを通し、それ以外・未設定は null（リンクを出さない）。
 */
export function pickManualUrl(value: string | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "https:") return null;
		if (!url.href.startsWith("https://docs.google.com/")) return null;
		return url.toString();
	} catch {
		return null;
	}
}

/** 素材・音源の提供元（本家のクレジットから、rondo に持ち込んだ素材の分）。 */
export const CREDITS = [
	{
		label: "動くキャラクター",
		name: "うごかわっ 様",
		url: "https://ugokawaii.com/",
	},
	{ label: "BGM全般", name: "魔王魂 様", url: "https://maou.audio/" },
	{
		label: "効果音全般",
		name: "効果音ラボ 様",
		url: "https://soundeffect-lab.info/",
	},
] as const;
