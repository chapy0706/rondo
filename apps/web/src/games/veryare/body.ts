/**
 * 体の描画（three.js）。ペイントの描き込み面と、体のシェーダー、体を作る口（issue-25 / issue-56）。
 *
 * - 描き込み面（PaintSurface）: 1枚のキャンバスに、塗っていない色で塗りつぶしてから、ストロークの
 *   楕円（paint.ts の strokeDabs）を描く。three のテクスチャとして体に渡す
 * - 体のシェーダー（paintedMaterial）: 頂点の基準姿勢の位置（スキンで動かす前の position）を、体の
 *   座標（足もとが原点 / bodySize.ts）へ写し、円柱を回る角度 u と高さ v を求めて、描き込み面を参照する
 *   （paint.ts の uvOf と同じ式。モデルの UV は使わない / ADR 0037）。ポーズをとっても、塗りは体に
 *   ついて行く。光の当たり方は MeshStandardMaterial のまま
 * - 体を作る口（BodyKit）: 仮のカプセル（placeholderBodyKit）と、素材の体（createModelBodyKit。X Bot と
 *   ポーズの表）。どちらも、足もとが原点、高さ BODY_HEIGHT の体（BodyInstance）を作る。素材の体は、
 *   待機ルームにいる間に、素材の入口（assetSlots.ts）の差し替え口から受け取って差し替える
 * - タップの描き込み面の座標（BodyInstance.pickUv）: 素材の体は、ポーズをとった体に当て、当たった
 *   三角形の3頂点の基準姿勢の位置を、重心座標で混ぜた点から求める（bodyPose.ts）。どのポーズでも、
 *   体の同じ部分は同じ (u, v)。仮のカプセルは、体の円柱との交差（paint.ts の intersectCylinder）
 */

import type { VeryareModelPose, VeryarePaint } from "@rondo/contracts";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
	type PoseTable,
	bindPointOfFace,
	followOffset,
	normalizeMatrix,
	parsePoseTable,
	poseOffset,
	uvOfBindPoint,
} from "./bodyPose";
import { PLACEHOLDER_CAPSULE } from "./bodySize";
import {
	BODY_CYLINDER,
	PAINT_TEXTURE,
	type Vec3,
	intersectCylinder,
	strokeDabs,
} from "./paint";
import { DEFAULT_POSE } from "./poses";

/** 体1つ。object の原点が足もと（体の座標）で、y 軸まわりに回して向きを変える。 */
export interface BodyInstance {
	readonly object: THREE.Object3D;
	/** 体の材質（点滅・半透明に使う）。 */
	readonly materials: readonly THREE.MeshStandardMaterial[];
	/** ポーズを変える（仮のカプセルでは何もしない）。補正は update で寄せる。 */
	setPose(pose: VeryareModelPose): void;
	/** ポーズの補正（足もと・水平の中心）を、dt 秒ぶん寄せる。 */
	update(dtSeconds: number): void;
	/** ポーズの補正を、寄せずに合わせる（作った直後・見え始めたとき）。 */
	snap(): void;
	/** いまの補正（体の座標）。 */
	offset(): Vec3;
	/** タップの光線が体に当たれば、描き込み面の (u, v)。当たらなければ null。 */
	pickUv(raycaster: THREE.Raycaster): { u: number; v: number } | null;
	dispose(): void;
}

/** 体を作る口。paint があれば描き込み面を貼った体、無ければ tint の色の体（鬼）。 */
export interface BodyKit {
	/** ポーズを変えられるか（素材の体だけ。ポーズボタンを出すかに使う）。 */
	readonly posable: boolean;
	create(paint: THREE.Texture | null, tint: number): BodyInstance;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** 仮の体（カプセル。足もとから BODY_HEIGHT まで）。 */
export const placeholderBodyKit: BodyKit = {
	posable: false,
	create(paint, tint) {
		const { radius, length, centerY } = PLACEHOLDER_CAPSULE;
		const frame = new THREE.Matrix4().makeTranslation(0, centerY, 0);
		const material =
			paint === null
				? new THREE.MeshStandardMaterial({ color: tint })
				: paintedMaterial(paint, frame);
		const mesh = new THREE.Mesh(
			new THREE.CapsuleGeometry(radius, length, 4, 12),
			material,
		);
		mesh.position.y = centerY;
		const object = new THREE.Group();
		object.add(mesh);
		return {
			object,
			materials: [material],
			setPose: () => undefined,
			update: () => undefined,
			snap: () => undefined,
			offset: () => ZERO,
			pickUv(raycaster) {
				object.updateMatrixWorld(true);
				const inverse = object.matrixWorld.clone().invert();
				const origin = raycaster.ray.origin.clone().applyMatrix4(inverse);
				const direction = raycaster.ray.direction
					.clone()
					.transformDirection(inverse);
				const hit = intersectCylinder({ origin, direction });
				return hit === null ? null : { u: hit.u, v: hit.v };
			},
			dispose() {
				mesh.geometry.dispose();
				material.dispose();
			},
		};
	},
};

/** 自分か祖先の、元の名前（GLTFLoader は ":" などを除いた名前にし、元の名前を userData に残す）。 */
function originalName(node: THREE.Object3D): string {
	const name: unknown = node.userData.name;
	return typeof name === "string" ? name : node.name;
}

/**
 * 素材の体（X Bot の scene と、ポーズの表の scene）。表が壊れている、スキンつきのメッシュが無い、
 * 表の骨が体に無いときは null（呼び出し側は仮のカプセルのまま）。
 */
export function createModelBodyKit(
	body: THREE.Object3D,
	poses: THREE.Object3D,
): BodyKit | null {
	const table = parsePoseTable(poses.userData);
	if (table === null) return null;
	let skinned = 0;
	const boneNames = new Set<string>();
	body.traverse((node) => {
		if (node instanceof THREE.SkinnedMesh) skinned += 1;
		if (node instanceof THREE.Bone) boneNames.add(originalName(node));
	});
	if (skinned === 0 || !table.joints.every((name) => boneNames.has(name))) {
		return null;
	}
	const normalize = new THREE.Matrix4().fromArray(normalizeMatrix(table));
	return {
		posable: true,
		create: (paint, tint) => modelInstance(body, table, normalize, paint, tint),
	};
}

function modelInstance(
	source: THREE.Object3D,
	table: PoseTable,
	normalize: THREE.Matrix4,
	paint: THREE.Texture | null,
	tint: number,
): BodyInstance {
	// 骨ごと複製する（形のデータは元と共有するので、捨てるときに形は捨てない）。
	const model = cloneSkinned(source);
	// ポーズを当てる前（基準姿勢）の骨の位置で、頂点の基準姿勢の位置を求める行列を作る。
	model.updateMatrixWorld(true);
	const scaled = new THREE.Group();
	scaled.matrixAutoUpdate = false;
	scaled.matrix.copy(normalize);
	scaled.add(model);
	const shift = new THREE.Group();
	shift.add(scaled);
	const object = new THREE.Group();
	object.add(shift);

	const meshes: THREE.SkinnedMesh[] = [];
	const frames = new Map<THREE.SkinnedMesh, THREE.Matrix4>();
	const materials: THREE.MeshStandardMaterial[] = [];
	model.traverse((node) => {
		if (!(node instanceof THREE.SkinnedMesh)) return;
		// メッシュの頂点 → 素材の scene の座標（基準姿勢の骨 × 逆バインド行列 × bindMatrix）→ 体の座標
		// （normalize）。量子化（圧縮）の戻しは逆バインド行列に入っているので、bindMatrix だけでは足りない。
		const bone = node.skeleton.bones[0];
		const inverse = node.skeleton.boneInverses[0];
		const shape =
			bone === undefined || inverse === undefined
				? new THREE.Matrix4()
				: new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, inverse);
		const frame = normalize.clone().multiply(shape).multiply(node.bindMatrix);
		const material =
			paint === null
				? new THREE.MeshStandardMaterial({ color: tint })
				: paintedMaterial(paint, frame);
		node.material = material;
		// ポーズで形が基準姿勢の外接球からはみ出すので、視野の外の判定で消さない（体は最大 5 つ）。
		node.frustumCulled = false;
		meshes.push(node);
		frames.set(node, frame);
		materials.push(material);
	});
	const bonesByName = new Map<string, THREE.Object3D>();
	model.traverse((node) => {
		if (node instanceof THREE.Bone) bonesByName.set(originalName(node), node);
	});
	const bones = table.joints.map((name) => bonesByName.get(name) ?? null);

	let pose: VeryareModelPose = DEFAULT_POSE;
	let target = poseOffset(table, pose);
	let current = target;
	const place = () => shift.position.set(current.x, current.y, current.z);
	const applyPose = () => {
		const entry = table.poses[pose] ?? table.poses.idle;
		if (entry === undefined) return;
		bones.forEach((bone, i) => {
			if (bone === null) return;
			const t = entry.t[i];
			const r = entry.r[i];
			const s = entry.s?.[i];
			if (t !== undefined) bone.position.set(t[0], t[1], t[2]);
			if (r !== undefined) bone.quaternion.set(r[0], r[1], r[2], r[3]);
			if (s !== undefined) bone.scale.set(s[0], s[1], s[2]);
			else bone.scale.set(1, 1, 1);
		});
		// 当たりの判定（タップ・照準）の外接球を、ポーズに合わせて作り直す（ポーズを変えたときだけ）。
		object.updateMatrixWorld(true);
		for (const mesh of meshes) mesh.computeBoundingSphere();
	};
	applyPose();
	place();

	return {
		object,
		materials,
		setPose(next) {
			if (next === pose) return;
			pose = next;
			applyPose();
			target = poseOffset(table, pose);
		},
		update(dt) {
			current = followOffset(current, target, dt);
			place();
		},
		snap() {
			current = target;
			place();
		},
		offset: () => current,
		pickUv(raycaster) {
			object.updateMatrixWorld(true);
			const [hit] = raycaster.intersectObjects(meshes, false);
			if (hit === undefined || hit.face == null || hit.barycoord == null) {
				return null;
			}
			const mesh = hit.object as THREE.SkinnedMesh;
			const frame = frames.get(mesh);
			if (frame === undefined) return null;
			const position = mesh.geometry.getAttribute("position");
			const { a, b, c } = hit.face;
			// 3頂点の基準姿勢の位置（量子化された値は getX などで戻す）。
			const corners = [a, b, c].flatMap((index) => [
				position.getX(index),
				position.getY(index),
				position.getZ(index),
			]);
			const bind = bindPointOfFace(
				corners,
				{ a: 0, b: 1, c: 2 },
				{ x: hit.barycoord.x, y: hit.barycoord.y, z: hit.barycoord.z },
			);
			return uvOfBindPoint(frame.elements, bind);
		},
		dispose() {
			for (const material of materials) material.dispose();
		},
	};
}

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

/**
 * 描き込み面を、円柱の u・v で体に貼るシェーダー（光の当たり方は標準のまま）。frame は、メッシュの
 * 基準姿勢の位置 → 体の座標（足もとが原点）の行列。
 */
export function paintedMaterial(
	texture: THREE.Texture,
	frame: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.MeshStandardMaterial {
	const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
	material.onBeforeCompile = (shader) => {
		shader.uniforms.paintMap = { value: texture };
		shader.uniforms.paintFrame = { value: frame };
		shader.uniforms.paintRange = {
			value: new THREE.Vector2(BODY_CYLINDER.yMin, BODY_CYLINDER.yMax),
		};
		shader.vertexShader = shader.vertexShader
			.replace(
				"#include <common>",
				"#include <common>\nvarying vec3 vBodyPosition;\nuniform mat4 paintFrame;",
			)
			.replace(
				// スキンで動かす前の position（基準姿勢）を、体の座標へ写す。
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvBodyPosition = (paintFrame * vec4(position, 1.0)).xyz;",
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
