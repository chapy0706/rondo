/**
 * 初心者モードのタイトル「指示厨ゲーム」（本家 BeginnerPopTitle の6文字の形）。
 * 1文字ずつ色違いの丸に入り、時間差で弾みながら落ちてくる。縦画面では3列×2段に並ぶ。
 */

import type { CSSProperties } from "react";
import styles from "./PopTitle.module.css";

type Vars = CSSProperties & {
	"--czz-delay"?: string;
	"--czz-rot"?: string;
	"--czz-tx"?: string;
	"--czz-ty"?: string;
};

const TEXT = "指示厨ゲーム";
const STAGGER_MS = 70;

/** 本家の VARIANTS（大きさ・色・傾き・ずれ）。 */
const VARIANTS: readonly { className: string; vars: Vars }[] = [
	{
		className:
			"h-14 w-14 text-3xl ring-2 ring-pink-300 bg-pink-200 text-slate-800",
		vars: { "--czz-rot": "2deg", "--czz-ty": "-2px" },
	},
	{
		className:
			"h-12 w-12 text-2xl ring-1 ring-sky-300 bg-sky-200 text-slate-800",
		vars: { "--czz-rot": "-2deg", "--czz-ty": "2px" },
	},
	{
		className:
			"h-16 w-16 text-3xl ring-4 ring-emerald-300 bg-emerald-200 text-slate-800",
		vars: { "--czz-rot": "1deg", "--czz-tx": "2px" },
	},
	{
		className:
			"h-11 w-11 text-2xl ring-2 ring-amber-300 bg-amber-200 text-slate-800",
		vars: { "--czz-rot": "-1deg", "--czz-tx": "-2px" },
	},
	{
		className:
			"h-14 w-14 text-3xl ring-2 ring-teal-300 bg-teal-200 text-slate-800",
		vars: { "--czz-rot": "3deg", "--czz-ty": "4px" },
	},
	{
		className:
			"h-14 w-14 text-2xl ring-1 ring-violet-300 bg-violet-200 text-slate-800",
		vars: { "--czz-rot": "-3deg", "--czz-ty": "-4px" },
	},
];

export function PopTitle() {
	return (
		<h1 aria-label={TEXT} className="select-none font-extrabold tracking-wide">
			<span className="grid grid-cols-3 grid-rows-2 place-items-center gap-1.5">
				{Array.from(TEXT).map((ch, index) => {
					const variant = VARIANTS[index];
					const style: Vars = {
						"--czz-delay": `${index * STAGGER_MS}ms`,
						"--czz-rot": variant?.vars["--czz-rot"] ?? "0deg",
						"--czz-tx": variant?.vars["--czz-tx"] ?? "0px",
						"--czz-ty": variant?.vars["--czz-ty"] ?? "0px",
					};
					return (
						<span
							// 6文字固定の演出で、順序は変わらない。
							// biome-ignore lint/suspicious/noArrayIndexKey: 固定の並び
							key={index}
							aria-hidden="true"
							className={`${styles.dropBounce} inline-grid place-items-center rounded-full leading-none ${variant?.className ?? ""}`}
							style={style}
						>
							{ch}
						</span>
					);
				})}
			</span>
		</h1>
	);
}
