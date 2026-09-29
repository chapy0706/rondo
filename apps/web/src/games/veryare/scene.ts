/**
 * veryare の 3D シーン（three.js）。
 *
 * 1つのシーンの中に、待機ルームとステージを別々のグループとして持ち、自分がいる空間の
 * グループだけを表示する（ADR 0024）。待機ルームは約3.6m四方の簡素な部屋で、中央に
 * 鬼希望エリアの円を置く。ステージは issue-29 で作り込むまでの仮の床と箱である。
 * 判定は持たない。何を表示するかは rules.ts とサーバーの通知が決める。
 */

import * as THREE from "three";
import {
	ONI_AREA_RADIUS,
	type Point,
	STAGE_HALF,
	type Space,
	WAITING_ROOM_HALF,
} from "./rules";

/** テーマの色（globals.css のトークンと揃える）。 */
const COLORS = {
	ink: 0x13111f,
	surface: 0x1e1b2e,
	line: 0x2e2a45,
	accent: 0xf5b841,
	sub: 0x5fd3c4,
} as const;

const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.08;
/** 目線の高さ（カメラが見る点）。 */
const EYE_HEIGHT = 0.8;
/** カメラとアバターの距離（三人称）。 */
const CAMERA_DISTANCE = 2.6;

export interface VeryareScene {
	/** 表示する空間を切り替える。もう一方のグループは描かない。 */
	setSpace(space: Space): void;
	/** 自分のアバターの位置と色。 */
	setAvatar(position: Point, color: string): void;
	/** 三人称カメラの向き（yaw: Y 軸まわり、pitch: 見下ろす角度）。 */
	setCamera(yaw: number, pitch: number): void;
	resize(width: number, height: number): void;
	render(): void;
	dispose(): void;
}

function floor(size: number, color: number): THREE.Mesh {
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(size, size),
		new THREE.MeshStandardMaterial({ color }),
	);
	mesh.rotation.x = -Math.PI / 2;
	return mesh;
}

/** 床の四辺に低い壁を立てる。 */
function walls(half: number, color: number): THREE.Group {
	const group = new THREE.Group();
	const material = new THREE.MeshStandardMaterial({ color });
	const long = new THREE.BoxGeometry(half * 2, WALL_HEIGHT, WALL_THICKNESS);
	for (const [x, z, turned] of [
		[0, -half, false],
		[0, half, false],
		[-half, 0, true],
		[half, 0, true],
	] as const) {
		const wall = new THREE.Mesh(long, material);
		wall.position.set(x, WALL_HEIGHT / 2, z);
		if (turned) wall.rotation.y = Math.PI / 2;
		group.add(wall);
	}
	return group;
}

function waitingRoom(): THREE.Group {
	const group = new THREE.Group();
	group.add(floor(WAITING_ROOM_HALF * 2, COLORS.line));
	group.add(walls(WAITING_ROOM_HALF, COLORS.surface));

	// 鬼希望エリア（単一の円）。床の少し上に置いてちらつきを避ける。
	const area = new THREE.Mesh(
		new THREE.CircleGeometry(ONI_AREA_RADIUS, 48),
		new THREE.MeshBasicMaterial({
			color: COLORS.accent,
			transparent: true,
			opacity: 0.18,
		}),
	);
	area.rotation.x = -Math.PI / 2;
	area.position.y = 0.005;
	const rim = new THREE.Mesh(
		new THREE.RingGeometry(ONI_AREA_RADIUS - 0.04, ONI_AREA_RADIUS, 48),
		new THREE.MeshBasicMaterial({ color: COLORS.accent }),
	);
	rim.rotation.x = -Math.PI / 2;
	rim.position.y = 0.006;
	group.add(area, rim);
	return group;
}

function stage(): THREE.Group {
	const group = new THREE.Group();
	group.add(floor(STAGE_HALF * 2, COLORS.surface));
	const grid = new THREE.GridHelper(
		STAGE_HALF * 2,
		10,
		COLORS.line,
		COLORS.line,
	);
	grid.position.y = 0.004;
	group.add(grid);
	group.add(walls(STAGE_HALF, COLORS.line));

	// 仮の遮蔽物。issue-29 で本来のステージに置き換える。
	const crate = new THREE.MeshStandardMaterial({ color: COLORS.sub });
	for (const [x, z, size] of [
		[-2.5, -1.5, 1],
		[2, 1.5, 0.8],
		[0.5, -3, 1.2],
	] as const) {
		const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crate);
		box.position.set(x, size / 2, z);
		group.add(box);
	}
	return group;
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

	const spaces: Record<Space, THREE.Group> = {
		"waiting-room": waitingRoom(),
		stage: stage(),
	};
	scene.add(spaces["waiting-room"], spaces.stage);

	const avatarMaterial = new THREE.MeshStandardMaterial({ color: 0xece8f5 });
	const avatar = new THREE.Mesh(
		new THREE.CapsuleGeometry(0.2, 0.6, 4, 12),
		avatarMaterial,
	);
	avatar.position.y = 0.5;
	scene.add(avatar);

	const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
	let yaw = 0;
	let pitch = 0.35;

	const placeCamera = () => {
		const target = new THREE.Vector3(
			avatar.position.x,
			EYE_HEIGHT,
			avatar.position.z,
		);
		// yaw 0 で -z を向くよう、カメラはアバターの +z 側の後ろに置く。
		const back = Math.cos(pitch) * CAMERA_DISTANCE;
		camera.position.set(
			target.x + Math.sin(yaw) * back,
			target.y + Math.sin(pitch) * CAMERA_DISTANCE,
			target.z + Math.cos(yaw) * back,
		);
		camera.lookAt(target);
	};

	return {
		setSpace(space) {
			spaces["waiting-room"].visible = space === "waiting-room";
			spaces.stage.visible = space === "stage";
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
		resize(width, height) {
			renderer.setSize(width, height, false);
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
		},
		render() {
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
