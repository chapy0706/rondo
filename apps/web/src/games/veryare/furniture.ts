/**
 * 家具の箱の一覧（カメラの守り / cameraGuard.ts）。素材の配信の家具の glb（hiraya-furniture。メッシュは
 * 持たず、scene の extras に一覧だけを入れたもの。tools/furniture_boxes.mjs で作る）を読み、
 * three の GLTFLoader が scene の userData に写したものを、境で検証して使う。
 */

import { z } from "zod";
import type { FurnitureBox } from "./cameraGuard";

/** scene の extras（userData）の中の名前。 */
export const FURNITURE_EXTRAS_KEY = "rondoFurniture";

const corner = z.tuple([
	z.number().finite(),
	z.number().finite(),
	z.number().finite(),
]);

const schema = z.object({
	[FURNITURE_EXTRAS_KEY]: z.object({
		version: z.literal(1),
		boxes: z.array(
			z
				.object({ name: z.string().min(1), min: corner, max: corner })
				.refine(
					(box) => box.min.every((v, i) => v <= (box.max[i] as number)),
					"最小の角が最大の角を超えない",
				),
		),
	}),
});

/** userData を検証して、家具の箱の一覧にする。形が違えば null。 */
export function parseFurniture(userData: unknown): FurnitureBox[] | null {
	const result = schema.safeParse(userData);
	if (!result.success) return null;
	return result.data[FURNITURE_EXTRAS_KEY].boxes.map((box) => ({
		name: box.name,
		min: { x: box.min[0], y: box.min[1], z: box.min[2] },
		max: { x: box.max[0], y: box.max[1], z: box.max[2] },
	}));
}
