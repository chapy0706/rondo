/**
 * glb のバイト列を、表示に使う形にする（issue-55）。
 *
 * 平屋の glb は、形のデータを meshopt で圧縮している（EXT_meshopt_compression。tools/build_house.mjs）。
 * 読むには MeshoptDecoder（WebAssembly）が要る。デコーダは、その glb が meshopt を使うときだけ
 * 読み込み、1回読み込んだら使い回す。圧縮していない素材（疎通の確認用の立方体など）は、デコーダが
 * 読めない端末でも読める。
 *
 * デコーダの読み込み（モジュールの取得・WebAssembly の準備）に失敗したら DecoderUnavailable を
 * 投げる。素材のローダー（loader.ts）が受けて、仮の表示に切り替える。
 *
 * three の読み込み（GLTFLoader・MeshoptDecoder）は注入できるので、テストでは three なしで確かめられる。
 */

import { DecoderUnavailable } from "./loader";

/** MeshoptDecoder の最小形（three の GLTFLoader に渡すもの）。 */
export interface MeshoptDecoderLike {
	readonly ready: Promise<void>;
}

export interface GlbParseDeps<T, D extends MeshoptDecoderLike> {
	/** デコーダを読み込む（本番は three の meshopt_decoder.module.js）。 */
	readonly loadDecoder: () => Promise<D>;
	/** glb を読む。decoder は meshopt を使う glb のときだけ渡す（それ以外は null）。 */
	readonly parseGltf: (data: ArrayBuffer, decoder: D | null) => Promise<T>;
}

const GLB_HEADER_BYTES = 12;
const CHUNK_JSON = 0x4e4f534a;

/** glb の JSON チャンクの extensionsUsed に EXT_meshopt_compression があるか。読めなければ false。 */
export function usesMeshopt(data: ArrayBuffer): boolean {
	if (data.byteLength < GLB_HEADER_BYTES + 8) return false;
	const view = new DataView(data);
	const length = view.getUint32(GLB_HEADER_BYTES, true);
	const type = view.getUint32(GLB_HEADER_BYTES + 4, true);
	const start = GLB_HEADER_BYTES + 8;
	if (type !== CHUNK_JSON || start + length > data.byteLength) return false;
	try {
		const json: unknown = JSON.parse(
			new TextDecoder().decode(new Uint8Array(data, start, length)),
		);
		if (typeof json !== "object" || json === null) return false;
		const used = (json as { extensionsUsed?: unknown }).extensionsUsed;
		return Array.isArray(used) && used.includes("EXT_meshopt_compression");
	} catch {
		return false;
	}
}

export function createGlbParse<T, D extends MeshoptDecoderLike>(
	deps: GlbParseDeps<T, D>,
): (data: ArrayBuffer) => Promise<T> {
	let decoder: Promise<D> | null = null;

	const readyDecoder = (): Promise<D> => {
		decoder ??= (async () => {
			try {
				const loaded = await deps.loadDecoder();
				await loaded.ready;
				return loaded;
			} catch (error) {
				throw new DecoderUnavailable(String(error));
			}
		})();
		return decoder;
	};

	return async (data) => {
		const needed = usesMeshopt(data) ? await readyDecoder() : null;
		return deps.parseGltf(data, needed);
	};
}
