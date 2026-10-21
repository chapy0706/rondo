/**
 * 観戦ルーム（issue-67）の旗。既定は下りている（本番に出さない）。旗が下りている間は、ロビーに観戦ルームの
 * 行が出ても押せない。開発・E2E のときだけ、ビルドの環境変数 NEXT_PUBLIC_RONDO_SPECTATE_DEV=1 で押せる
 * （サーバーの veryare.spectate_ready と RONDO_SPECTATE_DEV と同じ作り）。
 */

/** 観戦ルームを、来場者に出してよいか。 */
export const SPECTATE_READY = false;

/** 観戦ルームの行を押せるか。dev は NEXT_PUBLIC_RONDO_SPECTATE_DEV の値（前後の空白を除いて 1 のとき）。 */
export function spectateAllowed(
	ready: boolean = SPECTATE_READY,
	dev: string | undefined = process.env.NEXT_PUBLIC_RONDO_SPECTATE_DEV,
): boolean {
	return ready || dev?.trim() === "1";
}
