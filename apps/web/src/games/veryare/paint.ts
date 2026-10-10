/**
 * 人間のペイント（ADR 0025・0037 の簡略版 / issue-25）。純粋関数で、three.js と React を使わない。
 *
 * 描き込み面は、胴（体全体）の円柱1本。面の上の位置は、円柱を回る角度 u（0〜1。正面 +z が 0、
 * +x が 0.25）と、高さ v（0 が足もと、1 が頭）。体のシェーダー（body.ts）も同じ式で u・v を
 * 求めるので、ここで描いた位置が体の同じ所に映る。
 *
 * - 描く: タップの光線と円柱の交差（intersectCylinder）で u・v を求め、ストロークに点を足す。
 *   u・v は小数第3位に丸めて持つ（送る形と、自分の画面の見た目を同じにする）。誠実なクライアントは
 *   上限（VERYARE_PAINT_LIMITS）を超えない
 * - 映す: ストロークを、描き込み面に描く楕円の一覧にする（strokeDabs）。u の端（継ぎ目）をまたぐ
 *   ストロークは近い向きで埋め、端に近い楕円は反対の端にも写す
 * - 送る: ペイントフェーズの終わりの 2 秒前か、「塗り終わり」を押したときに、一度だけ。何も塗って
 *   いなければ送らない（ADR 0025）
 */

import {
	VERYARE_PAINT_LIMITS,
	type VeryarePaint,
	type VeryarePaintEvent,
	type VeryareStroke,
	type VeryareStrokePoint,
} from "@rondo/contracts";
import { placeColor } from "./palette";
import { UNPAINTED_COLOR } from "./palette";
import type { Phase, Point, Role } from "./rules";
import { type StageGrid, cellAt } from "./stage";

/** 体の円柱（体のローカル座標。仮のカプセルの胴に合わせる）。 */
export const BODY_CYLINDER = { radius: 0.2, yMin: -0.5, yMax: 0.5 } as const;

/** ブラシの大きさ（半径。u・v の単位）。 */
export const BRUSH_SIZES = { small: 0.02, medium: 0.04, large: 0.08 } as const;

/** ペイントフェーズの終わりの、確定（自動で送る）までの時間（ミリ秒）。この間は描けない。 */
export const PAINT_LOCK_MS = 2000;

/** 描き込み面の大きさ（ピクセル）。円周（約 1.26 m）が高さ（1 m）より長いので横長にする。 */
export const PAINT_TEXTURE = { width: 256, height: 128 } as const;

export interface Vec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface Ray {
	readonly origin: Vec3;
	readonly direction: Vec3;
}

/** 光線（体のローカル座標）と体の円柱の、手前の交差。外れ・高さの外は null。 */
export function intersectCylinder(
	ray: Ray,
): { readonly u: number; readonly v: number; readonly point: Vec3 } | null {
	const { radius, yMin, yMax } = BODY_CYLINDER;
	const { origin: o, direction: d } = ray;
	const a = d.x * d.x + d.z * d.z;
	if (a === 0) return null;
	const b = 2 * (o.x * d.x + o.z * d.z);
	const c = o.x * o.x + o.z * o.z - radius * radius;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return null;
	const root = Math.sqrt(disc);
	for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
		if (t <= 0) continue;
		const point = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
		if (point.y < yMin || point.y > yMax) return null;
		return { ...uvOf(point), point };
	}
	return null;
}

/** 体のローカル座標の点の u・v（体のシェーダーと同じ式）。 */
export function uvOf(point: Vec3): VeryareStrokePoint {
	const { yMin, yMax } = BODY_CYLINDER;
	const turn = Math.atan2(point.x, point.z) / (2 * Math.PI);
	return { u: turn - Math.floor(turn), v: (point.y - yMin) / (yMax - yMin) };
}

// --- ストロークの編集 ---------------------------------------------------------------

/** 描いている途中のペイント。strokes は送る形のまま（丸めた u・v）。 */
export interface PaintDraft {
	readonly strokes: readonly VeryareStroke[];
}

export const emptyDraft: PaintDraft = { strokes: [] };

export function pointCount(draft: PaintDraft): number {
	return draft.strokes.reduce((total, s) => total + s.points.length, 0);
}

function round(value: number): number {
	const scale = 10 ** VERYARE_PAINT_LIMITS.decimals;
	return Math.min(1, Math.max(0, Math.round(value * scale) / scale));
}

function rounded(point: VeryareStrokePoint): VeryareStrokePoint {
	return { u: round(point.u), v: round(point.v) };
}

/** u の差（継ぎ目をまたぐときは近い向き。-0.5〜0.5）。 */
function deltaU(from: number, to: number): number {
	const d = to - from;
	return d - Math.round(d);
}

function uvDistance(a: VeryareStrokePoint, b: VeryareStrokePoint): number {
	return Math.hypot(deltaU(a.u, b.u), b.v - a.v);
}

/** 新しいストロークを描き始める。上限に達していれば、そのまま。 */
export function beginStroke(
	draft: PaintDraft,
	start: {
		readonly color: string;
		readonly size: number;
		readonly point: VeryareStrokePoint;
	},
): PaintDraft {
	const { maxStrokes, maxPoints } = VERYARE_PAINT_LIMITS;
	if (draft.strokes.length >= maxStrokes || pointCount(draft) >= maxPoints) {
		return draft;
	}
	const stroke: VeryareStroke = {
		part: "torso",
		color: start.color,
		size: start.size,
		points: [rounded(start.point)],
	};
	return { strokes: [...draft.strokes, stroke] };
}

/** 描いているストロークに点を足す。前の点からブラシの半径の半分より近い点と、上限を超える点は足さない。 */
export function extendStroke(
	draft: PaintDraft,
	point: VeryareStrokePoint,
): PaintDraft {
	const last = draft.strokes.at(-1);
	if (last === undefined) return draft;
	if (pointCount(draft) >= VERYARE_PAINT_LIMITS.maxPoints) return draft;
	const next = rounded(point);
	const previous = last.points.at(-1);
	if (previous !== undefined && uvDistance(previous, next) < last.size / 2) {
		return draft;
	}
	return {
		strokes: [
			...draft.strokes.slice(0, -1),
			{ ...last, points: [...last.points, next] },
		],
	};
}

export function undoStroke(draft: PaintDraft): PaintDraft {
	return { strokes: draft.strokes.slice(0, -1) };
}

export function clearPaint(_draft: PaintDraft): PaintDraft {
	return emptyDraft;
}

/** ペイントの確定の電文（契約: VeryarePaintEvent）。 */
export function paintEvent(
	strokes: readonly VeryareStroke[],
): VeryarePaintEvent {
	return { type: "paint", paint: { kind: "strokes", strokes } };
}

// --- 映す ---------------------------------------------------------------------------

/** 描き込み面に描く楕円（ピクセル）。 */
export interface Dab {
	readonly x: number;
	readonly y: number;
	readonly rx: number;
	readonly ry: number;
	readonly color: string;
}

/** ストロークの点の間を、半径の半分以下の間隔で埋めた点（u は継ぎ目の外へはみ出してよい）。 */
function filled(stroke: VeryareStroke): VeryareStrokePoint[] {
	const [first, ...rest] = stroke.points;
	if (first === undefined) return [];
	const out: VeryareStrokePoint[] = [first];
	let previous = first;
	for (const point of rest) {
		const du = deltaU(previous.u, point.u);
		const dv = point.v - previous.v;
		const steps = Math.max(
			1,
			Math.ceil(Math.hypot(du, dv) / (stroke.size / 2) - 1e-9),
		);
		for (let i = 1; i <= steps; i++) {
			out.push({
				u: previous.u + (du * i) / steps,
				v: previous.v + (dv * i) / steps,
			});
		}
		previous = { u: previous.u + du, v: point.v };
	}
	return out;
}

/** ストロークを、描き込み面（width × height）に描く楕円の一覧にする。描く順はストロークの順。 */
export function strokeDabs(
	strokes: readonly VeryareStroke[],
	width: number,
	height: number,
): Dab[] {
	const dabs: Dab[] = [];
	for (const stroke of strokes) {
		const rx = stroke.size * width;
		const ry = stroke.size * height;
		for (const point of filled(stroke)) {
			const u = point.u - Math.floor(point.u);
			const x = u * width;
			const y = (1 - point.v) * height;
			dabs.push({ x, y, rx, ry, color: stroke.color });
			if (x - rx < 0)
				dabs.push({ x: x + width, y, rx, ry, color: stroke.color });
			if (x + rx > width)
				dabs.push({ x: x - width, y, rx, ry, color: stroke.color });
		}
	}
	return dabs;
}

// --- 色 -----------------------------------------------------------------------------

/** ここの色: いまいるマスの代表色（palette.ts の表）。 */
export function hereColor(grid: StageGrid, position: Point): string {
	return placeColor(grid, cellAt(grid, position));
}

/** 体のスポイト: その位置にいちばん上に塗られた色。塗っていなければ未塗装の色。 */
export function bodyColorAt(
	strokes: readonly VeryareStroke[],
	at: VeryareStrokePoint,
): string {
	for (let i = strokes.length - 1; i >= 0; i--) {
		const stroke = strokes[i] as VeryareStroke;
		if (filled(stroke).some((p) => uvDistance(p, at) <= stroke.size + 1e-9)) {
			return stroke.color;
		}
	}
	return UNPAINTED_COLOR;
}

/** グラデーションの色（色相 0〜360、鮮やかさ・明るさ 0〜100）を "#rrggbb" にする。 */
export function hslToHex(h: number, s: number, l: number): string {
	const sat = s / 100;
	const light = l / 100;
	const k = (n: number) => (n + h / 30) % 12;
	const a = sat * Math.min(light, 1 - light);
	const channel = (n: number) => {
		const value = light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// --- 送る ---------------------------------------------------------------------------

/** 送るか。ペイントフェーズで、まだ送っておらず、何か塗っていて、「塗り終わり」か残り 2 秒以下。 */
export function shouldSubmitPaint(options: {
	readonly phase: Phase;
	readonly remainingMs: number;
	readonly submitted: boolean;
	readonly confirmed: boolean;
	readonly strokeCount: number;
}): boolean {
	const { phase, remainingMs, submitted, confirmed, strokeCount } = options;
	if (phase !== "painting" || submitted || strokeCount === 0) return false;
	return confirmed || remainingMs <= PAINT_LOCK_MS;
}

/** 描き込めるか。ペイントフェーズの隠れ側（観戦でない）で、送る前、残りが 2 秒より多い間だけ。 */
export function canEditPaint(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly spectator: boolean;
	readonly submitted: boolean;
	readonly remainingMs: number;
}): boolean {
	const { phase, role, spectator, submitted, remainingMs } = options;
	return (
		phase === "painting" &&
		role === "hider" &&
		!spectator &&
		!submitted &&
		remainingMs > PAINT_LOCK_MS
	);
}

// --- 読む ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const COLOR = /^#[0-9a-f]{6}$/;

function isUnit(value: unknown): value is number {
	return typeof value === "number" && value >= 0 && value <= 1;
}

function readStroke(value: unknown): VeryareStroke | null {
	if (!isRecord(value)) return null;
	const { part, color, size, points } = value;
	const { minSize, maxSize } = VERYARE_PAINT_LIMITS;
	if (part !== "torso" || typeof color !== "string" || !COLOR.test(color)) {
		return null;
	}
	if (typeof size !== "number" || size < minSize || size > maxSize) return null;
	if (!Array.isArray(points) || points.length === 0) return null;
	const read: VeryareStrokePoint[] = [];
	for (const p of points) {
		if (!isRecord(p) || !isUnit(p.u) || !isUnit(p.v)) return null;
		read.push({ u: p.u, v: p.v });
	}
	return { part, color, size, points: read };
}

/** 届いたペイント（全面1色・ストローク）を境で検証して読む。形や上限に合わなければ null。 */
export function parsePaint(value: unknown): VeryarePaint | null {
	if (!isRecord(value)) return null;
	if (value.kind === "uniform") {
		return typeof value.color === "string" && COLOR.test(value.color)
			? { kind: "uniform", color: value.color }
			: null;
	}
	if (value.kind !== "strokes" || !Array.isArray(value.strokes)) return null;
	const { maxStrokes, maxPoints } = VERYARE_PAINT_LIMITS;
	if (value.strokes.length === 0 || value.strokes.length > maxStrokes) {
		return null;
	}
	const strokes: VeryareStroke[] = [];
	let points = 0;
	for (const s of value.strokes) {
		const stroke = readStroke(s);
		if (stroke === null) return null;
		points += stroke.points.length;
		if (points > maxPoints) return null;
		strokes.push(stroke);
	}
	return { kind: "strokes", strokes };
}
