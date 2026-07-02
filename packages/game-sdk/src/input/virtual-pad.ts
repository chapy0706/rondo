import { type Direction, type InputPort, NEUTRAL } from "./port";

/** 値を [-1, 1] に丸める。 */
function clampUnit(value: number): number {
	if (value > 1) return 1;
	if (value < -1) return -1;
	return value;
}

/**
 * 仮想パッドの入力源。
 *
 * ポインタの中心からのずれを方向入力に変換する（ADR 0018）。DOM を知らない純粋な
 * ロジックとして持ち、React 層から座標を流し込む。全端末で確実に動き、iOS の許可
 * ダイアログや HTTPS 要件・機種差にハマらないことが Phase 1 で先行する理由である。
 */
export class VirtualPadSource implements InputPort {
	#direction: Direction = NEUTRAL;
	readonly #listeners = new Set<(direction: Direction) => void>();

	read(): Direction {
		return this.#direction;
	}

	subscribe(listener: (direction: Direction) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/**
	 * 中心からのずれ (offsetX, offsetY) を半径 radius で正規化して方向を更新する。
	 * radius が 0 以下なら中立に戻す。
	 */
	move(offsetX: number, offsetY: number, radius: number): void {
		if (radius <= 0) {
			this.#update(NEUTRAL);
			return;
		}
		this.#update({
			x: clampUnit(offsetX / radius),
			y: clampUnit(offsetY / radius),
		});
	}

	/** 入力を中立に戻す（指を離したとき）。 */
	release(): void {
		this.#update(NEUTRAL);
	}

	#update(next: Direction): void {
		if (next.x === this.#direction.x && next.y === this.#direction.y) return;
		this.#direction = next;
		for (const listener of this.#listeners) {
			listener(next);
		}
	}
}
