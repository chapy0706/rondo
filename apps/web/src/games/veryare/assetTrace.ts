/**
 * 素材の流れを Console に出す（開発中だけ / issue-46 の調べ）。
 *
 * 平屋の glb が使われないとき、どこで止まったかを見えるようにする。先読みを始めたか（始めなかった
 * 理由）、manifest の取得の結果、4本の読み込みの結果、差し替え口の作り方、差し替えたか、ステージに
 * 入ったときに箱のままだった理由を、1行ずつ出す。
 *
 * 出すのは、開発用の変数（NEXT_PUBLIC_VERYARE_HIRAYA=1）があるときか、URL に ?roof=1 があるときだけ。
 * 本番の既定では何も出さない。文言と判定は純粋関数（テスト済み）で、出すのは devTrace だけ。
 */

import type { LoadResult } from "../../infrastructure/assets";
import { HIRAYA_DEV } from "./manifest";

/** 和室の小物の数と重さ（roomPropKit.ts の propStats）。 */
export interface PropStats {
	readonly props: number;
	readonly rooms: number;
	readonly drawCalls: number;
	readonly triangles: number;
}

export type AssetEvent =
	| { readonly kind: "prefetch-start" }
	| { readonly kind: "prefetch-skip"; readonly reason: "hiraya-disabled" }
	| { readonly kind: "prefetch-error"; readonly message: string }
	| {
			readonly kind: "manifest";
			readonly status: "ok" | "disabled" | "unavailable";
	  }
	| {
			readonly kind: "load";
			readonly key: string;
			readonly ok: boolean;
			readonly reason?: string;
	  }
	| { readonly kind: "slot"; readonly from: "prefetch" | "new" }
	| { readonly kind: "swapped" }
	| {
			readonly kind: "fusuma";
			readonly nodes: number;
			readonly edges: number;
	  }
	| { readonly kind: "furniture"; readonly boxes: number | null }
	/** 和室の小物（issue-72）。stats が null なら、キットの形が違う（小物なし）。 */
	| { readonly kind: "props"; readonly stats: PropStats | null }
	| { readonly kind: "character"; readonly swapped: boolean }
	| { readonly kind: "materials"; readonly applied: true }
	| {
			readonly kind: "materials";
			readonly applied: false;
			readonly reason: "no-slot" | "not-received" | "invalid";
	  }
	| { readonly kind: "stage"; readonly display: "model" }
	| {
			readonly kind: "stage";
			readonly display: "boxes";
			readonly reason: "no-stage" | "not-hiraya" | "no-slot" | "too-late";
	  };

const PREFIX = "[veryare-assets] ";

/** 出すか。開発用の変数か、URL の ?roof=1（search は location.search）。 */
export function traceEnabled(dev: boolean, search: string): boolean {
	return dev || new URLSearchParams(search).get("roof") === "1";
}

const MATERIAL_REASONS = {
	"no-slot": "材質の差し替え口が無い",
	"not-received":
		"読めない、または待機ルームの間に読み終わらなかった。詳しくは stage-materials の行",
	invalid: "素材の形が違う。鍵・extras・色の絵を確かめる",
} as const;

const BOX_REASONS = {
	"no-stage": "ステージの通知が届いていない",
	"not-hiraya": "平屋の通知ではない（ランダム間取り）",
	"no-slot": "平屋の差し替え口が無い",
	"too-late": "待機ルームの間に読み終わらなかった（lock に間に合わなかった）",
} as const;

export function traceMessage(event: AssetEvent): string {
	switch (event.kind) {
		case "prefetch-start":
			return "ロビー: 平屋の glb の先読みを始めた";
		case "prefetch-skip":
			return "ロビー: 先読みしない（HIRAYA_ENABLED が false。平屋の選択肢を出さない設定）";
		case "prefetch-error":
			return `ロビー: 先読みを始められない（${event.message}）`;
		case "manifest":
			return {
				ok: "manifest.json: 取得できた",
				disabled:
					"manifest.json: 取りに行かない（NEXT_PUBLIC_ASSET_BASE_URL が未設定）",
				unavailable:
					"manifest.json: 取得できない（URL・CORS・形を確かめる。詳しくは [assets] の行）",
			}[event.status];
		case "load":
			return event.ok
				? `${event.key}: 読めた`
				: `${event.key}: 読めない（${event.reason ?? "不明"}）`;
		case "slot":
			return event.from === "prefetch"
				? "対戦: 先読みの結果を、差し替え口に使う"
				: "対戦: 平屋の glb の読み込みを始めた（先読みは無い、または使用済み）";
		case "swapped":
			return "待機ルーム: 平屋の glb に差し替えた";
		case "fusuma":
			return `襖: 操作軸 ${event.nodes} 組を見つけ、襖の辺 ${event.edges} 本に対応づけた（平屋は 10 組・108 本）`;
		case "character":
			return event.swapped
				? "キャラクター: 素材の体に差し替えた"
				: "キャラクター: 体かポーズの表が壊れているので、仮のカプセルのまま";
		case "materials":
			return event.applied
				? "材質: 貼った（ランダム間取りの箱に、平屋の材質）"
				: `材質: 色の箱のまま（${MATERIAL_REASONS[event.reason]}）`;
		case "furniture":
			return event.boxes === null
				? "家具の箱: 読めない（地図の守りだけ）"
				: `家具の箱: ${event.boxes} 個（カメラの守りに使う）`;
		case "props":
			return event.stats === null
				? "和室の小物: キットの形が違うので、小物なし"
				: `和室の小物: ${event.stats.props} 個（${event.stats.rooms} 部屋）、描画の呼び出し ${event.stats.drawCalls}、三角形 +${event.stats.triangles}`;
		case "stage":
			return event.display === "model"
				? "ステージ: 平屋の glb で表示している"
				: `ステージ: 箱のまま（${BOX_REASONS[event.reason]}）`;
	}
}

/** 有効なときだけ、印つきの1行を log に出す。 */
export function createTracer(
	enabled: boolean,
	log: (line: string) => void,
): (event: AssetEvent) => void {
	return (event) => {
		if (enabled) log(PREFIX + traceMessage(event));
	};
}

/**
 * 平屋の読み込みの結果（4本）から、manifest の取得の結果を出す。どれかが読めたか、manifest より後の理由
 * （manifest に無い・404・壊れた glb など）で失敗していれば、manifest は取得できている。
 */
export function manifestStatus(
	results: readonly LoadResult<unknown>[],
): "ok" | "disabled" | "unavailable" {
	if (results.some((r) => r.ok)) return "ok";
	if (results.every((r) => !r.ok && r.reason === "disabled")) return "disabled";
	if (results.every((r) => !r.ok && r.reason === "manifest-unavailable")) {
		return "unavailable";
	}
	return "ok";
}

/** ステージに入ったときの表示と、箱のままの理由。 */
export function stageDisplayEvent(state: {
	readonly hasGrid: boolean;
	readonly hiraya: boolean;
	readonly hasSlot: boolean;
	readonly swapped: boolean;
}): AssetEvent {
	if (state.swapped && state.hiraya) return { kind: "stage", display: "model" };
	if (!state.hasGrid)
		return { kind: "stage", display: "boxes", reason: "no-stage" };
	if (!state.hiraya) {
		return { kind: "stage", display: "boxes", reason: "not-hiraya" };
	}
	if (!state.hasSlot)
		return { kind: "stage", display: "boxes", reason: "no-slot" };
	return { kind: "stage", display: "boxes", reason: "too-late" };
}

/** 本番の出口（console.info）。開くたびに、いまの URL で出すかを決める。 */
export function devTrace(event: AssetEvent): void {
	const search = typeof window === "undefined" ? "" : window.location.search;
	createTracer(traceEnabled(HIRAYA_DEV, search), (line) => console.info(line))(
		event,
	);
}

/**
 * ステージに入ったときの、ランダム間取りの材質（貼ったか、色の箱のままの理由）。平屋のときは null
 * （出さない）。received は差し替え口から受け取ったか、applied は素材の形が正しく貼ったか。
 */
export function stageMaterialEvent(state: {
	readonly hiraya: boolean;
	readonly hasSlot: boolean;
	readonly received: boolean;
	readonly applied: boolean;
}): AssetEvent | null {
	if (state.hiraya) return null;
	if (state.applied) return { kind: "materials", applied: true };
	if (state.received)
		return { kind: "materials", applied: false, reason: "invalid" };
	if (!state.hasSlot)
		return { kind: "materials", applied: false, reason: "no-slot" };
	return { kind: "materials", applied: false, reason: "not-received" };
}
