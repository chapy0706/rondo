/**
 * 天井のあり・なし（画面の隅の設定）。既定は「あり」。選んだ値は、その端末に覚える（localStorage。
 * ADR 0019 の追記: 表示の設定も端末に保存してよい）。読み書きは try/catch で囲み、使えなくても動く
 * （読めなければ既定の「あり」、書けなければ、その画面を開いている間だけ覚える）。
 *
 * - ランダム間取り: 天井の箱（stageBoxes.ts の ceiling）を、設定のとおりに見せる
 * - 平屋: 屋根と天井の glb のうち、天井のノード（名前が「天井」で始まる）を設定のとおりに、屋根のノードは
 *   開発用の屋根の切り替えのとおりに見せる
 */

export const CEILING_STORAGE_KEY = "rondo.veryare.ceiling";

/** localStorage のうち、使う部分（テストで差し替える）。 */
export interface SettingStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** 覚えた値を読む。無い・読めない・知らない値なら、既定の「あり」。 */
export function loadCeiling(storage: SettingStorage | null): boolean {
	try {
		return storage?.getItem(CEILING_STORAGE_KEY) !== "off";
	} catch {
		return true;
	}
}

/** 選んだ値を覚える。書けなければ何もしない。 */
export function saveCeiling(
	storage: SettingStorage | null,
	shown: boolean,
): void {
	try {
		storage?.setItem(CEILING_STORAGE_KEY, shown ? "on" : "off");
	} catch {
		// 使えない端末（プライベートモードなど）では、覚えない。
	}
}

/** ランダム間取りの天井を見せるか。 */
export function stageCeilingVisible(ceiling: boolean): boolean {
	return ceiling;
}

/** 平屋の屋根と天井の glb の、一番上のノードを見せるか（name は元の名前）。 */
export function roofNodeVisible(
	name: string,
	roofVisible: boolean,
	ceiling: boolean,
): boolean {
	return name.startsWith("天井") ? ceiling : roofVisible;
}

/** 本番の localStorage（無い・触れない環境では null）。 */
export function browserStorage(): SettingStorage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}
