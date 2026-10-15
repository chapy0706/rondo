import type { GameManifest } from "@rondo/contracts";
import { GameLogo } from "../brand/GameLogo";
import { RondoMark } from "../brand/Logo";
import { displayName } from "../brand/gameBrand";

/**
 * 基盤共通の起動画面（issue-30 / ADR 0029）。
 *
 * ロゴ・タイトル・タグライン・遊び方・「はじめる」だけを出す。押しても展開は変わらない
 * 演出なので、押したら onStart を呼ぶだけにする。タイトル画像は、ゲームのロゴ（issue-69。無ければ
 * 仮のタイル）を下に敷き、その上に重ねるので、画像の実体が無くても崩れない。
 */
export function LaunchScreen({
	manifest,
	onStart,
}: {
	manifest: GameManifest;
	onStart: () => void;
}) {
	const { tagline, howToPlay, titleScreenImage } = manifest;
	const title = displayName(manifest);

	return (
		<section className="flex w-full flex-col items-center gap-6 text-center motion-safe:animate-rise">
			<RondoMark className="size-6" />

			<div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-surface ring-1 ring-line ring-inset">
				{/* ゲームのロゴ（issue-69）。画像が無い・読めないときは、仮のタイル。 */}
				<span className="absolute inset-0 flex items-center justify-center">
					<GameLogo manifest={manifest} size={128} />
				</span>
				{titleScreenImage !== undefined ? (
					<span
						aria-hidden="true"
						className="absolute inset-0 bg-center bg-cover"
						style={{ backgroundImage: `url(${titleScreenImage})` }}
					/>
				) : null}
			</div>

			<div className="flex flex-col gap-2">
				<h1 className="font-bold text-3xl text-fg">{title}</h1>
				{tagline !== undefined ? (
					<p className="text-balance text-fg-muted">{tagline}</p>
				) : null}
			</div>

			{howToPlay !== undefined && howToPlay.length > 0 ? (
				<ul className="flex w-full flex-col gap-2 rounded-2xl bg-surface p-4 text-left text-fg text-sm">
					{howToPlay.map((line) => (
						<li key={line} className="flex gap-2">
							<span aria-hidden="true" className="text-accent">
								・
							</span>
							{line}
						</li>
					))}
				</ul>
			) : null}

			<button
				type="button"
				onClick={onStart}
				className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-accent px-8 font-semibold text-accent-fg text-lg transition-transform active:scale-[0.98]"
			>
				はじめる
			</button>
		</section>
	);
}
