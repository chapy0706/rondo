"use client";

import type { GameManifest } from "@rondo/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameCard } from "./GameCard";
import { entriesOf } from "./entries";
import { nearestIndex, playerLabel } from "./selection";

/**
 * コンソール風の横スクロールシェルフ（ADR 0029）。
 *
 * 横にスワイプするとカードが中央に吸着し、中央に最も近いカードを選択中として
 * 拡大・強調する。選択中のカードを押すとゲームホスト（/play/<id>）へ遷移し、
 * それ以外のカードを押すと中央へ寄せて選択中にする（誤って起動しにくくする）。
 * マニフェストの一覧を受け取るだけで、特定のゲームを知らない（ADR 0003）。
 * リアルタイム対戦のゲームを選んでいるときは、「新しく遊ぶ」と「ルームに参加する」の
 * 入口も出す（issue-47。どのゲームが対象かは registry が決める）。
 */
export function Shelf({ manifests }: { manifests: readonly GameManifest[] }) {
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const cardRefs = useRef<(HTMLElement | null)[]>([]);
	const [selected, setSelected] = useState(0);

	const updateSelected = useCallback(() => {
		const scroller = scrollerRef.current;
		if (scroller === null) return;
		const box = scroller.getBoundingClientRect();
		const centers = cardRefs.current.map((card) => {
			if (card === null) return Number.POSITIVE_INFINITY;
			const rect = card.getBoundingClientRect();
			return rect.left + rect.width / 2;
		});
		setSelected(nearestIndex(centers, box.left + box.width / 2));
	}, []);

	// スクロール中は 1 フレームに 1 回だけ選択中を計算し直す
	useEffect(() => {
		const scroller = scrollerRef.current;
		if (scroller === null) return;
		let frame = 0;
		const onScroll = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(updateSelected);
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		return () => {
			cancelAnimationFrame(frame);
			scroller.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		};
	}, [updateSelected]);

	const centerCard = (index: number) => {
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		cardRefs.current[index]?.scrollIntoView({
			behavior: reduce ? "auto" : "smooth",
			inline: "center",
			block: "nearest",
		});
	};

	const current = manifests[selected];
	const entries = current === undefined ? [] : entriesOf(current);

	return (
		<div className="flex flex-col items-center gap-6">
			<div
				ref={scrollerRef}
				className="flex w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto overscroll-x-contain px-[calc(50%-5rem)] py-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				{manifests.map((manifest, index) => (
					<div
						key={manifest.id}
						ref={(el) => {
							cardRefs.current[index] = el;
						}}
						className="shrink-0 snap-center"
					>
						<GameCard
							manifest={manifest}
							selected={index === selected}
							onFocus={() => centerCard(index)}
							onClick={(event) => {
								if (index === selected) return; // 選択中なら起動（Link の遷移に任せる）
								event.preventDefault();
								centerCard(index);
							}}
						/>
					</div>
				))}
			</div>

			<div
				aria-live="polite"
				className="flex min-h-14 flex-col items-center gap-1"
			>
				{current !== undefined ? (
					<>
						<p className="font-semibold text-fg text-xl">{current.title}</p>
						<p className="text-fg-muted text-sm">{playerLabel(current)}</p>
					</>
				) : null}
			</div>

			{entries.length > 0 && (
				<div className="flex w-full max-w-xs flex-col gap-2 px-6">
					{entries.map((entry, index) => (
						<Link
							key={entry.href}
							href={entry.href}
							className={`rounded-xl px-4 py-3 text-center font-semibold transition-transform active:scale-[0.98] ${
								index === 0
									? "bg-accent text-accent-fg"
									: "bg-surface text-fg ring-1 ring-line"
							}`}
						>
							{entry.label}
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
