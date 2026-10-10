"use client";

/**
 * ペイント画面の道具（issue-25）。色（ここの色・表の色・グラデーション）、スポイト、ブラシの
 * 大きさ、1つ戻す、全部消す、塗り終わり。判断は持たず、Veryare.tsx の状態を見せて変えるだけ。
 * 体に描く操作は 3D の画面（canvas）のタップで行う。
 */

import type { BRUSH_SIZES } from "./paint";
import { FLOOR_COLOR, ROOM_COLORS } from "./palette";

export type BrushName = keyof typeof BRUSH_SIZES;

/** グラデーションの色（色相 0〜360、鮮やかさ・明るさ 0〜100）。 */
export interface Hsl {
	readonly h: number;
	readonly s: number;
	readonly l: number;
}

const BRUSH_LABELS: Record<BrushName, string> = {
	small: "小",
	medium: "中",
	large: "大",
};

const ROOM_LABELS: Record<string, string> = {
	washitsu: "和室",
	"washitsu-oshiire": "押入れ付き和室",
	"washitsu-kakejiku": "床の間付き和室",
	oshiire: "押入れ",
};

const TABLE = [
	{ label: "廊下", color: FLOOR_COLOR },
	...Object.entries(ROOM_COLORS).map(([room, color]) => ({
		label: ROOM_LABELS[room] ?? room,
		color,
	})),
];

const BUTTON =
	"min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset disabled:opacity-50 aria-pressed:ring-4 aria-pressed:ring-fg";

export function PaintPanel(props: {
	readonly editable: boolean;
	readonly submitted: boolean;
	readonly locked: boolean;
	readonly strokeCount: number;
	readonly color: string;
	readonly here: string | null;
	readonly brush: BrushName;
	readonly eyedropper: boolean;
	readonly hsl: Hsl;
	readonly onColor: (color: string) => void;
	readonly onHsl: (hsl: Hsl) => void;
	readonly onBrush: (brush: BrushName) => void;
	readonly onEyedropper: () => void;
	readonly onUndo: () => void;
	readonly onClear: () => void;
	readonly onConfirm: () => void;
}) {
	const { editable, submitted, locked, strokeCount, color, here } = props;
	const status = submitted
		? "ペイントを確定しました"
		: locked
			? "あと2秒で確定（もう塗れません）"
			: props.eyedropper
				? "スポイト: 床・壁・自分の体をタップすると、その色を拾います"
				: "自分の体をなぞって塗れます（視点パッドで体の周りを回れます）";
	const swatch = (label: string, value: string, big = false) => (
		<button
			key={`${label}-${value}`}
			type="button"
			disabled={!editable}
			aria-label={`${label} ${value}`}
			aria-pressed={color === value}
			onClick={() => props.onColor(value)}
			className={`${big ? "size-14" : "size-11"} rounded-full ring-inset disabled:opacity-50 ${
				color === value ? "ring-4 ring-fg" : "ring-1 ring-line"
			}`}
			style={{ backgroundColor: value }}
		/>
	);
	const slider = (label: string, key: keyof Hsl, max: number) => (
		<label className="flex items-center gap-2 text-fg-muted text-xs">
			<span className="w-16 shrink-0">{label}</span>
			<input
				type="range"
				min={0}
				max={max}
				value={props.hsl[key]}
				disabled={!editable}
				onChange={(event) =>
					props.onHsl({ ...props.hsl, [key]: Number(event.target.value) })
				}
				className="w-full"
			/>
		</label>
	);
	return (
		<section
			className="flex flex-col gap-3"
			data-testid="veryare-paint"
			data-strokes={strokeCount}
			data-submitted={submitted}
		>
			<p className="rounded-xl bg-surface px-3 py-2 font-semibold text-fg text-sm">
				{status}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{here !== null ? (
					<span className="flex items-center gap-2 text-fg-muted text-xs">
						ここの色
						{swatch("ここの色", here, true)}
					</span>
				) : null}
				{TABLE.map((entry) => swatch(entry.label, entry.color))}
			</div>
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-fg-muted text-xs">
					グラデーション（選んでいる色:
					<span
						aria-hidden="true"
						className="ml-1 inline-block size-3 rounded-full align-middle ring-1 ring-line"
						style={{ backgroundColor: color }}
					/>
					）
				</legend>
				{slider("色相", "h", 360)}
				{slider("鮮やかさ", "s", 100)}
				{slider("明るさ", "l", 100)}
			</fieldset>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					disabled={!editable}
					aria-pressed={props.eyedropper}
					onClick={props.onEyedropper}
					className={BUTTON}
				>
					スポイト
				</button>
				{(Object.keys(BRUSH_LABELS) as BrushName[]).map((name) => (
					<button
						key={name}
						type="button"
						disabled={!editable}
						aria-pressed={props.brush === name}
						onClick={() => props.onBrush(name)}
						className={BUTTON}
					>
						ブラシ {BRUSH_LABELS[name]}
					</button>
				))}
			</div>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					disabled={!editable || strokeCount === 0}
					onClick={props.onUndo}
					className={BUTTON}
				>
					1つ戻す
				</button>
				<button
					type="button"
					disabled={!editable || strokeCount === 0}
					onClick={props.onClear}
					className={BUTTON}
				>
					全部消す
				</button>
				<button
					type="button"
					disabled={!editable || strokeCount === 0}
					onClick={props.onConfirm}
					data-testid="veryare-paint-done"
					className="min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-fg text-sm disabled:opacity-50"
				>
					塗り終わり
				</button>
			</div>
		</section>
	);
}
