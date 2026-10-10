/**
 * veryare の 3D シーン（three.js）。
 *
 * 1つのシーンの中に、待機ルームとステージを別々のグループとして持ち、自分がいる空間の
 * グループだけを表示する（ADR 0024）。待機ルームは半径2mの円柱形の部屋で、中央に
 * 同心円の鬼希望エリアを置く。エリアの色は赤（待機）/ 緑（開始）/ 青（鬼希望）。ステージは、ステージの通知から組む床・壁・襖の箱（stageBoxes.ts / issue-29c）で、素材は使わない。
 * 判定は持たない。何を表示するかは rules.ts とサーバーの通知が決める。
 *
 * 観戦（issue-28）: 鬼と隠れ側（探索開始時の一括配信）も描く。カメラは自分か鬼を中央に
 * 固定した周回カメラ（ADR 0034）で、向きは視点パッドだけで変わり、鬼の向きには引きずられ
 * ない。鬼の位置は届くたびに跳ばさず、表示を滑らかに寄せる（酔いを避ける）。
 */

import * as THREE from "three";
import type { View } from "./rules";
import {
	type AreaState,
	ONI_AREA_RADIUS,
	type Point,
	type Space,
	WAITING_ROOM_RADIUS,
	areaLook,
} from "./rules";
import type { StageGrid } from "./stage";
import { type StageBox, stageBoxes } from "./stageBoxes";

/** テーマの色（globals.css のトークンと揃える）。 */
const COLORS = {
	ink: 0x13111f,
	surface: 0x1e1b2e,
	line: 0x2e2a45,
	accent: 0xf5b841,
	sub: 0x5fd3c4,
} as const;

/** 鬼希望エリアの色（ADR 0024）。 */
const AREA_COLORS = {
	red: 0xef4444,
	green: 0x22c55e,
	blue: 0x3b82f6,
} as const;

const WALL_HEIGHT = 1.2;
/** 目線の高さ（カメラが見る点）。 */
const EYE_HEIGHT = 0.8;
/** カメラとアバターの距離（三人称）。 */
const CAMERA_DISTANCE = 2.6;

export interface VeryareScene {
	/** 表示する空間を切り替える。もう一方のグループは描かない。 */
	setSpace(space: Space): void;
	/** ステージの地図と、開いている襖（edgeKey）。地図が null なら何も描かない（issue-29c）。 */
	setStage(grid: StageGrid | null, open: ReadonlySet<string>): void;
	/** 鬼希望エリアの状態（鬼選出中だけ。null ならエリアを隠す）。 */
	setArea(area: AreaState | null): void;
	/** 自分のアバターの位置と色。 */
	setAvatar(position: Point, color: string): void;
	/** 三人称カメラの向き（yaw: Y 軸まわり、pitch: 見下ろす角度）。 */
	setCamera(yaw: number, pitch: number): void;
	/** カメラの中心。self は自分、oni は鬼（ADR 0034）。 */
	setView(view: View): void;
	/** 鬼（探索中だけ。null なら隠す）。facing はサーバーの向き（x 軸から z 軸へ）。 */
	setOni(oni: SceneOni | null): void;
	/** 隠れ側（自分を除く）。color は "#rrggbb"。 */
	setHiders(hiders: readonly SceneHider[]): void;
	/** 画面の中央（照準）に重なっている隠れ側の ID。重なっていなければ null（issue-27）。 */
	pickHider(): string | null;
	resize(width: number, height: number): void;
	render(): void;
	dispose(): void;
}

export interface SceneOni {
	readonly x: number;
	readonly z: number;
	readonly facing: number;
}

export interface SceneHider {
	readonly id: string;
	readonly x: number;
	readonly z: number;
	readonly color: string;
}

/** 鬼の表示を、届いた位置へ寄せる速さ（1秒あたりの割合の目安）。 */
const ONI_FOLLOW_RATE = 6;
const ONI_COLOR = 0xef4444;

interface WaitingRoom {
	readonly group: THREE.Group;
	/** 鬼希望エリア（円と縁）。色を状態に合わせて変える。 */
	readonly area: THREE.Group;
	readonly areaFill: THREE.MeshBasicMaterial;
	readonly areaRim: THREE.MeshBasicMaterial;
}

/** 円柱形の待機ルーム。円い床と、内側から見える円筒の壁。 */
function waitingRoom(): WaitingRoom {
	const group = new THREE.Group();

	const floorDisc = new THREE.Mesh(
		new THREE.CircleGeometry(WAITING_ROOM_RADIUS, 64),
		new THREE.MeshStandardMaterial({ color: COLORS.line }),
	);
	floorDisc.rotation.x = -Math.PI / 2;
	group.add(floorDisc);

	const wall = new THREE.Mesh(
		new THREE.CylinderGeometry(
			WAITING_ROOM_RADIUS,
			WAITING_ROOM_RADIUS,
			WALL_HEIGHT,
			64,
			1,
			true,
		),
		new THREE.MeshStandardMaterial({
			color: COLORS.surface,
			side: THREE.BackSide,
		}),
	);
	wall.position.y = WALL_HEIGHT / 2;
	group.add(wall);

	// 鬼希望エリア（同心円）。床の少し上に置いてちらつきを避ける。
	const area = new THREE.Group();
	const areaFill = new THREE.MeshBasicMaterial({
		color: AREA_COLORS.green,
		transparent: true,
		opacity: 0.25,
	});
	const fill = new THREE.Mesh(
		new THREE.CircleGeometry(ONI_AREA_RADIUS, 48),
		areaFill,
	);
	fill.rotation.x = -Math.PI / 2;
	fill.position.y = 0.005;
	const areaRim = new THREE.MeshBasicMaterial({ color: AREA_COLORS.green });
	const rim = new THREE.Mesh(
		new THREE.RingGeometry(ONI_AREA_RADIUS - 0.05, ONI_AREA_RADIUS, 48),
		areaRim,
	);
	rim.rotation.x = -Math.PI / 2;
	rim.position.y = 0.006;
	area.add(fill, rim);
	group.add(area);

	return { group, area, areaFill, areaRim };
}

/**
 * ステージの箱（stageBoxes.ts の一覧）を、色ごとに1つの InstancedMesh にまとめて描く。
 * 最も大きい骨格でも描画の呼び出しは十数回に収まる。
 */
function stageMeshes(boxes: readonly StageBox[]): THREE.InstancedMesh[] {
	const byColor = new Map<string, StageBox[]>();
	for (const box of boxes) {
		const list = byColor.get(box.color) ?? [];
		list.push(box);
		byColor.set(box.color, list);
	}
	const unit = new THREE.BoxGeometry(1, 1, 1);
	const matrix = new THREE.Matrix4();
	const meshes: THREE.InstancedMesh[] = [];
	for (const [color, list] of byColor) {
		const mesh = new THREE.InstancedMesh(
			unit,
			new THREE.MeshStandardMaterial({ color }),
			list.length,
		);
		list.forEach((box, index) => {
			matrix.makeScale(box.width, box.height, box.depth);
			matrix.setPosition(box.x, box.y, box.z);
			mesh.setMatrixAt(index, matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		meshes.push(mesh);
	}
	return meshes;
}

export function createScene(canvas: HTMLCanvasElement): VeryareScene {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(COLORS.ink);
	scene.add(new THREE.HemisphereLight(0xffffff, COLORS.ink, 1.2));
	const sun = new THREE.DirectionalLight(0xffffff, 1.4);
	sun.position.set(3, 6, 2);
	scene.add(sun);

	const room = waitingRoom();
	const spaces: Record<Space, THREE.Group> = {
		"waiting-room": room.group,
		// ステージの通知が届くまでは、何も描かない（setStage で組む）。
		stage: new THREE.Group(),
	};
	scene.add(spaces["waiting-room"], spaces.stage);

	const avatarMaterial = new THREE.MeshStandardMaterial({ color: 0xece8f5 });
	const avatar = new THREE.Mesh(
		new THREE.CapsuleGeometry(0.2, 0.6, 4, 12),
		avatarMaterial,
	);
	avatar.position.y = 0.5;
	scene.add(avatar);

	// 鬼。正面が分かるよう、前に小さな印を付ける。
	const oni = new THREE.Group();
	const oniBody = new THREE.Mesh(
		new THREE.CapsuleGeometry(0.2, 0.6, 4, 12),
		new THREE.MeshStandardMaterial({ color: ONI_COLOR }),
	);
	oniBody.position.y = 0.5;
	const oniNose = new THREE.Mesh(
		new THREE.ConeGeometry(0.08, 0.2, 8),
		new THREE.MeshStandardMaterial({ color: COLORS.accent }),
	);
	oniNose.rotation.x = Math.PI / 2;
	oniNose.position.set(0, 0.75, 0.25);
	oni.add(oniBody, oniNose);
	oni.visible = false;
	scene.add(oni);
	let oniTarget: SceneOni | null = null;

	const hiderGroup = new THREE.Group();
	scene.add(hiderGroup);
	let hiderKey = "";

	const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
	let yaw = 0;
	let pitch = 0.35;
	let view: View = "self";
	let lastRender = performance.now();

	const placeCamera = () => {
		const center =
			view === "oni" && oni.visible ? oni.position : avatar.position;
		const target = new THREE.Vector3(center.x, EYE_HEIGHT, center.z);
		// yaw 0 で -z を向くよう、カメラはアバターの +z 側の後ろに置く。
		const back = Math.cos(pitch) * CAMERA_DISTANCE;
		camera.position.set(
			target.x + Math.sin(yaw) * back,
			target.y + Math.sin(pitch) * CAMERA_DISTANCE,
			target.z + Math.cos(yaw) * back,
		);
		camera.lookAt(target);
	};

	let stageGrid: StageGrid | null = null;
	let stageOpen: ReadonlySet<string> | null = null;
	const clearStage = () => {
		const meshes = [...spaces.stage.children];
		spaces.stage.clear();
		const geometries = new Set<THREE.BufferGeometry>();
		for (const mesh of meshes) {
			if (!(mesh instanceof THREE.InstancedMesh)) continue;
			geometries.add(mesh.geometry);
			(mesh.material as THREE.Material).dispose();
			mesh.dispose();
		}
		for (const geometry of geometries) geometry.dispose();
	};

	return {
		setStage(grid, open) {
			// 地図か襖の状態が変わったときだけ組み直す（襖の通知はまれ）。
			if (grid === stageGrid && open === stageOpen) return;
			stageGrid = grid;
			stageOpen = open;
			clearStage();
			if (grid === null) return;
			for (const mesh of stageMeshes(stageBoxes(grid, open))) {
				spaces.stage.add(mesh);
			}
		},
		setSpace(space) {
			spaces["waiting-room"].visible = space === "waiting-room";
			spaces.stage.visible = space === "stage";
		},
		setArea(area) {
			room.area.visible = area !== null;
			if (area === null) return;
			const color = AREA_COLORS[areaLook(area).color];
			room.areaFill.color.setHex(color);
			room.areaRim.color.setHex(color);
		},
		setAvatar(position, color) {
			avatar.position.x = position.x;
			avatar.position.z = position.z;
			avatarMaterial.color.set(color);
		},
		setCamera(nextYaw, nextPitch) {
			yaw = nextYaw;
			pitch = nextPitch;
		},
		setView(next) {
			view = next;
		},
		setOni(next) {
			if (next === null) {
				oni.visible = false;
				oniTarget = null;
				return;
			}
			// 初めて見えたときだけ、その場に置く。以後は render で滑らかに寄せる。
			if (!oni.visible) oni.position.set(next.x, 0, next.z);
			oni.visible = true;
			oniTarget = next;
			// 正面の印（ローカルの +z）を、サーバーの向きの方へ回す。
			oni.rotation.y = Math.atan2(Math.cos(next.facing), Math.sin(next.facing));
		},
		setHiders(hiders) {
			const key = hiders
				.map((h) => `${h.id}:${h.x}:${h.z}:${h.color}`)
				.join("|");
			if (key === hiderKey) return;
			hiderKey = key;
			for (const child of [...hiderGroup.children]) {
				hiderGroup.remove(child);
				if (child instanceof THREE.Mesh) {
					child.geometry.dispose();
					(child.material as THREE.Material).dispose();
				}
			}
			for (const hider of hiders) {
				const mesh = new THREE.Mesh(
					new THREE.CapsuleGeometry(0.2, 0.6, 4, 12),
					new THREE.MeshStandardMaterial({ color: hider.color }),
				);
				mesh.position.set(hider.x, 0.5, hider.z);
				mesh.userData.playerId = hider.id;
				hiderGroup.add(mesh);
			}
		},
		pickHider() {
			// 照準は画面の中央。鬼自身の体は当てる対象に入れず、隠れ側だけを見る。
			// 壁越しかどうかはここでは見ない（サーバーの判定に任せる / ADR 0022）。
			placeCamera();
			const raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
			const [hit] = raycaster.intersectObjects(hiderGroup.children, false);
			const id: unknown = hit?.object.userData.playerId;
			return typeof id === "string" ? id : null;
		},
		resize(width, height) {
			renderer.setSize(width, height, false);
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
		},
		render() {
			const now = performance.now();
			const dt = Math.min((now - lastRender) / 1000, 0.1);
			lastRender = now;
			if (oniTarget !== null) {
				const t = Math.min(1, dt * ONI_FOLLOW_RATE);
				oni.position.x += (oniTarget.x - oni.position.x) * t;
				oni.position.z += (oniTarget.z - oni.position.z) * t;
			}
			placeCamera();
			renderer.render(scene, camera);
		},
		dispose() {
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh) {
					object.geometry.dispose();
					const materials = Array.isArray(object.material)
						? object.material
						: [object.material];
					for (const material of materials) material.dispose();
				}
			});
			renderer.dispose();
		},
	};
}
