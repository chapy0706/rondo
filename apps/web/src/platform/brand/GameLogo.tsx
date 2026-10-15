"use client";

/**
 * ゲームのロゴ（issue-69）。登録（manifest.ts）の logo から描く。
 *
 * いつも仮のタイル（ゲームの背景の色と、表示名の頭文字）を下に敷き、ロゴの画像があれば、
 * その上に <img loading="lazy" width height alt> で重ねる。画像が読めなければ隠すので、壊れた
 * 画像は出ず、タイルが見える。大きさを指定するので、読み込みで画面がずれない。
 * サーバーで描いた画像が、画面を引き継ぐ前に読み込みに失敗すると onError が呼ばれないので、
 * 引き継いだ時点で、読み終わっていて大きさが 0 なら、失敗として扱う（imageBroken）。
 */

import type { GameManifest } from "@rondo/contracts";
import { useEffect, useRef, useState } from "react";
import { imageBroken, logoView } from "./gameBrand";

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
	const imageRef = useRef<HTMLImageElement | null>(null);
	const { tile, image } = logoView(manifest, failed);
	useEffect(() => {
		const img = imageRef.current;
		if (img !== null && imageBroken(img)) setFailed(true);
	}, []);
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
					ref={imageRef}
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
