/**
 * 体の描画（three.js）。ペイントの描き込み面と、体のシェーダー、体を作る口（issue-25）。
 *
 * - 描き込み面（PaintSurface）: 1枚のキャンバスに、塗っていない色で塗りつぶしてから、ストロークの
 *   楕円（paint.ts の strokeDabs）を描く。three のテクスチャとして体に渡す
 * - 体のシェーダー（paintedMaterial）: 頂点の体のローカル座標から、円柱を回る角度 u と高さ v を
 *   求め、描き込み面を参照する（paint.ts の uvOf と同じ式。モデルの UV は使わない / ADR 0037）。
 *   光の当たり方は MeshStandardMaterial のまま（床と同じ光で照らす）
 * - 体を作る口（BodyKit）: いまは仮のカプセル（placeholderBodyKit）。素材の X Bot が届いたら、
 *   同じ形の BodyKit を SwapSlot（infrastructure/assets の slot.ts）から受け取って差し替える。
 *   差し替える体も、体のローカル座標で、足もとが y = -0.5、頭が y = 0.5 に収まるように置くこと
 *   （描き込み面の v と合わせるため）
 */

import type { VeryarePaint } from "@rondo/contracts";
import * as THREE from "three";
import { BODY_CYLINDER, PAINT_TEXTURE, strokeDabs } from "./paint";

/** 体を作る口。material は描き込み面を貼った体のシェーダー。 */
export interface BodyKit {
	create(material: THREE.Material): THREE.Mesh;
}

/** 仮の体（カプセル。半径 0.2 m、高さ 1 m）。 */
export const placeholderBodyKit: BodyKit = {
	create: (material) =>
		new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 4, 12), material),
};

/** 描き込み面。draw で、塗っていない色とペイントから描き直す。 */
export interface PaintSurface {
	readonly texture: THREE.Texture;
	draw(base: string, paint: VeryarePaint | null): void;
	dispose(): void;
}

export function createPaintSurface(): PaintSurface {
	const canvas = document.createElement("canvas");
	canvas.width = PAINT_TEXTURE.width;
	canvas.height = PAINT_TEXTURE.height;
	const context = canvas.getContext("2d");
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	let drawn: { base: string; paint: VeryarePaint | null } | null = null;
	return {
		texture,
		draw(base, paint) {
			if (drawn !== null && drawn.base === base && drawn.paint === paint)
				return;
			drawn = { base, paint };
			if (context === null) return;
			const fill = paint?.kind === "uniform" ? paint.color : base;
			context.fillStyle = fill;
			context.fillRect(0, 0, canvas.width, canvas.height);
			if (paint?.kind === "strokes") {
				for (const dab of strokeDabs(
					paint.strokes,
					canvas.width,
					canvas.height,
				)) {
					context.fillStyle = dab.color;
					context.beginPath();
					context.ellipse(dab.x, dab.y, dab.rx, dab.ry, 0, 0, Math.PI * 2);
					context.fill();
				}
			}
			texture.needsUpdate = true;
		},
		dispose() {
			texture.dispose();
		},
	};
}

/** 描き込み面を、円柱の u・v で体に貼るシェーダー（光の当たり方は標準のまま）。 */
export function paintedMaterial(
	texture: THREE.Texture,
): THREE.MeshStandardMaterial {
	const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.paintMap = { value: texture };
		shader.uniforms.paintRange = {
			value: new THREE.Vector2(BODY_CYLINDER.yMin, BODY_CYLINDER.yMax),
		};
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nvarying vec3 vBodyPosition;",
			)
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvBodyPosition = position;",
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nvarying vec3 vBodyPosition;\nuniform sampler2D paintMap;\nuniform vec2 paintRange;",
			)
			.replace(
				"#include <map_fragment>",
				[
					"#include <map_fragment>",
					"float paintU = fract(atan(vBodyPosition.x, vBodyPosition.z) / 6.283185307179586);",
					"float paintV = clamp((vBodyPosition.y - paintRange.x) / (paintRange.y - paintRange.x), 0.0, 1.0);",
					"diffuseColor.rgb *= texture2D(paintMap, vec2(paintU, paintV)).rgb;",
				].join("\n"),
			);
	};
	return material;
}
