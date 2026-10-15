/**
 * 動きの素材の検査（issue-57）。手元に素材（assets-src/delivery の character-motions と character-body）
 * があるときだけ、Node で読んで確かめる。素材のファイルはリポジトリに入れないので、無ければ飛ばす
 * （make verify は素材に頼らない）。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import {
	horizontalRange,
	missingBones,
	seamAngle,
	upAxisOf,
} from "./motionAsset";
import { BONE_EPSILON, STALL_SECONDS } from "./motionWatch";
import { parseMotionSet } from "./motions";

const asset = (name: string) =>
	new URL(
		`../../../../../assets-src/delivery/v2/characters/${name}`,
		import.meta.url,
	);
const motionsFile = asset("character-motions-512.glb");
const bodyFile = asset("character-body-512.glb");
const present = existsSync(motionsFile) && existsSync(bodyFile);

/** 3つ合わせた大きさの目標（バイト）。 */
const TARGET_BYTES = 300 * 1024;

async function load(file: URL) {
	const data = readFileSync(file);
	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	return loader.parseAsync(new Uint8Array(data).buffer, "");
}

describe.skipIf(!present)(
	"動きの素材の検査（手元に素材があるときだけ）",
	() => {
		it("大きさは、目標（3つ合わせて 300 KB）以内", () => {
			expect(statSync(motionsFile).size).toBeLessThanOrEqual(TARGET_BYTES);
		});

		it("待機・歩く・走るの動きと標準の速さがあり、骨の名前は体の骨にすべて含まれる", async () => {
			const motions = await load(motionsFile);
			motions.scene.animations = motions.animations;
			const set = parseMotionSet(motions.scene);
			expect(set).not.toBeNull();
			const body = await load(bodyFile);
			const bones: string[] = [];
			body.scene.traverse((node) => {
				if (node instanceof THREE.Bone) bones.push(node.name);
			});
			for (const clip of motions.animations) {
				const names = [
					...new Set(
						clip.tracks.map((track) => track.name.split(".")[0] ?? ""),
					),
				];
				expect(missingBones(names, bones), clip.name).toEqual([]);
			}
		});

		it("根の水平の移動が取り除かれ（範囲 0.1 m 以内）、最初と最後の姿勢の差が小さい（0.5° 以内）", async () => {
			const motions = await load(motionsFile);
			const body = await load(bodyFile);
			body.scene.updateMatrixWorld(true);
			let hipsParent: THREE.Object3D | null = null;
			body.scene.traverse((node) => {
				if (node instanceof THREE.Bone && node.name === "mixamorigHips") {
					hipsParent = node.parent;
				}
			});
			if (hipsParent === null) throw new Error("体に Hips が無い");
			const parent = (hipsParent as THREE.Object3D).matrixWorld.elements;
			const up = upAxisOf(parent);
			const horizontal = [0, 1, 2].filter((axis) => axis !== up) as [
				number,
				number,
			];
			const scale = Math.hypot(parent[0] ?? 0, parent[1] ?? 0, parent[2] ?? 0);
			for (const clip of motions.animations) {
				const hips = clip.tracks.find(
					(t) => t.name === "mixamorigHips.position",
				);
				if (hips === undefined)
					throw new Error(`${clip.name} に Hips の位置が無い`);
				const positions: [number, number, number][] = [];
				for (let i = 0; i < hips.times.length; i++) {
					positions.push([
						hips.values[i * 3] ?? 0,
						hips.values[i * 3 + 1] ?? 0,
						hips.values[i * 3 + 2] ?? 0,
					]);
				}
				expect(
					horizontalRange(positions, horizontal) * scale,
					clip.name,
				).toBeLessThan(0.1);
				const first: number[][] = [];
				const last: number[][] = [];
				for (const track of clip.tracks) {
					if (!track.name.endsWith(".quaternion")) continue;
					const n = track.times.length;
					first.push(Array.from(track.values.slice(0, 4)));
					last.push(Array.from(track.values.slice((n - 1) * 4, n * 4)));
				}
				expect(seamAngle(first, last), clip.name).toBeLessThan(0.5);
			}
		});

		it("待機の細かい動きは、どの 0.5 秒でも、骨の回転が見張りのしきい値の 4 倍以上変わる（止まりと誤って数えない）", async () => {
			const motions = await load(motionsFile);
			const body = await load(bodyFile);
			const bones: THREE.Bone[] = [];
			body.scene.traverse((node) => {
				if (node instanceof THREE.Bone) bones.push(node);
			});
			const idle = motions.animations.find((clip) => clip.name === "idle");
			if (idle === undefined) throw new Error("idle が無い");
			const mixer = new THREE.AnimationMixer(body.scene);
			mixer.clipAction(idle).play();
			const dt = 1 / 60;
			const frames: number[][] = [];
			for (let i = 0; i < Math.ceil((idle.duration + 1) / dt); i++) {
				mixer.update(i === 0 ? 0 : dt);
				frames.push(
					bones.flatMap((b) => [
						b.quaternion.x,
						b.quaternion.y,
						b.quaternion.z,
						b.quaternion.w,
					]),
				);
			}
			// 見張りと同じ見方: ある時刻の姿勢から、0.5 秒の間に、いちばん大きく変わった成分の差。
			const window = Math.round(STALL_SECONDS / dt);
			let least = Number.POSITIVE_INFINITY;
			for (let t = 0; t + window < frames.length; t++) {
				const from = frames[t] as number[];
				let most = 0;
				for (let u = t + 1; u <= t + window; u++) {
					const to = frames[u] as number[];
					for (let k = 0; k < from.length; k++) {
						most = Math.max(most, Math.abs((from[k] ?? 0) - (to[k] ?? 0)));
					}
				}
				least = Math.min(least, most);
			}
			expect(least).toBeGreaterThanOrEqual(BONE_EPSILON * 4);
		});
	},
);
