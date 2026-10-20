"use client";

/**
 * 画面いっぱいのゲーム画面の枠（すごくアレ。games/registry の isFullscreenGame）。
 *
 * スマホの縦画面で、スクロールなしで収める。上から、上部バー（約 44 px: 小さなロゴと名前、ルーム名、
 * 「⋯」メニュー）、ゲームの中身（残りの高さ、すべて）。メニューには、退出（確認つき）と、
 * ゲーム選択へ戻るを置く。横向きのタッチの端末では、上の端に細い案内の帯を出す（「×」で閉じられる。
 * 横向きで遊びたい人を止めない）。
 *
 * 高さ・セーフエリア・スクロールの止め方は globals.css の .game-frame。ほかのゲームは、これまでの
 * 縦に積む形のまま（PlayHost.tsx）。
 */

import type { GameManifest } from "@rondo/contracts";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { GameLogo } from "../brand/GameLogo";
import { displayName } from "../brand/gameBrand";
import { rotateHintVisible } from "./rotateHint";

/** メディアクエリが当てはまるか（画面の向き・入力の種類）。サーバーの描画では false。 */
function useMedia(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		() => window.matchMedia(query).matches,
		() => false,
	);
}

const MENU_ITEM =
	"min-h-11 rounded-lg px-3 text-left font-semibold text-fg text-sm hover:bg-ink";

export function GameFrame({
	manifest,
	roomName,
	onLeave,
	onBackToSelect,
	children,
}: {
	manifest: GameManifest;
	/** 参加中のルーム名（issue-58）。無ければ出さない。 */
	roomName: string | null;
	/** 退出する（ルームにいる間だけ。確認してから呼ぶ）。null なら、メニューに出さない。 */
	onLeave: (() => void) | null;
	onBackToSelect: () => void;
	children: ReactNode;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [hintDismissed, setHintDismissed] = useState(false);
	const landscape = useMedia("(orientation: landscape)");
	const coarse = useMedia("(pointer: coarse)");
	const closeMenu = () => {
		setMenuOpen(false);
		setConfirming(false);
	};

	return (
		<div
			className="game-frame flex flex-col bg-ink text-fg"
			data-testid="game-frame"
		>
			{rotateHintVisible({ landscape, coarse, dismissed: hintDismissed }) ? (
				<output
					data-testid="play-rotate-hint"
					className="flex shrink-0 items-center justify-between gap-2 bg-accent px-3 text-accent-fg text-xs"
				>
					<span className="truncate py-1 font-semibold">
						縦向きで遊んでください
					</span>
					<button
						type="button"
						aria-label="案内を閉じる"
						onClick={() => setHintDismissed(true)}
						className="flex size-8 shrink-0 items-center justify-center font-bold text-base"
					>
						×
					</button>
				</output>
			) : null}

			<header
				className="relative flex h-11 shrink-0 items-center gap-2 pl-3"
				data-testid="play-bar"
			>
				<GameLogo manifest={manifest} size={20} />
				<h1
					className="shrink-0 font-bold text-sm text-white"
					data-testid="play-title"
					data-game={manifest.id}
				>
					{displayName(manifest)}
				</h1>
				<p
					className="min-w-0 flex-1 truncate text-right text-fg-muted text-xs"
					data-testid="room-name"
				>
					{roomName === null ? null : (
						<>
							ルーム: <span className="text-fg">{roomName}</span>
						</>
					)}
				</p>
				<button
					type="button"
					aria-label="メニュー"
					aria-expanded={menuOpen}
					data-testid="play-menu"
					onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
					className="flex size-11 shrink-0 items-center justify-center font-bold text-fg text-lg"
				>
					⋯
				</button>
				{menuOpen ? (
					<>
						{/* メニューの外を押すと閉じる。 */}
						<button
							type="button"
							aria-label="メニューを閉じる"
							tabIndex={-1}
							onClick={closeMenu}
							className="fixed inset-0 z-20 cursor-default"
						/>
						<div
							role="menu"
							data-testid="play-menu-items"
							className="absolute top-11 right-2 z-30 flex w-60 flex-col gap-1 rounded-xl bg-surface p-2 shadow-lg ring-1 ring-line ring-inset"
						>
							{onLeave !== null && !confirming ? (
								<button
									type="button"
									role="menuitem"
									data-testid="play-leave"
									onClick={() => setConfirming(true)}
									className={MENU_ITEM}
								>
									退出する
								</button>
							) : null}
							{onLeave !== null && confirming ? (
								<div className="flex flex-col gap-2 p-1">
									<p className="text-fg text-sm">
										ルームから退出しますか？（ルームは解散します）
									</p>
									<div className="flex gap-2">
										<button
											type="button"
											data-testid="play-leave-confirm"
											onClick={() => {
												closeMenu();
												onLeave();
											}}
											className="min-h-11 flex-1 rounded-lg bg-accent px-3 font-semibold text-accent-fg text-sm"
										>
											退出する
										</button>
										<button
											type="button"
											onClick={() => setConfirming(false)}
											className="min-h-11 flex-1 rounded-lg bg-ink px-3 font-semibold text-fg text-sm ring-1 ring-line ring-inset"
										>
											やめる
										</button>
									</div>
								</div>
							) : null}
							<button
								type="button"
								role="menuitem"
								data-testid="play-back-to-select"
								onClick={() => {
									closeMenu();
									onBackToSelect();
								}}
								className={MENU_ITEM}
							>
								ゲーム選択へ戻る
							</button>
						</div>
					</>
				) : null}
			</header>

			<div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
		</div>
	);
}
