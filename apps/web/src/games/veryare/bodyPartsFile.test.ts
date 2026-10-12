/**
 * 5部位の割り当ての検査（issue-54）。手元に素材（assets-src/delivery の character-body と
 * character-poses）があるときだけ、Node で読んで確かめる。素材のファイルはリポジトリに入れないので、
 * 無ければ飛ばす（make verify は素材に頼らない）。
 */
import { existsSync, readFileSync } from "node:fs";
import { VERYARE_PAINT_PARTS } from "@rondo/contracts";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { createModelBodyKit } from "./body";

const asset = (name: string) =>
	new URL(
		`../../../../../assets-src/delivery/v2/characters/${name}`,
		import.meta.url,
	);
const bodyFile = asset("character-body-512.glb");
const posesFile = asset("character-poses-512.glb");
const present = existsSync(bodyFile) && existsSync(posesFile);

async function load(file: URL) {
	const data = readFileSync(file);
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	return loader.parseAsync(new Uint8Array(data).buffer, "");
}

describe.skipIf(!present)("5部位の割り当て（手元に素材があるときだけ）", () => {
	it("素材の体の頂点に、5部位がすべて割り当たる（どの部位も、円柱が作れて胴に落ちない）", async () => {
		const body = await load(bodyFile);
		const poses = await load(posesFile);
		const kit = createModelBodyKit(body.scene, poses.scene);
		expect(kit).not.toBeNull();
		const counts = VERYARE_PAINT_PARTS.map(() => 0);
		body.scene.traverse((node) => {
			if (!(node instanceof THREE.SkinnedMesh)) return;
			const parts = node.geometry.getAttribute("paintPart");
			expect(parts).toBeDefined();
			for (let i = 0; i < parts.count; i++) {
				const index = Math.round(parts.getX(i));
				counts[index] = (counts[index] ?? 0) + 1;
			}
		});
		for (const count of counts) expect(count).toBeGreaterThan(0);
		// 左右の腕・脚は、ほぼ同じ数（手は指の頂点が多いので、腕は胴より多くてよい）。
		const [, leftArm = 0, rightArm = 0, leftLeg = 0, rightLeg = 0] = counts;
		expect(Math.abs(leftArm - rightArm) / leftArm).toBeLessThan(0.1);
		expect(Math.abs(leftLeg - rightLeg) / leftLeg).toBeLessThan(0.1);
	});

	it("待機の姿勢で、脚・腕・胸の上をタップすると、その部位になる", async () => {
		const body = await load(bodyFile);
		const poses = await load(posesFile);
		const kit = createModelBodyKit(body.scene, poses.scene);
		if (kit === null) throw new Error("作れない");
		const instance = kit.create(new THREE.Texture(), 0xffffff);
		instance.object.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(instance.object, true);
		const pick = (x: number, y: number) =>
			instance.pickUv(
				new THREE.Raycaster(
					new THREE.Vector3(x, y, 5),
					new THREE.Vector3(0, 0, -1),
				),
			);
		/** from から to へ、1 cm ずつ動かして、最初に当たった部位。 */
		const first = (y: number, from: number, to: number) => {
			const step = Math.sign(to - from) * 0.01;
			for (let x = from; (to - x) * step > 0; x += step) {
				const hit = pick(x, y);
				if (hit !== null) return hit.part;
			}
			return null;
		};
		// 膝より下（高さ 0.3 m）: 中央から外へ。
		const legs = [first(0.3, 0, box.min.x), first(0.3, 0, box.max.x)];
		expect(new Set(legs)).toEqual(new Set(["left-leg", "right-leg"]));
		// 腰の少し上（高さ 1.0 m）: 外から中へ。最初に当たるのは、下ろした腕。
		const arms = [first(1.0, box.min.x, 0), first(1.0, box.max.x, 0)];
		expect(new Set(arms)).toEqual(new Set(["left-arm", "right-arm"]));
		// 胸の上の中央（高さ 1.3 m）は胴（肩（鎖骨）を胴にした理由）。
		expect(pick(0, 1.3)?.part).toBe("torso");
		instance.dispose();
	});
});
