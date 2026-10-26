import { describe, expect, it, vi } from "vitest";
import {
	createTracer,
	manifestStatus,
	stageDisplayEvent,
	stageMaterialEvent,
	traceEnabled,
	traceMessage,
} from "./assetTrace";

describe("traceEnabled - 素材の流れを Console に出すか（開発中だけ）", () => {
	it("開発用の変数があるとき、または URL に ?roof=1 があるときだけ出す", () => {
		expect(traceEnabled(true, "")).toBe(true);
		expect(traceEnabled(false, "?roof=1")).toBe(true);
	});

	it("本番の既定（変数なし・URL の指定なし）では出さない", () => {
		expect(traceEnabled(false, "")).toBe(false);
		expect(traceEnabled(false, "?roof=0")).toBe(false);
	});
});

describe("createTracer - 有効なときだけ、1行ずつ出す", () => {
	it("有効なら、印つきの1行を出す。無効なら何も出さない", () => {
		const log = vi.fn();
		createTracer(true, log)({ kind: "prefetch-start" });
		expect(log).toHaveBeenCalledTimes(1);
		expect(log.mock.calls[0]?.[0]).toMatch(/^\[veryare-assets\] /);
		const silent = vi.fn();
		createTracer(false, silent)({ kind: "prefetch-start" });
		expect(silent).not.toHaveBeenCalled();
	});
});

describe("traceMessage - 和室の小物（issue-72）", () => {
	it("小物の数・部屋の数・描画の呼び出し・三角形の増えを出す。キットの形が違えば、小物なし", () => {
		expect(
			traceMessage({
				kind: "props",
				stats: { props: 30, rooms: 12, drawCalls: 5, triangles: 16000 },
			}),
		).toBe("和室の小物: 30 個（12 部屋）、描画の呼び出し 5、三角形 +16000");
		expect(traceMessage({ kind: "props", stats: null })).toBe(
			"和室の小物: キットの形が違うので、小物なし",
		);
	});
});

describe("traceMessage - 出す文言", () => {
	it("先読みを始めた・始めなかった理由・失敗", () => {
		expect(traceMessage({ kind: "prefetch-start" })).toContain(
			"先読みを始めた",
		);
		expect(
			traceMessage({ kind: "prefetch-skip", reason: "hiraya-disabled" }),
		).toContain("HIRAYA_ENABLED が false");
		expect(
			traceMessage({ kind: "prefetch-error", message: "chunk を読めない" }),
		).toContain("chunk を読めない");
	});

	it("manifest の取得の結果と、3本の読み込みの結果", () => {
		expect(traceMessage({ kind: "manifest", status: "disabled" })).toContain(
			"NEXT_PUBLIC_ASSET_BASE_URL",
		);
		expect(traceMessage({ kind: "manifest", status: "unavailable" })).toContain(
			"取得できない",
		);
		expect(traceMessage({ kind: "manifest", status: "ok" })).toContain(
			"取得できた",
		);
		expect(
			traceMessage({ kind: "load", key: "hiraya-indoor", ok: true }),
		).toContain("hiraya-indoor: 読めた");
		expect(
			traceMessage({
				kind: "load",
				key: "hiraya-roof",
				ok: false,
				reason: "http-error",
			}),
		).toContain("hiraya-roof: 読めない（http-error）");
	});

	it("差し替え口の作り方・差し替えた・箱のままの理由", () => {
		expect(traceMessage({ kind: "slot", from: "prefetch" })).toContain(
			"先読みの結果",
		);
		expect(traceMessage({ kind: "slot", from: "new" })).toContain(
			"読み込みを始めた",
		);
		expect(traceMessage({ kind: "swapped" })).toContain("差し替えた");
		expect(traceMessage({ kind: "fusuma", nodes: 10, edges: 108 })).toContain(
			"10 組を見つけ、襖の辺 108 本",
		);
		expect(traceMessage({ kind: "character", swapped: true })).toBe(
			"キャラクター: 素材の体に差し替えた",
		);
		expect(traceMessage({ kind: "character", swapped: false })).toBe(
			"キャラクター: 体かポーズの表が壊れているので、仮のカプセルのまま",
		);
		expect(traceMessage({ kind: "furniture", boxes: 120 })).toBe(
			"家具の箱: 120 個（カメラの守りに使う）",
		);
		expect(traceMessage({ kind: "furniture", boxes: null })).toBe(
			"家具の箱: 読めない（地図の守りだけ）",
		);
		expect(
			traceMessage({ kind: "stage", display: "boxes", reason: "not-hiraya" }),
		).toContain("平屋の通知ではない");
		expect(
			traceMessage({ kind: "stage", display: "boxes", reason: "too-late" }),
		).toContain("間に合わなかった");
		expect(
			traceMessage({ kind: "stage", display: "boxes", reason: "no-stage" }),
		).toContain("ステージの通知が届いていない");
		expect(traceMessage({ kind: "stage", display: "model" })).toContain(
			"平屋の glb",
		);
	});
});

describe("manifestStatus - 3本の読み込みの結果から、manifest の取得の結果を出す", () => {
	it("どれかが読めた、または manifest より後の理由で失敗していれば、取得できた", () => {
		expect(
			manifestStatus([
				{ ok: true, value: 1 },
				{ ok: false, reason: "http-error" },
			]),
		).toBe("ok");
		expect(manifestStatus([{ ok: false, reason: "not-in-manifest" }])).toBe(
			"ok",
		);
	});

	it("基準 URL が無ければ disabled、manifest が取れなければ unavailable", () => {
		expect(manifestStatus([{ ok: false, reason: "disabled" }])).toBe(
			"disabled",
		);
		expect(
			manifestStatus([
				{ ok: false, reason: "manifest-unavailable" },
				{ ok: false, reason: "manifest-unavailable" },
			]),
		).toBe("unavailable");
	});
});

describe("stageDisplayEvent - ステージに入ったときの表示と、箱のままの理由", () => {
	it("差し替え済みで平屋の地図なら、平屋の glb", () => {
		expect(
			stageDisplayEvent({
				hasGrid: true,
				hiraya: true,
				hasSlot: true,
				swapped: true,
			}),
		).toEqual({ kind: "stage", display: "model" });
	});

	it("箱のままの理由: 通知が無い・平屋でない・間に合わなかった", () => {
		expect(
			stageDisplayEvent({
				hasGrid: false,
				hiraya: false,
				hasSlot: false,
				swapped: false,
			}),
		).toEqual({ kind: "stage", display: "boxes", reason: "no-stage" });
		expect(
			stageDisplayEvent({
				hasGrid: true,
				hiraya: false,
				hasSlot: false,
				swapped: false,
			}),
		).toEqual({ kind: "stage", display: "boxes", reason: "not-hiraya" });
		expect(
			stageDisplayEvent({
				hasGrid: true,
				hiraya: true,
				hasSlot: true,
				swapped: false,
			}),
		).toEqual({ kind: "stage", display: "boxes", reason: "too-late" });
		expect(
			stageDisplayEvent({
				hasGrid: true,
				hiraya: true,
				hasSlot: false,
				swapped: false,
			}),
		).toEqual({ kind: "stage", display: "boxes", reason: "no-slot" });
	});
});

describe("stageMaterialEvent - ランダム間取りの材質（貼った / 色の箱のままの理由）", () => {
	it("平屋のときは出さない。貼ったか、色の箱のままの理由を1つ返す", () => {
		const base = {
			hiraya: false,
			hasSlot: true,
			received: true,
			applied: true,
		};
		expect(stageMaterialEvent({ ...base, hiraya: true })).toBeNull();
		expect(stageMaterialEvent(base)).toEqual({
			kind: "materials",
			applied: true,
		});
		expect(stageMaterialEvent({ ...base, applied: false })).toEqual({
			kind: "materials",
			applied: false,
			reason: "invalid",
		});
		expect(
			stageMaterialEvent({ ...base, received: false, applied: false }),
		).toEqual({ kind: "materials", applied: false, reason: "not-received" });
		expect(
			stageMaterialEvent({
				...base,
				hasSlot: false,
				received: false,
				applied: false,
			}),
		).toEqual({ kind: "materials", applied: false, reason: "no-slot" });
	});

	it("文言", () => {
		expect(traceMessage({ kind: "materials", applied: true })).toBe(
			"材質: 貼った（ランダム間取りの箱に、平屋の材質）",
		);
		expect(
			traceMessage({ kind: "materials", applied: false, reason: "no-slot" }),
		).toBe("材質: 色の箱のまま（材質の差し替え口が無い）");
		expect(
			traceMessage({
				kind: "materials",
				applied: false,
				reason: "not-received",
			}),
		).toBe(
			"材質: 色の箱のまま（読めない、または待機ルームの間に読み終わらなかった。詳しくは stage-materials の行）",
		);
		expect(
			traceMessage({ kind: "materials", applied: false, reason: "invalid" }),
		).toBe(
			"材質: 色の箱のまま（素材の形が違う。鍵・extras・色の絵を確かめる）",
		);
	});
});
