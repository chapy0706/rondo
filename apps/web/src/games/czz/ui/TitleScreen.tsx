/**
 * czz の起動画面（本家のトップページ app/page.tsx の再現 / issue-21）。
 *
 * 初心者モードでは「指示厨ゲーム」のポップなタイトル、通常モードでは「Command Liner」と
 * 説明文を出す。スタート・初心者モードの切り替え・BGM/効果音のスイッチ・クレジット・
 * マニュアル（設定されていれば）を置く。設定はメモリ上だけで持つ（ADR 0019）。
 */

import type { UiMode } from "../presentation";
import { PopTitle } from "./PopTitle";
import { Switch } from "./Switch";
import { T } from "./theme";

export interface AudioSettings {
	readonly bgmEnabled: boolean;
	readonly sfxEnabled: boolean;
}

export function TitleScreen({
	mode,
	audio,
	manualUrl,
	onModeChange,
	onAudioChange,
	onStart,
	onCredits,
}: {
	mode: UiMode;
	audio: AudioSettings;
	manualUrl: string | null;
	onModeChange: (mode: UiMode) => void;
	onAudioChange: (audio: AudioSettings) => void;
	onStart: () => void;
	onCredits: () => void;
}) {
	const isBeginner = mode === "beginner";

	return (
		<div className="flex flex-col items-center gap-10 py-10 text-center">
			<div className="flex flex-col items-center gap-6">
				{isBeginner ? (
					<PopTitle />
				) : (
					<h1 className="mt-4 font-bold text-3xl tracking-wide">
						Command Liner
					</h1>
				)}
				{isBeginner ? null : (
					<p className={`mx-auto max-w-2xl text-sm leading-relaxed ${T.muted}`}>
						UNIX 的な「流れ」を、UI
						で組み立てて学ぶゲーム。コマンドを並べて実行し、テストで確かめる。
					</p>
				)}
			</div>

			<button
				type="button"
				onClick={onStart}
				className={`min-h-12 min-w-40 px-8 font-semibold text-base ${T.radius} ${T.border} ${T.accent} active:opacity-80`}
			>
				スタート
			</button>

			<div className="flex items-center gap-2 text-left">
				<Switch
					checked={isBeginner}
					onChange={(next) => onModeChange(next ? "beginner" : "advanced")}
					label="初心者モード切り替え"
				/>
				<div className="leading-tight">
					<div className="font-medium text-sm">初心者モード</div>
					<div className={`text-xs ${T.muted}`}>
						最初はここで流れを理解しよう
					</div>
				</div>
			</div>

			<section
				aria-label="初心者モード 操作パネル"
				className={`w-full max-w-64 p-1.5 shadow-lg ${T.radius} ${T.border} bg-[var(--czz-card)]/80`}
			>
				<div className="flex flex-col gap-1">
					<AudioRow
						label="BGM"
						enabled={audio.bgmEnabled}
						onChange={(bgmEnabled) => onAudioChange({ ...audio, bgmEnabled })}
					/>
					<AudioRow
						label="SFX"
						enabled={audio.sfxEnabled}
						onChange={(sfxEnabled) => onAudioChange({ ...audio, sfxEnabled })}
					/>
					<button
						type="button"
						onClick={onCredits}
						className={`min-h-11 px-2 font-semibold text-xs ${T.radius} ${T.border} active:bg-[var(--czz-muted)]`}
					>
						クレジット
					</button>
				</div>
				{isBeginner ? null : (
					<p className={`mt-1 text-xs ${T.muted}`}>
						音は初心者モードで鳴ります
					</p>
				)}
			</section>

			{manualUrl !== null ? (
				<a
					href={manualUrl}
					target="_blank"
					rel="noopener noreferrer"
					aria-label="マニュアルを開く"
					className="inline-flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg active:bg-emerald-400"
				>
					<LeafIcon />
				</a>
			) : null}
		</div>
	);
}

function AudioRow({
	label,
	enabled,
	onChange,
}: {
	label: string;
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<div
			className={`flex items-center justify-between border px-2 ${T.radius} ${
				enabled
					? "border-sky-300/70 bg-sky-50 text-sky-950"
					: "border-[var(--czz-border)] bg-[var(--czz-bg)]/60"
			}`}
		>
			<span className="font-semibold text-xs">{label}</span>
			<Switch
				checked={enabled}
				onChange={onChange}
				label={enabled ? `${label}をオフにする` : `${label}をオンにする`}
			/>
		</div>
	);
}

/** 本家の lucide Leaf アイコンの代わり（依存を増やさない）。 */
function LeafIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className="size-6"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
			<path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
		</svg>
	);
}
