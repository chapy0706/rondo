import { VERYARE_PAINT_LIMITS, type VeryareStroke } from "@rondo/contracts";
import { describe, expect, it } from "vitest";
import movement from "../../../../../packages/contracts/src/fixtures/veryare-movement.json";
import paintFixture from "../../../../../packages/contracts/src/fixtures/veryare-paint.json";
import {
	BODY_CYLINDER,
	BRUSH_SIZES,
	PAINT_LOCK_MS,
	beginStroke,
	bodyColorAt,
	canEditPaint,
	clearPaint,
	emptyDraft,
	extendStroke,
	hereColor,
	hslToHex,
	intersectCylinder,
	paintEvent,
	parsePaint,
	pointCount,
	shouldSubmitPaint,
	strokeDabs,
	undoStroke,
} from "./paint";
import { FLOOR_COLOR, ROOM_COLORS, UNPAINTED_COLOR } from "./palette";
import { parseStageNotice } from "./stage";

const tiny = parseStageNotice(movement.stage);
if (tiny === null) throw new Error("見本が読めない");

describe("intersectCylinder - タップの光線と、体の円柱の交差（体のローカル座標）", () => {
	const { radius, yMin, yMax } = BODY_CYLINDER;
	const mid = (yMin + yMax) / 2;

	it("正面（+z）から真っすぐ当てると u = 0、高さの真ん中で v = 0.5", () => {
		const hit = intersectCylinder({
			origin: { x: 0, y: mid, z: 3 },
			direction: { x: 0, y: 0, z: -1 },
		});
		expect(hit?.u).toBeCloseTo(0);
		expect(hit?.v).toBeCloseTo(0.5);
		expect(hit?.point.z).toBeCloseTo(radius);
	});

	it("+x から当てると u = 0.25、-z から当てると u = 0.5、-x から当てると u = 0.75", () => {
		const from = (x: number, z: number) =>
			intersectCylinder({
				origin: { x, y: mid, z },
				direction: { x: -x, y: 0, z: -z },
			})?.u;
		expect(from(3, 0)).toBeCloseTo(0.25);
		expect(from(0, -3)).toBeCloseTo(0.5);
		expect(from(-3, 0)).toBeCloseTo(0.75);
	});

	it("手前の面に当たる。足もとは v = 0、頭は v = 1", () => {
		const low = intersectCylinder({
			origin: { x: 0, y: yMin + 0.0001, z: 3 },
			direction: { x: 0, y: 0, z: -1 },
		});
		const high = intersectCylinder({
			origin: { x: 0, y: yMax - 0.0001, z: 3 },
			direction: { x: 0, y: 0, z: -1 },
		});
		expect(low?.v).toBeCloseTo(0, 3);
		expect(high?.v).toBeCloseTo(1, 3);
	});

	it("外れた光線・高さの外・後ろ向きの光線は null", () => {
		expect(
			intersectCylinder({
				origin: { x: 1, y: mid, z: 3 },
				direction: { x: 0, y: 0, z: -1 },
			}),
		).toBeNull();
		expect(
			intersectCylinder({
				origin: { x: 0, y: yMax + 0.1, z: 3 },
				direction: { x: 0, y: 0, z: -1 },
			}),
		).toBeNull();
		expect(
			intersectCylinder({
				origin: { x: 0, y: mid, z: 3 },
				direction: { x: 0, y: 0, z: 1 },
			}),
		).toBeNull();
	});
});

describe("ストロークの編集（誠実なクライアントは上限を超えない）", () => {
	it("描き始めと、ブラシの半分以上離れた点だけを足す。u・v は小数第3位に丸める", () => {
		let draft = beginStroke(emptyDraft, {
			color: "#a07850",
			size: 0.04,
			point: { u: 0.12345, v: 0.5 },
		});
		draft = extendStroke(draft, { u: 0.13, v: 0.5 });
		draft = extendStroke(draft, { u: 0.2, v: 0.5 });
		expect(draft.strokes).toEqual([
			{
				part: "torso",
				color: "#a07850",
				size: 0.04,
				points: [
					{ u: 0.123, v: 0.5 },
					{ u: 0.2, v: 0.5 },
				],
			},
		]);
	});

	it("u の端をまたぐ距離は、近い向きで測る（0.99 → 0.01 は 0.02 しか離れていない）", () => {
		let draft = beginStroke(emptyDraft, {
			color: "#a07850",
			size: 0.08,
			point: { u: 0.99, v: 0.5 },
		});
		draft = extendStroke(draft, { u: 0.01, v: 0.5 });
		expect(draft.strokes[0]?.points).toHaveLength(1);
	});

	it("1つ戻す・全部消す", () => {
		let draft = beginStroke(emptyDraft, {
			color: "#a07850",
			size: 0.04,
			point: { u: 0.1, v: 0.1 },
		});
		draft = beginStroke(draft, {
			color: "#6b5440",
			size: 0.04,
			point: { u: 0.5, v: 0.5 },
		});
		expect(undoStroke(draft).strokes.map((s) => s.color)).toEqual(["#a07850"]);
		expect(clearPaint(draft).strokes).toEqual([]);
		expect(undoStroke(emptyDraft).strokes).toEqual([]);
	});

	it("どれだけ描いても、本数は 100 本・点は合わせて 1000 点を超えない", () => {
		let draft = emptyDraft;
		for (let i = 0; i < 300; i++) {
			draft = beginStroke(draft, {
				color: "#a07850",
				size: 0.01,
				point: { u: (i % 97) / 97, v: 0.1 },
			});
			for (let k = 1; k < 30; k++) {
				draft = extendStroke(draft, {
					u: (i % 97) / 97,
					v: Math.min(1, 0.1 + k * 0.02),
				});
			}
		}
		expect(draft.strokes.length).toBeLessThanOrEqual(
			VERYARE_PAINT_LIMITS.maxStrokes,
		);
		expect(pointCount(draft)).toBeLessThanOrEqual(
			VERYARE_PAINT_LIMITS.maxPoints,
		);
		expect(pointCount(draft)).toBe(VERYARE_PAINT_LIMITS.maxPoints);
	});

	it("ブラシの大きさは3段階で、上限の範囲の中", () => {
		for (const size of Object.values(BRUSH_SIZES)) {
			expect(size).toBeGreaterThanOrEqual(VERYARE_PAINT_LIMITS.minSize);
			expect(size).toBeLessThanOrEqual(VERYARE_PAINT_LIMITS.maxSize);
		}
		expect(Object.keys(BRUSH_SIZES)).toHaveLength(3);
	});

	it("送る電文は、共有の見本の valid と同じ形", () => {
		const sample = paintFixture.valid[0] as {
			paint: { strokes: VeryareStroke[] };
		};
		expect(paintEvent(sample.paint.strokes)).toEqual(paintFixture.valid[0]);
	});
});

describe("strokeDabs - ストロークを、描き込み面（w × h ピクセル）に描く楕円の一覧にする", () => {
	const stroke = (
		points: { u: number; v: number }[],
		size = 0.05,
	): VeryareStroke => ({
		part: "torso",
		color: "#a07850",
		size,
		points,
	});

	it("1点は1つの楕円。v = 1 が上端（y = 0）", () => {
		expect(strokeDabs([stroke([{ u: 0.5, v: 1 }])], 200, 100)).toEqual([
			{ x: 100, y: 0, rx: 10, ry: 5, color: "#a07850" },
		]);
	});

	it("離れた2点の間は、半径の半分以下の間隔で埋める", () => {
		const dabs = strokeDabs(
			[
				stroke([
					{ u: 0.1, v: 0.5 },
					{ u: 0.4, v: 0.5 },
				]),
			],
			200,
			100,
		);
		const xs = dabs.map((d) => d.x).sort((a, b) => a - b);
		for (let i = 1; i < xs.length; i++) {
			expect((xs[i] as number) - (xs[i - 1] as number)).toBeLessThanOrEqual(
				5 + 1e-9,
			);
		}
		expect(xs[0]).toBeCloseTo(20);
		expect(xs.at(-1)).toBeCloseTo(80);
	});

	it("u の端をまたぐときは、近い向き（継ぎ目の側）で埋め、真ん中を通らない", () => {
		const dabs = strokeDabs(
			[
				stroke([
					{ u: 0.95, v: 0.5 },
					{ u: 0.05, v: 0.5 },
				]),
			],
			200,
			100,
		);
		expect(dabs.every((d) => d.x <= 30 || d.x >= 170)).toBe(true);
	});

	it("端に近い楕円は、反対の端にも写しを描く（継ぎ目で切れない）", () => {
		const dabs = strokeDabs([stroke([{ u: 0.01, v: 0.5 }])], 200, 100);
		expect(dabs.map((d) => Math.round(d.x))).toEqual([2, 202]);
	});

	it("描く順は、ストロークの順（後のストロークが上に重なる）", () => {
		const dabs = strokeDabs(
			[
				{ ...stroke([{ u: 0.5, v: 0.5 }]), color: "#111111" },
				{ ...stroke([{ u: 0.5, v: 0.5 }]), color: "#222222" },
			],
			200,
			100,
		);
		expect(dabs.map((d) => d.color)).toEqual(["#111111", "#222222"]);
	});
});

describe("ここの色と、スポイト", () => {
	it("ここの色は、いまいるマスの代表色（部屋タイプの色・廊下の色）", () => {
		expect(hereColor(tiny, { x: 2.5, z: 0.5 })).toBe(ROOM_COLORS.washitsu);
		expect(hereColor(tiny, { x: 0.5, z: 0.5 })).toBe(FLOOR_COLOR);
	});

	it("体のスポイトは、その位置にいちばん上に塗られた色。塗っていなければ未塗装の色", () => {
		const strokes: VeryareStroke[] = [
			{
				part: "torso",
				color: "#111111",
				size: 0.05,
				points: [{ u: 0.5, v: 0.5 }],
			},
			{
				part: "torso",
				color: "#222222",
				size: 0.05,
				points: [{ u: 0.52, v: 0.5 }],
			},
			{
				part: "torso",
				color: "#333333",
				size: 0.05,
				points: [{ u: 0.99, v: 0.5 }],
			},
		];
		expect(bodyColorAt(strokes, { u: 0.5, v: 0.5 })).toBe("#222222");
		expect(bodyColorAt(strokes, { u: 0.45, v: 0.5 })).toBe("#111111");
		expect(bodyColorAt(strokes, { u: 0.01, v: 0.5 })).toBe("#333333");
		expect(bodyColorAt(strokes, { u: 0.25, v: 0.5 })).toBe(UNPAINTED_COLOR);
	});
});

describe("hslToHex - グラデーションの色（色相・鮮やかさ・明るさ）を #rrggbb にする", () => {
	it("基本の色と、白・黒・灰色", () => {
		expect(hslToHex(0, 100, 50)).toBe("#ff0000");
		expect(hslToHex(120, 100, 50)).toBe("#00ff00");
		expect(hslToHex(240, 100, 50)).toBe("#0000ff");
		expect(hslToHex(0, 0, 100)).toBe("#ffffff");
		expect(hslToHex(0, 0, 0)).toBe("#000000");
		expect(hslToHex(30, 0, 50)).toBe("#808080");
	});
});

describe("送るかの判断（終わりの 2 秒前か「塗り終わり」で、一度だけ）", () => {
	const base = {
		phase: "painting" as const,
		remainingMs: 10_000,
		submitted: false,
		confirmed: false,
		strokeCount: 3,
	};

	it("確定の時間は 2 秒", () => {
		expect(PAINT_LOCK_MS).toBe(2000);
	});

	it("「塗り終わり」を押したか、残りが 2 秒以下になったら送る", () => {
		expect(shouldSubmitPaint(base)).toBe(false);
		expect(shouldSubmitPaint({ ...base, confirmed: true })).toBe(true);
		expect(shouldSubmitPaint({ ...base, remainingMs: 2000 })).toBe(true);
		expect(shouldSubmitPaint({ ...base, remainingMs: 2001 })).toBe(false);
	});

	it("一度送ったら、二度と送らない。何も塗っていなければ送らない。ペイントフェーズ以外は送らない", () => {
		expect(
			shouldSubmitPaint({ ...base, confirmed: true, submitted: true }),
		).toBe(false);
		expect(
			shouldSubmitPaint({ ...base, confirmed: true, strokeCount: 0 }),
		).toBe(false);
		expect(
			shouldSubmitPaint({ ...base, confirmed: true, phase: "exploration" }),
		).toBe(false);
	});

	it("描き込めるのは、ペイントフェーズの隠れ側（観戦でない）で、送る前、残りが 2 秒より多い間だけ", () => {
		const edit = {
			phase: "painting" as const,
			role: "hider" as const,
			spectator: false,
			submitted: false,
			remainingMs: 5000,
		};
		expect(canEditPaint(edit)).toBe(true);
		expect(canEditPaint({ ...edit, remainingMs: 2000 })).toBe(false);
		expect(canEditPaint({ ...edit, submitted: true })).toBe(false);
		expect(canEditPaint({ ...edit, role: "oni" })).toBe(false);
		expect(canEditPaint({ ...edit, spectator: true })).toBe(false);
		expect(canEditPaint({ ...edit, phase: "preparation" })).toBe(false);
	});
});

describe("parsePaint - 届いたペイントを境で検証して読む", () => {
	it("共有の見本の valid のペイントを読み、invalid を捨てる", () => {
		for (const sample of paintFixture.valid) {
			expect(parsePaint(sample.paint)).toEqual(sample.paint);
		}
		// 全面1色は、人間が送る電文としては拒む（サーバーの検証）が、一括配信の中では隠れ CPU の
		// ペイントとして正しいので、ここでは除く。
		for (const sample of paintFixture.invalid) {
			const paint = (sample as { paint?: { kind?: unknown } }).paint;
			if (paint?.kind === "uniform") continue;
			expect(parsePaint(paint)).toBeNull();
		}
	});

	it("全面1色（隠れ CPU）も読む", () => {
		expect(parsePaint({ kind: "uniform", color: "#a07850" })).toEqual({
			kind: "uniform",
			color: "#a07850",
		});
	});

	it("上限ちょうどは読み、1つ超えると捨てる", () => {
		const one = {
			part: "torso",
			color: "#a07850",
			size: 0.04,
			points: [{ u: 0.5, v: 0.5 }],
		};
		const { maxStrokes, maxPoints } = VERYARE_PAINT_LIMITS;
		expect(
			parsePaint({ kind: "strokes", strokes: Array(maxStrokes).fill(one) }),
		).not.toBeNull();
		expect(
			parsePaint({ kind: "strokes", strokes: Array(maxStrokes + 1).fill(one) }),
		).toBeNull();
		const many = (n: number) => ({
			...one,
			points: Array(n).fill({ u: 0.5, v: 0.5 }),
		});
		expect(
			parsePaint({ kind: "strokes", strokes: [many(maxPoints - 1), one] }),
		).not.toBeNull();
		expect(
			parsePaint({ kind: "strokes", strokes: [many(maxPoints), one] }),
		).toBeNull();
	});
});
