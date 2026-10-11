/**
 * Docker なしで、手元から素材を配る（issue-46）。本番の rondo-assets（deploy/assets の nginx）と
 * 同じ振る舞いを、Node の標準モジュールだけで行う。依存は無い。
 *
 * 使い方:
 *   node tools/serve-assets.mjs                                   # assets-src/delivery を 8081 番で配る
 *   node tools/serve-assets.mjs --dir assets-src/test --origin http://localhost:3000 --port 8082
 *
 *   --dir     配るフォルダ（既定 assets-src/delivery。manifest.json と v<版>/ の glb を置いたもの）
 *   --origin  CORS で許可するオリジン（既定 http://localhost:3100。make dev-all の web）。
 *             本番の ASSET_ALLOWED_ORIGIN と同じく、要求の Origin に関わらず、この1つを返す
 *   --port    待ち受けるポート（既定 8081）
 *
 * - 待ち受けるのは 127.0.0.1 だけ（ほかの機器からは届かない）
 * - 配るのは /manifest.json と /v<数字>/…/*.glb だけ。それ以外は 404。ディレクトリの一覧は出さない
 * - manifest.json は短いキャッシュ（max-age=60）、版付きの glb は長期（1年・immutable）。
 *   失敗の応答（404 など）には、キャッシュのヘッダを付けない
 * - GET と HEAD だけ。それ以外は 405
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULTS = {
	dir: "assets-src/delivery",
	origin: "http://localhost:3100",
	port: 8081,
};

const MANIFEST_CACHE = "public, max-age=60";
const GLB_CACHE = "public, max-age=31536000, immutable";
/** 版付きのパスの glb（deploy/assets/default.conf.template と同じ形）。 */
const GLB_PATH = /^\/v[0-9]+\/.+\.glb$/;

/**
 * 要求の振り分け（ファイルの有無は isFile で調べる）。返すのは、状態・ヘッダ・配るファイルの場所
 * （無ければ null）。
 */
export function route(method, rawUrl, { root, origin, isFile }) {
	const headers = {
		"Access-Control-Allow-Origin": origin,
		"X-Content-Type-Options": "nosniff",
	};
	if (method !== "GET" && method !== "HEAD") {
		return {
			status: 405,
			headers: { ...headers, Allow: "GET, HEAD" },
			file: null,
		};
	}
	let path;
	try {
		path = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
	} catch {
		return { status: 400, headers, file: null };
	}
	let type;
	let cache;
	if (path === "/manifest.json") {
		type = "application/json";
		cache = MANIFEST_CACHE;
	} else if (GLB_PATH.test(path) && !path.split("/").includes("..")) {
		type = "model/gltf-binary";
		cache = GLB_CACHE;
	} else {
		return { status: 404, headers, file: null };
	}
	const file = resolve(root, `.${path}`);
	if (!file.startsWith(root + sep) || !isFile(file)) {
		return { status: 404, headers, file: null };
	}
	return {
		status: 200,
		headers: { ...headers, "Content-Type": type, "Cache-Control": cache },
		file,
	};
}

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function parseArgs(argv) {
	const options = { ...DEFAULTS };
	for (let i = 0; i < argv.length; i += 2) {
		const [name, value] = [argv[i], argv[i + 1]];
		if (value === undefined) throw new Error(`${name} の後に値を書く`);
		if (name === "--dir") options.dir = value;
		else if (name === "--origin") options.origin = value;
		else if (name === "--port") options.port = Number(value);
		else throw new Error(`知らない引数: ${name}`);
	}
	if (!Number.isInteger(options.port) || options.port <= 0) {
		throw new Error(`--port は正の整数にする: ${options.port}`);
	}
	try {
		new URL(options.origin);
	} catch {
		throw new Error(`--origin の形が違う: ${options.origin}`);
	}
	return options;
}

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`停止: ${error.message}`);
		console.error(
			"使い方: node tools/serve-assets.mjs [--dir <フォルダ>] [--origin <URL>] [--port <番号>]",
		);
		process.exit(2);
	}
	const root = resolve(options.dir);
	if (!isFile(resolve(root, "manifest.json"))) {
		console.error(
			`停止: ${root}/manifest.json が無い（docs/e2e.md の「平屋のステージ」の作り方を見る）`,
		);
		process.exit(2);
	}
	const server = createServer((req, res) => {
		const result = route(req.method ?? "", req.url ?? "/", {
			root,
			origin: options.origin,
			isFile,
		});
		console.log(`${req.method} ${req.url} ${result.status}`);
		if (result.file === null) {
			res.writeHead(result.status, result.headers);
			res.end();
			return;
		}
		res.writeHead(200, {
			...result.headers,
			"Content-Length": statSync(result.file).size,
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		createReadStream(result.file).pipe(res);
	});
	server.listen(options.port, HOST, () => {
		console.log(
			`配っています: http://${HOST}:${options.port}/ （フォルダ ${root}、許可するオリジン ${options.origin}）`,
		);
		console.log("止めるときは Ctrl-C");
	});
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
