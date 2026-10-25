/**
 * 人間のペイント（ADR 0025・0037 / issue-25・issue-54）。純粋関数で、three.js と React を使わない。
 *
 * 描き込み面は、部位ごとの円柱（5部位の円柱と、描き込み面の並べ方は paintParts.ts）。ここの体の円柱は
 * 胴の円柱で、面の上の位置は、円柱を回る角度 u（0〜1。正面 +z が 0、+x が 0.25）と、高さ v（0 が
 * 足もと、1 が頭）。体のシェーダー（body.ts）も同じ式で u・v を求めるので、ここで描いた位置が体の
 * 同じ所に映る。仮のカプセルは、胴の円柱だけを使う。
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
	VERYARE_PAINT_PARTS,
	type VeryareModelPose,
	type VeryarePaint,
	type VeryarePaintEvent,
	type VeryarePaintPart,
	type VeryareStroke,
	type VeryareStrokePoint,
} from "@rondo/contracts";
import { BODY_HEIGHT, BODY_RADIUS, HEAD_RADIUS } from "./bodySize";
import { FLOOR_COLOR, UNPAINTED_COLOR, placeColor } from "./palette";
import type { Phase, Point, Role } from "./rules";
import { type StageGrid, cellAt } from "./stage";

/** 体の円柱（体のローカル座標。足もとが原点で、高さは体の高さ / bodySize.ts）。 */
export const BODY_CYLINDER = {
	radius: BODY_RADIUS,
	yMin: 0,
	yMax: BODY_HEIGHT,
} as const;

/**
 * 長さ（メートル）を、ブラシの半径（u・v の単位）にする。胴の円柱を回る向きの長さで割る（小数第3位に
 * 丸める）。胴の円柱では、縦（v）の 1 は体の高さで、回る向きより長いので、どの向きにも、この長さより
 * 小さくならない。
 */
export function brushSizeOf(meters: number): number {
	return Math.round((meters / (2 * Math.PI * BODY_RADIUS)) * 1000) / 1000;
}

/** ブラシ「中」「小」の大きさの、頭の半径（bodySize.ts の HEAD_RADIUS）に対する割合（あとから変えられる）。 */
export const BRUSH_STEPS = { small: 1 / 4, medium: 1 / 2 } as const;

/**
 * ブラシ「大」の大きさ（半径。u・v の単位。あとから変えられる）。細かく塗るより、全体をたくさん塗れるよう、
 * 頭の半径（0.064）より大きくした。サーバーの上限（VERYARE_PAINT_LIMITS.maxSize = 0.15）の内側。
 */
export const BRUSH_LARGE = 0.12;

/** ブラシの大きさ（半径。u・v の単位）。 */
export const BRUSH_SIZES = {
	small: brushSizeOf(HEAD_RADIUS * BRUSH_STEPS.small),
	medium: brushSizeOf(HEAD_RADIUS * BRUSH_STEPS.medium),
	large: BRUSH_LARGE,
} as const;

/** 全身を塗るときの半径（u・v の単位。サーバーの上限 0.15 の内側）。 */
export const FILL_SIZE = 0.14;

/** 全身を塗るときの、行（v）の間隔と、行の中の点（u）の間隔。行の間は FILL_SIZE の 2 倍より狭くする。 */
const FILL_ROW_STEP = 0.2;
const FILL_U_STEP = 0.25;

/** ペイントフェーズの終わりの、確定（自動で送る）までの時間（ミリ秒）。この間は描けない。 */
export const PAINT_LOCK_MS = 2000;

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

/**
 * 描き込み面の上の点と、その部位（5本円柱 / issue-54。paintParts.ts）。部位を省くと胴（仮のカプセルと、
 * issue-25 の胴だけの描き込み面）。
 */
export interface PaintPoint extends VeryareStrokePoint {
	readonly part?: VeryarePaintPart;
}

/**
 * 描いている途中のペイント。strokes は送る形のまま（丸めた u・v）。fills は、全身を塗ったとき（fillBody）の、
 * 最初のストロークの番号（1つ戻すで、部位の数の本数をまとめて戻す）。全身を塗っていなければ省く。
 */
export interface PaintDraft {
	readonly strokes: readonly VeryareStroke[];
	readonly fills?: readonly number[];
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
		readonly point: PaintPoint;
	},
): PaintDraft {
	const { maxStrokes, maxPoints } = VERYARE_PAINT_LIMITS;
	if (draft.strokes.length >= maxStrokes || pointCount(draft) >= maxPoints) {
		return draft;
	}
	const stroke: VeryareStroke = {
		part: start.point.part ?? "torso",
		color: start.color,
		size: start.size,
		points: [rounded(start.point)],
	};
	return { ...draft, strokes: [...draft.strokes, stroke] };
}

/**
 * 描いているストロークに点を足す。前の点からブラシの半径の半分より近い点と、上限を超える点は足さない。
 * 点が別の部位に移ったら、同じ色・太さで、その部位の新しいストロークを描き始める（issue-54）。
 */
export function extendStroke(draft: PaintDraft, point: PaintPoint): PaintDraft {
	const last = draft.strokes.at(-1);
	if (last === undefined) return draft;
	if ((point.part ?? "torso") !== last.part) {
		return beginStroke(draft, { color: last.color, size: last.size, point });
	}
	if (pointCount(draft) >= VERYARE_PAINT_LIMITS.maxPoints) return draft;
	const next = rounded(point);
	const previous = last.points.at(-1);
	if (previous !== undefined && uvDistance(previous, next) < last.size / 2) {
		return draft;
	}
	return {
		...draft,
		strokes: [
			...draft.strokes.slice(0, -1),
			{ ...last, points: [...last.points, next] },
		],
	};
}

/** 全身の塗りの番号の一覧を持たせる（空なら省く）。 */
function withFills(
	strokes: readonly VeryareStroke[],
	fills: readonly number[],
): PaintDraft {
	return fills.length === 0 ? { strokes } : { strokes, fills };
}

/**
 * 1つ戻す。いちばん最後が全身の塗り（fillBody）なら、その部位の数の本数をまとめて戻す。ほかは 1 本ずつ。
 */
export function undoStroke(draft: PaintDraft): PaintDraft {
	const fills = draft.fills ?? [];
	const last = fills.at(-1);
	if (
		last !== undefined &&
		last + VERYARE_PAINT_PARTS.length === draft.strokes.length
	) {
		return withFills(draft.strokes.slice(0, last), fills.slice(0, -1));
	}
	const strokes = draft.strokes.slice(0, -1);
	return withFills(
		strokes,
		fills.filter(
			(start) => start + VERYARE_PAINT_PARTS.length <= strokes.length,
		),
	);
}

/**
 * 全身を塗るストローク（部位ごとに 1 本。契約の部位の順）。どの部位も、u・v の 0〜1 の全体を、半径
 * FILL_SIZE の点で覆う: 行（v）を FILL_ROW_STEP ごとに、行の中を u の FILL_U_STEP ごとに、行ごとに向きを
 * 変えて、1 本の線でつなぐ（線の間は、映すときに埋める / strokeDabs）。ストロークは部位ごとなので、1 本では
 * 腕と脚を塗れない。
 */
export function fillStrokes(color: string): VeryareStroke[] {
	const rows = Math.round(1 / FILL_ROW_STEP);
	const steps = Math.round(1 / FILL_U_STEP);
	const points: VeryareStrokePoint[] = [];
	for (let row = 0; row <= rows; row++) {
		const v = round(row / rows);
		for (let i = 0; i <= steps; i++) {
			const k = row % 2 === 0 ? i : steps - i;
			points.push({ u: round(k / steps), v });
		}
	}
	return VERYARE_PAINT_PARTS.map((part) => ({
		part,
		color,
		size: FILL_SIZE,
		points,
	}));
}

/**
 * 全身を塗る（いま選んでいる色で、1 回で）。いまの塗りの後に足し、1つ戻すで、まとめて取り消せる。上限
 * （本数・点の数）に入りきらないときは、前の塗りを置き換える（どのみち全部を覆う）。
 */
export function fillBody(draft: PaintDraft, color: string): PaintDraft {
	const fill = fillStrokes(color);
	const { maxStrokes, maxPoints } = VERYARE_PAINT_LIMITS;
	const fillPoints = fill.reduce((n, s) => n + s.points.length, 0);
	if (
		draft.strokes.length + fill.length > maxStrokes ||
		pointCount(draft) + fillPoints > maxPoints
	) {
		return { strokes: fill, fills: [0] };
	}
	return {
		strokes: [...draft.strokes, ...fill],
		fills: [...(draft.fills ?? []), draft.strokes.length],
	};
}

export function clearPaint(_draft: PaintDraft): PaintDraft {
	return emptyDraft;
}

/**
 * ペイントの確定の電文（契約: VeryarePaintEvent）。塗っていなければ paint は null。選んだポーズ
 * （issue-56）があれば pose を載せる（無ければ省く）。
 */
export function paintEvent(
	strokes: readonly VeryareStroke[],
	pose: VeryareModelPose | null,
): VeryarePaintEvent {
	const paint =
		strokes.length > 0 ? { kind: "strokes" as const, strokes } : null;
	return pose === null
		? { type: "paint", paint }
		: { type: "paint", paint, pose };
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

/**
 * 塗る色。色はスポイトだけで取る（picked）。拾う前は、足もとの面の色: 平屋の glb を出していれば
 * 見た目の色（sceneHere / surfaceColor.ts）、出していなければ、その場の代表色（tableHere / hereColor）、
 * どちらも無ければ廊下の色。
 */
export function paintColorOf(colors: {
	readonly picked: string | null;
	readonly sceneHere: string | null;
	readonly tableHere: string | null;
}): string {
	return colors.picked ?? colors.sceneHere ?? colors.tableHere ?? FLOOR_COLOR;
}

/** 体のスポイト: その部位のその位置に、いちばん上に塗られた色。塗っていなければ未塗装の色。 */
export function bodyColorAt(
	strokes: readonly VeryareStroke[],
	at: PaintPoint,
): string {
	const part = at.part ?? "torso";
	for (let i = strokes.length - 1; i >= 0; i--) {
		const stroke = strokes[i] as VeryareStroke;
		if (stroke.part !== part) continue;
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

/**
 * 送るか。ペイントフェーズで、まだ送っておらず、何か塗っているかポーズを選んでいて（issue-56）、
 * 「塗り終わり」か残り 2 秒以下。
 */
export function shouldSubmitPaint(options: {
	readonly phase: Phase;
	readonly remainingMs: number;
	readonly submitted: boolean;
	readonly confirmed: boolean;
	readonly strokeCount: number;
	readonly poseChosen: boolean;
}): boolean {
	const { phase, remainingMs, submitted, confirmed, strokeCount, poseChosen } =
		options;
	if (phase !== "painting" || submitted) return false;
	if (strokeCount === 0 && !poseChosen) return false;
	return confirmed || remainingMs <= PAINT_LOCK_MS;
}

/**
 * 画面の送る判断（Veryare.tsx の副作用）。sent は、確定の電文をもう送ったか（自動・「塗り終わり」）。
 * 送っていれば、残りの違うフェーズの通知が届いても（画面ロックからの復帰など / ADR 0046）、送らない。
 * 送っていなければ、shouldSubmitPaint のとおり（残り 2 秒以下の通知が届いたら、届いた直後に送る）。
 */
export function submitPaintNow(
	sent: boolean,
	input: {
		readonly phase: Phase;
		readonly remainingMs: number;
		readonly confirmed: boolean;
		readonly strokeCount: number;
		readonly poseChosen: boolean;
	},
): boolean {
	return !sent && shouldSubmitPaint({ ...input, submitted: sent });
}

/** 描き込めるか。ペイントフェーズの隠れ側（観戦でない）で、送る前、残りが 2 秒より多い間だけ。 */
export function canEditPaint(options: {
	readonly phase: Phase;
	readonly role: Role;
	readonly spectator: boolean;
	readonly submitted: boolean;
	readonly remainingMs: number;
	/** 動ける隠れ側の規則（ADR 0053）。ペイントと探索の間、何度でも塗り直せる（確定も締め切りも無い）。 */
	readonly roaming?: boolean;
}): boolean {
	const { phase, role, spectator, submitted, remainingMs } = options;
	if (options.roaming === true) {
		return (
			(phase === "painting" || phase === "exploration") &&
			role === "hider" &&
			!spectator
		);
	}
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

const PARTS: ReadonlySet<unknown> = new Set(VERYARE_PAINT_PARTS);

function isPart(value: unknown): value is VeryarePaintPart {
	return PARTS.has(value);
}

function isUnit(value: unknown): value is number {
	return typeof value === "number" && value >= 0 && value <= 1;
}

function readStroke(value: unknown): VeryareStroke | null {
	if (!isRecord(value)) return null;
	const { part, color, size, points } = value;
	const { minSize, maxSize } = VERYARE_PAINT_LIMITS;
	if (!isPart(part) || typeof color !== "string" || !COLOR.test(color)) {
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
