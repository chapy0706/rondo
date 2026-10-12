/**
 * スポイトの色（issue-46 の続き）。平屋の glb を表示している間は、画面に見えている一番手前の面の
 * 見た目の色を拾う。見た目の色は、素材の色の値とテクスチャ（当たった点の UV の画素）を掛け合わせた
 * もので、ライトの当たり方は含めない（画面のピクセルは読まない）。
 *
 * - 見えている物だけを拾う: 自分か祖先が隠れている物（屋根・天井・見えない箱）、材質が見えない物、
 *   透ける物（半透明・透過のあるガラス）は飛ばす。体の描画などは、呼び出し側の skip で飛ばす
 * - テクスチャの UV は、three の Texture.transformUv で、repeat・offset・回転・繰り返し・flipY を
 *   当ててから、最も近い画素を読む（色の表の画像から色を引くので、補間しない）
 * - 色は、テクスチャの画素（sRGB のテクスチャなら線形に直す）と素材の色（three では線形）を、
 *   線形の値で掛け合わせ、sRGB の "#rrggbb"（小文字）に戻す。サーバーに送る色の形と同じ
 */

import * as THREE from "three";

/** テクスチャの画素（RGBA のバイト。上の行から）。 */
export interface TexelSource {
	readonly width: number;
	readonly height: number;
	readonly data: ArrayLike<number>;
}

/** 自分と祖先のすべてが見えているか。 */
function shownWithAncestors(object: THREE.Object3D): boolean {
	for (
		let node: THREE.Object3D | null = object;
		node !== null;
		node = node.parent
	) {
		if (!node.visible) return false;
	}
	return true;
}

/** 当たった面の材質（複数の材質を持つメッシュは、面の材質の番号で選ぶ）。 */
function materialOf(hit: THREE.Intersection): THREE.Material | null {
	const material: unknown = (hit.object as THREE.Mesh).material;
	if (Array.isArray(material)) {
		const index = hit.face?.materialIndex ?? 0;
		const picked: unknown = material[index];
		return picked instanceof THREE.Material ? picked : null;
	}
	return material instanceof THREE.Material ? material : null;
}

/** 透ける材質か（半透明、または透過のある物理材質）。 */
function seeThrough(material: THREE.Material): boolean {
	if (material.transparent && material.opacity < 1) return true;
	return (
		material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0
	);
}

/**
 * 当たり（近い順）から、見えている一番手前の面を選ぶ。skip に当たる物（体の描画など）は飛ばす。
 * 選べなければ null。
 */
export function firstVisibleHit(
	hits: readonly THREE.Intersection[],
	skip: (object: THREE.Object3D) => boolean = () => false,
): THREE.Intersection | null {
	for (const hit of hits) {
		if (!shownWithAncestors(hit.object) || skip(hit.object)) continue;
		const material = materialOf(hit);
		if (material === null || !material.visible || seeThrough(material))
			continue;
		return hit;
	}
	return null;
}

/** UV の位置の画素（RGB のバイト。最も近い画素）。 */
export function texelAt(
	texture: THREE.Texture,
	uv: THREE.Vector2,
	pixels: TexelSource,
): [number, number, number] {
	const at = uv.clone();
	if (texture.matrixAutoUpdate) texture.updateMatrix();
	texture.transformUv(at);
	const x = Math.min(
		pixels.width - 1,
		Math.max(0, Math.floor(at.x * pixels.width)),
	);
	const y = Math.min(
		pixels.height - 1,
		Math.max(0, Math.floor(at.y * pixels.height)),
	);
	const i = (y * pixels.width + x) * 4;
	return [
		pixels.data[i] ?? 0,
		pixels.data[i + 1] ?? 0,
		pixels.data[i + 2] ?? 0,
	];
}

/**
 * 当たった面の見た目の色（"#rrggbb"）。read はテクスチャの画素を返す（読めなければ null）。
 * テクスチャが無い、UV が無い、画素が読めないときは、素材の色の値。素材が色を持たなければ null。
 */
export function surfaceColor(
	hit: THREE.Intersection,
	read: (texture: THREE.Texture) => TexelSource | null,
): string | null {
	const material = materialOf(hit) as
		| (THREE.Material & { color?: unknown; map?: unknown })
		| null;
	if (material === null) return null;
	const base =
		material.color instanceof THREE.Color
			? material.color.clone()
			: new THREE.Color(1, 1, 1);
	const map = material.map instanceof THREE.Texture ? material.map : null;
	const pixels = map === null || hit.uv === undefined ? null : read(map);
	if (map !== null && pixels !== null && hit.uv !== undefined) {
		const [r, g, b] = texelAt(map, hit.uv, pixels);
		const texel = new THREE.Color();
		if (map.colorSpace === THREE.SRGBColorSpace) {
			texel.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
		} else {
			texel.setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
		}
		base.multiply(texel);
	} else if (!(material.color instanceof THREE.Color)) {
		return null;
	}
	return `#${base.getHexString(THREE.SRGBColorSpace)}`;
}

/**
 * テクスチャの画素を読む関数を作る。draw はテクスチャの画像を描いて画素を返す（ブラウザでは
 * キャンバスに描いて getImageData）。テクスチャごとに1回だけ描き、結果（読めなければ null）を覚える。
 */
export function createTextureReader(
	draw: (image: {
		readonly width: number;
		readonly height: number;
	}) => TexelSource,
): (texture: THREE.Texture) => TexelSource | null {
	const cache = new WeakMap<THREE.Texture, TexelSource | null>();
	return (texture) => {
		if (cache.has(texture)) return cache.get(texture) ?? null;
		const image: unknown = texture.image;
		let pixels: TexelSource | null = null;
		if (
			typeof image === "object" &&
			image !== null &&
			typeof (image as { width?: unknown }).width === "number" &&
			typeof (image as { height?: unknown }).height === "number"
		) {
			try {
				pixels = draw(image as { width: number; height: number });
			} catch {
				pixels = null;
			}
			cache.set(texture, pixels);
		}
		return pixels;
	};
}

/** ブラウザで、画像をキャンバスに描いて画素を読む（createTextureReader に渡す）。 */
export function drawOnCanvas(image: {
	readonly width: number;
	readonly height: number;
}): TexelSource {
	const canvas = document.createElement("canvas");
	canvas.width = image.width;
	canvas.height = image.height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (context === null) throw new Error("キャンバスが使えない");
	context.drawImage(image as CanvasImageSource, 0, 0);
	return context.getImageData(0, 0, image.width, image.height);
}
