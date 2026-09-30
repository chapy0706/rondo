/**
 * クレジット（本家 app/credits/page.tsx から、rondo に持ち込んだ素材の提供元だけ）。
 * 各提供元の利用規約・ライセンスに従って使用している素材を明示する。
 */

import { CREDITS } from "../presentation";
import { T } from "./theme";

export function Credits({ onBack }: { onBack: () => void }) {
	return (
		<div className="flex flex-col gap-4 py-6">
			<header className="flex items-center justify-between gap-3">
				<h1 className="font-semibold text-xl">クレジット</h1>
				<button
					type="button"
					onClick={onBack}
					className={`min-h-11 px-4 font-medium text-xs ${T.radius} ${T.border} active:bg-[var(--czz-muted)]`}
				>
					戻る
				</button>
			</header>
			<p className={`text-sm ${T.muted}`}>
				本ゲームで使用している素材・音源の提供元一覧です。各提供元の利用規約・ライセンスに従って使用しています。
			</p>
			<ul className="flex flex-col gap-3">
				{CREDITS.map((credit) => (
					<li
						key={credit.url}
						className={`flex flex-col gap-1 p-4 ${T.radius} ${T.border} bg-[var(--czz-card)]/60`}
					>
						<span className="font-semibold text-sm">{credit.label}</span>
						<span className="text-sm">{credit.name}</span>
						<a
							href={credit.url}
							target="_blank"
							rel="noreferrer"
							className={`break-all text-xs underline ${T.muted}`}
						>
							{credit.url}
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}
