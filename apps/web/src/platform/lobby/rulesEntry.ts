/**
 * 新しい規則（ADR 0053 の動ける隠れ側と増え鬼）の選択肢を、ロビーに出す入口。URL に ?rules=1 があれば出し、
 * その端末に覚える（localStorage。読み書きは try/catch で囲み、使えなくても動く）。?rules=0 で解除する。
 * 実行時の判定で、ビルド時の旗（ROAMING_READY・SPREADING_READY と開発用の環境変数）は、そのまま効く
 * （どれか 1 つでも真なら出す）。
 *
 * 画面を出すだけで、受け付けるかはサーバーが決める（サーバーは、旗と関わらず、選択肢の値を受け付ける）。
 * どの選択肢を足すかは、ゲームの側が決める（games/registry の ruleRoomOptions）。
 */

import type { RoomOption } from "@rondo/contracts";

export const RULES_STORAGE_KEY = "rondo.lobby.rules";

/** localStorage のうち、使う部分（テストで差し替える）。 */
export interface RulesStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * 規則の選択肢を出すか。?rules=1 なら出して覚え、?rules=0 なら出さずに覚えを消す。どちらも無ければ、
 * 覚えた値のとおり（無い・読めなければ出さない）。
 */
export function rulesEntryOn(
	search: string,
	storage: RulesStorage | null,
): boolean {
	const asked = new URLSearchParams(search).get("rules");
	if (asked === "1" || asked === "0") {
		const on = asked === "1";
		try {
			storage?.setItem(RULES_STORAGE_KEY, on ? "on" : "off");
		} catch {
			// 使えない端末（プライベートモードなど）では、覚えない。
		}
		return on;
	}
	try {
		return storage?.getItem(RULES_STORAGE_KEY) === "on";
	} catch {
		return false;
	}
}

/** 端末の localStorage（使えなければ null）。 */
export function rulesStorage(): RulesStorage | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

/** 規則の選択肢 extra のうち、options に無いものを、最後に足す（旗ですでに出ているものは重ねない）。 */
export function withRuleOptions(
	options: readonly RoomOption[],
	extra: readonly RoomOption[],
): RoomOption[] {
	const keys = new Set(options.map((option) => option.key));
	return [...options, ...extra.filter((option) => !keys.has(option.key))];
}
