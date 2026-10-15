"use client";

/**
 * ゲームのロゴ（issue-69）。登録（manifest.ts）の logo から描く。
 *
 * いつも仮のタイル（ゲームの背景の色と、表示名の頭文字）を下に敷き、ロゴの画像があれば、
 * その上に <img loading="lazy" width height alt> で重ねる。画像が読めなければ隠すので、壊れた
 * 画像は出ず、タイルが見える。大きさを指定するので、読み込みで画面がずれない。
 */

import type { GameManifest } from "@rondo/contracts";
import { useState } from "react";
import { logoView } from "./gameBrand";

export function GameLogo({
	manifest,
	size,
	className = "",
}: {
	manifest: GameManifest;
	/** 一辺の大きさ（px）。 */
	size: number;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const { tile, image } = logoView(manifest, failed);
	return (
		<span
			data-testid="game-logo"
			data-game={manifest.id}
			data-logo={image === null ? "tile" : "image"}
			className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] ${className}`}
			style={{
				width: size,
				height: size,
				backgroundColor: tile.background,
				color: tile.foreground,
			}}
		>
			<span
				aria-hidden="true"
				className="font-bold leading-none"
				style={{ fontSize: Math.round(size * 0.45) }}
			>
				{tile.initial}
			</span>
			{image !== null ? (
				<img
					src={image.src}
					alt={image.alt}
					width={size}
					height={size}
					loading="lazy"
					decoding="async"
					onError={() => setFailed(true)}
					className="absolute inset-0 size-full object-cover"
				/>
			) : null}
		</span>
	);
}
