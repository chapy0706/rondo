/**
 * 設定（画面の隅）の「音」と「クレジット」（issue-63）。BGM の音量、効果音の音量、全部のミュート。
 * 選んだ値は、その端末に覚える（settings.ts）。旗（SOUND_READY・?sound=1）が無い間は、何も描かない
 * （来場者の画面には、何も起きない）。音量を動かしたときに、試しに鳴らす音は付けない
 * （素材を鳴らして試せる画面にしないため）。
 */

import { useSoundSnapshot } from "./hooks";
import { soundHub } from "./hub";

const ROW =
	"flex min-h-9 items-center gap-2 rounded-lg bg-ink/80 px-2 text-fg text-xs ring-1 ring-line ring-inset";

/** 表記（任意）。BGM と効果音の入手先。 */
export const SOUND_CREDITS = [
	{ label: "BGM", name: "こんとどぅふぇ", url: "https://conte-de-fees.com/" },
	{
		label: "効果音",
		name: "効果音ラボ",
		url: "https://soundeffect-lab.info/",
	},
] as const;

export function SoundSettings() {
	const { enabled, settings } = useSoundSnapshot();
	if (!enabled) return null;
	return (
		<>
			<button
				type="button"
				aria-pressed={settings.muted}
				onClick={() =>
					soundHub.updateSettings({ ...settings, muted: !settings.muted })
				}
				className="min-h-9 rounded-lg bg-ink/80 px-2 text-fg text-xs ring-1 ring-line ring-inset"
				data-testid="sound-mute"
			>
				音: {settings.muted ? "ミュート" : "あり"}
			</button>
			<label className={ROW}>
				BGM
				<input
					type="range"
					min={0}
					max={1}
					step={0.1}
					value={settings.bgm}
					onChange={(event) =>
						soundHub.updateSettings({
							...settings,
							bgm: Number(event.currentTarget.value),
						})
					}
					className="w-24"
					data-testid="sound-bgm"
				/>
			</label>
			<label className={ROW}>
				効果音
				<input
					type="range"
					min={0}
					max={1}
					step={0.1}
					value={settings.se}
					onChange={(event) =>
						soundHub.updateSettings({
							...settings,
							se: Number(event.currentTarget.value),
						})
					}
					className="w-24"
					data-testid="sound-se"
				/>
			</label>
			<div
				className="flex flex-col gap-0.5 rounded-lg bg-ink/80 px-2 py-1 text-fg-muted text-xs ring-1 ring-line ring-inset"
				data-testid="sound-credits"
			>
				<span className="font-semibold text-fg">クレジット</span>
				{SOUND_CREDITS.map((credit) => (
					<span key={credit.label}>
						{credit.label}: {credit.name}{" "}
						<a
							href={credit.url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline"
						>
							{credit.url}
						</a>
					</span>
				))}
			</div>
		</>
	);
}
