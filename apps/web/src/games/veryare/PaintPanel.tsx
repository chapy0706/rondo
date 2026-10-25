"use client";

/**
 * ペイント画面の道具（issue-25）。スポイト、選んでいる色の見本、ブラシの大きさ、全身を塗る、1つ戻す、
 * 全部消す、塗り終わり。色はスポイトだけで取る（最初の色は、足もとの面の色 / paint.ts の paintColorOf）。判断は
 * 持たず、Veryare.tsx の状態を見せて変えるだけ。体に描く操作は 3D の画面（canvas）のタップで行う。
 */

import type { BRUSH_SIZES } from "./paint";

export type BrushName = keyof typeof BRUSH_SIZES;

const BRUSH_LABELS: Record<BrushName, string> = {
	small: "小",
	medium: "中",
	large: "大",
};

/** スポイト（押しやすい大きさのまま）。 */
const BUTTON =
	"min-h-11 rounded-xl bg-surface px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset disabled:opacity-50 aria-pressed:ring-4 aria-pressed:ring-fg";

/** ブラシの大きさと、全身を塗る・1つ戻す・全部消す・ポーズ（板を小さくするため、スポイトより低い）。 */
const SMALL_BUTTON =
	"min-h-9 rounded-lg bg-surface px-2.5 font-semibold text-fg text-xs ring-1 ring-line ring-inset disabled:opacity-50 aria-pressed:ring-4 aria-pressed:ring-fg";

/** 「塗り終わり」。塗ったか、ポーズを選んでいれば押せる。 */
export function PaintConfirmButton(props: {
	readonly editable: boolean;
	readonly strokeCount: number;
	readonly poseChosen: boolean;
	readonly onConfirm: () => void;
}) {
	return (
		<button
			type="button"
			disabled={
				!props.editable || (props.strokeCount === 0 && !props.poseChosen)
			}
			onClick={props.onConfirm}
			data-testid="veryare-paint-done"
			className="min-h-11 shrink-0 rounded-xl bg-accent px-4 font-bold text-accent-fg text-sm disabled:opacity-50"
		>
			塗り終わり
		</button>
	);
}

export function PaintPanel(props: {
	readonly editable: boolean;
	readonly submitted: boolean;
	readonly locked: boolean;
	readonly strokeCount: number;
	readonly color: string;
	readonly brush: BrushName;
	readonly eyedropper: boolean;
	readonly onBrush: (brush: BrushName) => void;
	readonly onEyedropper: () => void;
	/** 全身を塗る（いま選んでいる色で、体の表面の全体を 1 回で / paint.ts の fillBody）。 */
	readonly onFill: () => void;
	readonly onUndo: () => void;
	readonly onClear: () => void;
	readonly onConfirm: () => void;
	/**
	 * 「塗り終わり」を、板の外（シートの見出し）に出すか。出すなら、板の中には出さない
	 * （板の中がスクロールしても、いつも押せるように）。
	 */
	readonly confirmOutside?: boolean;
	/**
	 * ポーズ（issue-56）。素材の体があるときだけ渡す（仮のカプセルでは、ボタンを出さない）。label は
	 * いまのポーズの表示名、chosen はボタンを押したか（押していれば、塗っていなくても確定できる）。
	 */
	readonly pose?: {
		readonly label: string;
		readonly chosen: boolean;
		readonly onNext: () => void;
	};
}) {
	const { editable, submitted, locked, strokeCount, color } = props;
	const status = submitted
		? "ペイントを確定しました"
		: locked
			? "あと2秒で確定（もう塗れません）"
			: props.eyedropper
				? "床・壁・体をタップして色を拾う"
				: "体をなぞって塗る（視点パッドで回れる）";
	return (
		<section
			className="flex flex-col gap-1.5"
			data-testid="veryare-paint"
			data-strokes={strokeCount}
			data-submitted={submitted}
		>
			<p className="truncate font-semibold text-fg text-xs">{status}</p>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					disabled={!editable}
					aria-pressed={props.eyedropper}
					onClick={props.onEyedropper}
					data-testid="veryare-eyedropper"
					className={BUTTON}
				>
					スポイト
				</button>
				<span
					role="img"
					aria-label={`選んでいる色 ${color}`}
					data-testid="veryare-paint-color"
					data-color={color}
					className="size-6 shrink-0 rounded-full ring-1 ring-line ring-inset"
					style={{ backgroundColor: color }}
				/>
				<fieldset className="flex gap-1">
					<legend className="sr-only">ブラシの大きさ</legend>
					{(Object.keys(BRUSH_LABELS) as BrushName[]).map((name) => (
						<button
							key={name}
							type="button"
							disabled={!editable}
							aria-label={`ブラシ ${BRUSH_LABELS[name]}`}
							aria-pressed={props.brush === name}
							onClick={() => props.onBrush(name)}
							className={`${SMALL_BUTTON} min-w-9`}
						>
							{BRUSH_LABELS[name]}
						</button>
					))}
				</fieldset>
			</div>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					disabled={!editable}
					onClick={props.onFill}
					data-testid="veryare-paint-fill"
					className={SMALL_BUTTON}
				>
					全身を塗る
				</button>
				<button
					type="button"
					disabled={!editable || strokeCount === 0}
					onClick={props.onUndo}
					className={SMALL_BUTTON}
				>
					1つ戻す
				</button>
				<button
					type="button"
					disabled={!editable || strokeCount === 0}
					onClick={props.onClear}
					className={SMALL_BUTTON}
				>
					全部消す
				</button>
				{props.pose === undefined ? null : (
					<button
						type="button"
						disabled={!editable}
						onClick={props.pose.onNext}
						data-testid="veryare-pose"
						className={SMALL_BUTTON}
					>
						ポーズ（{props.pose.label}）
					</button>
				)}
				{props.confirmOutside === true ? null : (
					<PaintConfirmButton
						editable={editable}
						strokeCount={strokeCount}
						poseChosen={props.pose?.chosen ?? false}
						onConfirm={props.onConfirm}
					/>
				)}
			</div>
		</section>
	);
}
