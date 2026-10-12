import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parsePaint } from "./paint";
import {
	type TexelSource,
	createTextureReader,
	firstVisibleHit,
	surfaceColor,
	texelAt,
} from "./surfaceColor";

/** 2×2 の画像（左上・右上・左下・右下の順。RGBA のバイト）。 */
const QUAD: TexelSource = {
	width: 2,
	height: 2,
	data: [
		255, 0, 0, 255, /* 左上 赤 */ 0, 255, 0, 255 /* 右上 緑 */, 0, 0, 255, 255,
		/* 左下 青 */ 255, 255, 255, 255 /* 右下 白 */,
	],
};

const texture = (flipY: boolean): THREE.Texture => {
	const t = new THREE.Texture();
	t.flipY = flipY;
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
};

/** z = depth に置いた、+z を向く 1×1 の板。 */
const plate = (
	depth: number,
	material: THREE.Material = new THREE.MeshStandardMaterial(),
): THREE.Mesh => {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
	mesh.position.z = depth;
	mesh.updateMatrixWorld();
	return mesh;
};

/** +z の側から -z へ、原点を通る線を引いた当たり（近い順）。 */
const castThrough = (objects: THREE.Object3D[]): THREE.Intersection[] => {
	for (const object of objects) object.updateMatrixWorld(true);
	const raycaster = new THREE.Raycaster(
		new THREE.Vector3(0.1, 0.1, 10),
		new THREE.Vector3(0, 0, -1),
	);
	return raycaster.intersectObjects(objects, true);
};

describe("firstVisibleHit - 見えている一番手前の面", () => {
	it("見えない物（祖先が隠れている屋根・天井、見えない箱）を飛ばす", () => {
		const roofGroup = new THREE.Group();
		roofGroup.visible = false;
		const roof = plate(3);
		roofGroup.add(roof);
		const box = plate(2);
		box.visible = false;
		const floor = plate(0);
		const hit = firstVisibleHit(castThrough([roofGroup, box, floor]));
		expect(hit?.object).toBe(floor);
	});

	it("透ける物（ガラス: 半透明、または透過のある物理材質）を飛ばす", () => {
		const glass = plate(
			2,
			new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }),
		);
		const physical = new THREE.MeshPhysicalMaterial();
		physical.transmission = 1;
		const window = plate(1, physical);
		const floor = plate(0);
		expect(firstVisibleHit(castThrough([glass, window, floor]))?.object).toBe(
			floor,
		);
	});

	it("不透明な物は、transparent でも opacity 1 なら拾う。材質が見えない設定なら飛ばす", () => {
		const opaque = plate(
			2,
			new THREE.MeshStandardMaterial({ transparent: true, opacity: 1 }),
		);
		expect(firstVisibleHit(castThrough([opaque]))?.object).toBe(opaque);
		const hidden = plate(1, new THREE.MeshStandardMaterial({ visible: false }));
		const floor = plate(0);
		expect(firstVisibleHit(castThrough([hidden, floor]))?.object).toBe(floor);
	});

	it("skip に当たる物（体の描画など）を飛ばす。何も無ければ null", () => {
		const body = plate(1);
		body.userData.body = true;
		const floor = plate(0);
		expect(
			firstVisibleHit(
				castThrough([body, floor]),
				(object) => object.userData.body === true,
			)?.object,
		).toBe(floor);
		expect(firstVisibleHit([])).toBeNull();
	});
});

describe("texelAt - UV からテクスチャの画素を読む（最も近い画素。補間しない）", () => {
	it("flipY が false（glTF のテクスチャ）: v = 0 が画像の上", () => {
		const t = texture(false);
		expect(texelAt(t, new THREE.Vector2(0.25, 0.25), QUAD)).toEqual([
			255, 0, 0,
		]);
		expect(texelAt(t, new THREE.Vector2(0.75, 0.25), QUAD)).toEqual([
			0, 255, 0,
		]);
		expect(texelAt(t, new THREE.Vector2(0.25, 0.75), QUAD)).toEqual([
			0, 0, 255,
		]);
	});

	it("flipY が true（ふつうの画像の読み込み）: v = 0 が画像の下", () => {
		const t = texture(true);
		expect(texelAt(t, new THREE.Vector2(0.25, 0.25), QUAD)).toEqual([
			0, 0, 255,
		]);
		expect(texelAt(t, new THREE.Vector2(0.75, 0.75), QUAD)).toEqual([
			0, 255, 0,
		]);
	});

	it("repeat・offset（KHR_texture_transform）を当てる。繰り返しなら端を回り込む", () => {
		const t = texture(false);
		t.wrapS = THREE.RepeatWrapping;
		t.wrapT = THREE.RepeatWrapping;
		t.offset.set(0.5, 0);
		// u 0.25 → 0.75（右の列）。
		expect(texelAt(t, new THREE.Vector2(0.25, 0.25), QUAD)).toEqual([
			0, 255, 0,
		]);
		t.offset.set(0, 0);
		t.repeat.set(2, 1);
		// u 0.6 → 1.2 → 0.2（左の列）。
		expect(texelAt(t, new THREE.Vector2(0.6, 0.25), QUAD)).toEqual([255, 0, 0]);
	});

	it("端（u = 1、v = 1）でも、画像の外を読まない", () => {
		const t = texture(false);
		expect(texelAt(t, new THREE.Vector2(1, 1), QUAD)).toEqual([255, 255, 255]);
	});
});

describe("surfaceColor - 当たった面の見た目の色（ライトは含めない）", () => {
	const reader = (source: TexelSource | null) => () => source;
	const hitOn = (material: THREE.Material) =>
		firstVisibleHit(castThrough([plate(0, material)]));

	it("テクスチャがあれば、UV の画素の色（素材の色が白なら、そのまま）", () => {
		const t = texture(false);
		t.wrapS = THREE.RepeatWrapping;
		const material = new THREE.MeshStandardMaterial({ map: t });
		const hit = hitOn(material);
		if (hit === null) throw new Error("当たらない");
		// 線は板の (0.1, 0.1) を通る → uv (0.6, 0.6)。flipY false なので右下の白…ではなく、
		// v 0.6 は画像の下の行・u 0.6 は右の列 → 白。
		expect(surfaceColor(hit, reader(QUAD))).toBe("#ffffff");
	});

	it("素材の色とテクスチャの両方があれば、線形の値で掛け合わせて sRGB に戻す", () => {
		const t = texture(false);
		const material = new THREE.MeshStandardMaterial({
			map: t,
			color: new THREE.Color("#808080"),
		});
		const hit = hitOn(material);
		if (hit === null) throw new Error("当たらない");
		// 白（1.0）× #808080 → #808080。
		expect(surfaceColor(hit, reader(QUAD))).toBe("#808080");
		// sRGB の 128 は線形で約 0.216。線形で掛けると 0.216 × 0.216 ≒ 0.0466 で、sRGB に戻すと 61
		// （sRGB の値どうしを掛ける 128 × 128 / 255 ≒ 64 とは違う）。
		const half: TexelSource = {
			width: 1,
			height: 1,
			data: [128, 128, 128, 255],
		};
		expect(surfaceColor(hit, reader(half))).toBe("#3d3d3d");
	});

	it("テクスチャが無ければ、素材の色の値（sRGB の #rrggbb）", () => {
		const hit = hitOn(new THREE.MeshStandardMaterial({ color: "#b5a46a" }));
		if (hit === null) throw new Error("当たらない");
		expect(surfaceColor(hit, reader(null))).toBe("#b5a46a");
	});

	it("テクスチャの画素が読めなければ、素材の色の値で代える", () => {
		const material = new THREE.MeshStandardMaterial({
			map: texture(false),
			color: "#c2b280",
		});
		const hit = hitOn(material);
		if (hit === null) throw new Error("当たらない");
		expect(surfaceColor(hit, reader(null))).toBe("#c2b280");
	});

	it("線形の色空間のテクスチャは、バイトをそのまま線形の値として扱う", () => {
		const t = texture(false);
		t.colorSpace = THREE.NoColorSpace;
		const hit = hitOn(new THREE.MeshStandardMaterial({ map: t }));
		if (hit === null) throw new Error("当たらない");
		const half: TexelSource = {
			width: 1,
			height: 1,
			data: [128, 128, 128, 255],
		};
		// 線形 0.502 → sRGB 約 0.737（#bc 付近）。
		expect(surfaceColor(hit, reader(half))).toBe("#bcbcbc");
	});

	it("取れた色は、サーバーに送る色（#rrggbb の小文字）として有効", () => {
		const t = texture(false);
		const material = new THREE.MeshStandardMaterial({
			map: t,
			color: "#a07850",
		});
		const hit = hitOn(material);
		if (hit === null) throw new Error("当たらない");
		const color = surfaceColor(hit, reader(QUAD));
		if (color === null) throw new Error("色が無い");
		expect(
			parsePaint({
				kind: "strokes",
				strokes: [
					{ part: "torso", color, size: 0.04, points: [{ u: 0.5, v: 0.5 }] },
				],
			}),
		).not.toBeNull();
	});
});

describe("createTextureReader - テクスチャをキャンバスに描いて読む（テクスチャごとにキャッシュ）", () => {
	it("同じテクスチャは1回だけ描く。画像が無いテクスチャは null", () => {
		let drawn = 0;
		const read = createTextureReader(() => {
			drawn += 1;
			return QUAD;
		});
		const t = texture(false);
		t.image = { width: 2, height: 2 };
		expect(read(t)).toBe(QUAD);
		expect(read(t)).toBe(QUAD);
		expect(drawn).toBe(1);
		expect(read(texture(false))).toBeNull();
		expect(drawn).toBe(1);
	});

	it("描けなかった（例外）テクスチャは null を覚え、描き直さない", () => {
		let tried = 0;
		const read = createTextureReader(() => {
			tried += 1;
			throw new Error("描けない");
		});
		const t = texture(false);
		t.image = { width: 2, height: 2 };
		expect(read(t)).toBeNull();
		expect(read(t)).toBeNull();
		expect(tried).toBe(1);
	});
});
