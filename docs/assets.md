# 素材の取り込み

3D 素材（キャラクター・平屋）を、ゲームが読み込める glb にする手順をまとめる。

## 方針

GitHub のリポジトリは公開なので、ステージとキャラクターの素材（元データも、変換した glb も）は、リポジトリに入れない。平屋の規約は二次的な配布を禁じており、公開リポジトリに置くと、素材がそのまま取り出せる形で配られることになるため。

- 素材の元データは `assets-src/` に置き、コミットしない
- 変換の途中の glb も、ゲームが読み込む最終の glb も、コミットしない
- ゲームが読み込む glb は、各自の手元で `apps/web/public/models/` に置く（このフォルダは `.gitignore` で除外している）
- `.gitignore` で除外しているもの: `/assets-src/`、`/apps/web/public/models/`、`*.glb`、`*.blend`、`*.blend1`、`*.fbx`、`*.fbm/`、`*.unitypackage`
- これまでの履歴に、これらのファイルがコミットされたことは無い（2026-10-04 に `git log --all` で確認）
- コミットするのは、変換・調査のスクリプト（`tools/`）、手順（この文書）、利用規約の要約（`docs/licenses/README.md`）。規約の全文の写しはコミットしない（原本は `assets-src/licenses/`）

### 素材が無いとき（フォールバック）

素材はリポジトリに無いので、素材を置いていない環境（新しく取り出したリポジトリ、CI、素材を持たない人の手元）でも、ゲームは動かなければならない。

- 素材が無いときは、仮素材版で動かす。キャラクターはカプセル、ステージは箱と床（いまの veryare の表示と同じもの）
- 素材が有るかは、ゲームを始めるときに glb を読み込めるかで決める。読み込めなければ、警告を出さずに仮素材版にする（エラーで止めない）
- テスト（`make verify`）は素材に頼らない。素材を読み込む部分は、仮素材版で通るようにする
- 本番（A1 のサーバー）に素材をどう置くかは、まだ決めていない（リポジトリからは届かないので、別に置く手順が要る）

## 置き場所

| 種類 | 場所 | コミット |
| --- | --- | --- |
| キャラクターの FBX | `assets-src/characters/*.fbx` | しない |
| 平屋の glb（FBX から変換。いまの元） | `assets-src/house/hiraya-fbx.glb` | しない |
| 平屋の glb（.blend から書き出したもの。前回の元。いまは使わない） | `assets-src/house/hiraya.glb` | しない |
| 平屋のゲーム用 glb（FBX から。6 本。形のデータを圧縮していないもの） | `assets-src/converted/house-fbx/` | しない |
| 平屋のゲーム用 glb（FBX から。6 本。meshopt で圧縮したもの。いまの配信用 / issue-55） | `assets-src/converted/house-fbx-meshopt/` | しない |
| 配信するフォルダ（A1 の素材ディレクトリと同じ形。manifest.json と v<版>/ の glb） | `assets-src/delivery/` | しない |
| 平屋の戸の一覧・断面図（FBX から） | `assets-src/house/doors-fbx.tsv`、`plan-fbx.svg` | しない |
| 平屋の調査結果 | `assets-src/house/hiraya-scene.json` | しない |
| 平屋の確認用 glb（屋根・天井なし） | `assets-src/house/hiraya-preview.glb` | しない |
| 確認用 glb の調査結果 | `assets-src/house/hiraya-preview-scene.json`、`hiraya-preview-roots.tsv`（トップレベルのノードの一覧） | しない |
| 平屋の元データ | `~/Downloads/平屋和風/`（`平屋和風.blend` / `.fbx` / `.unitypackage`、テクスチャ、使い方.txt） | しない（リポジトリの外） |
| 利用規約の原本 | `assets-src/licenses/` | しない |
| 利用規約の要約 | `docs/licenses/README.md` | する |
| 変換後のポーズ素材（23 本） | `assets-src/converted/characters/*.glb` | しない |
| 基準姿勢の人型（X Bot） | `assets-src/converted/characters/x-bot.glb` | しない |
| X Bot の骨格の調査結果 | `assets-src/converted/characters/x-bot-rig.json` | しない |
| 平屋のゲーム用 glb（6 本） | `assets-src/converted/house/hiraya-{indoor,outdoor,roof}-{512,1024}.glb` | しない |
| 戸・障子・欄間の一覧 | `assets-src/house/doors.tsv` | しない |
| 間取りの断面図 | `assets-src/house/plan.svg` | しない |
| 平屋の元データの調査結果 | `assets-src/converted/house/source-fbx.json`、`source-blend.json` | しない |
| ゲームが読み込む glb（各自の手元） | `apps/web/public/models/` | しない |
| 素材の配信の確認用（立方体と manifest.json） | `assets-src/test/` | しない |
| 変換・調査のスクリプト | `tools/make_test_glb.mjs`、`tools/fbx_to_glb.py`、`tools/inspect_rig.py`、`tools/inspect_glb.mjs`、`tools/prepare_house.mjs`、`tools/build_house.mjs`、`tools/list_doors.mjs`、`tools/house_plan.mjs`、`tools/inspect_house_source.py`、`tools/make_manifest.mjs`、`tools/serve-assets.mjs`（手元から素材を配る。docs/e2e.md）、`tools/floor_heights.mjs`（平屋の床の高さを測る）、`tools/wall_heights.mjs`（平屋の壁・襖・欄間の高さを測る）、`tools/furniture_boxes.mjs`（平屋の家具の箱を取り出す）、`tools/check_camera_hiraya.mjs`（平屋のカメラのめり込みを全探索する） | する |

## 必要なもの

- Blender（確認した版: 5.2.2 LTS）。実行ファイルは `/Applications/Blender.app/Contents/MacOS/Blender`
- Node（確認した版: 24）。`tools/inspect_glb.mjs` は Node の標準機能だけで動く
- テクスチャの WebP 変換には `sharp` を使う（リポジトリ直下の devDependencies）。sharp は機種ごとのビルド済みのバイナリで動くため、`pnpm approve-builds` は要らなかった（pnpm は install script を止めたと表示するが、読み込めることを確かめた）
- `tools/prepare_house.mjs` は `@gltf-transform/core`・`functions`・`extensions` を使う。リポジトリ直下の devDependencies に入っている（`tools/` はどのワークスペースにも属さないため。アプリの依存には入れない）。`pnpm install` で入る
- `tools/build_house.mjs` の形のデータの圧縮には `meshoptimizer`（エンコーダ）を使う。リポジトリ直下の devDependencies に入っている（版は `@gltf-transform/functions` が使うものと同じ 1.1.1）。アプリの側のデコーダは three に同梱のもの（`three/examples/jsm/libs/meshopt_decoder.module.js`）を使うので、アプリの依存は増えない

## キャラクター: FBX を glb にする

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input assets-src/characters \
  --output assets-src/converted/characters
```

1ファイルだけを変換するときは、`--input` に `.fbx` を、`--output` に `.glb` のパスを渡す（ファイル名は小文字とハイフンにする）。

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input "assets-src/characters/X Bot.fbx" \
  --output assets-src/converted/characters/x-bot.glb
```

- 入力フォルダの `.fbx` を1つずつ、空のシーンに読み込み、同じ名前の `.glb` を +Y Up で書き出す
- 骨格は、読み込んだ時点の姿勢（ポーズ）で書き出す。ポーズの FBX はポーズを1コマのアニメーションとして持つため、基準姿勢で書き出すと全部同じ形になる
- アニメーションは既定では含めない。含めるときは末尾に `--animations` を付ける（歩き・走りなど）
- 各ファイルの大きさ（m）を `SIZE<TAB>名前<TAB>幅<TAB>奥行き<TAB>高さ` の行で出す（Blender の Z が高さ）
- 読み込めないファイルは飛ばして続け、`FAILED` の行で知らせる。1つでも失敗すると終了コードは 1
- 最後に `DONE 成功数 / 全体数` を出す

結果の一覧だけを見るとき:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input assets-src/characters \
  --output assets-src/converted/characters 2>&1 | grep -E "^(SIZE|FAILED|DONE)"
```

### 人型の骨格を調べる

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/inspect_rig.py -- \
  --input "assets-src/characters/X Bot.fbx" \
  --output assets-src/converted/characters/x-bot-rig.json
```

- 骨の名前・親・根元と先端の位置（Blender の座標と glTF の座標の両方）、メッシュの名前・頂点数・頂点グループ（スキンの重み）の数、アクション、全体の大きさを JSON に書き出す
- 正面の向きの手がかり（足先の骨が足首より前にある向き）と、腕の関節の高さも書き出す
- X Bot（Mixamo、T-pose、With Skin）は、高さ 1.81 m、正面は glTF の +Z、腕は水平（肩・肘・手首が同じ高さ 1.44 m）、骨 65 本（`mixamorig:` で始まる）、メッシュ 2 つ（`Beta_Surface`、`Beta_Joints`）。issue-25 の部位割り当てに使う

### 配信する形にする（issue-56）

ゲームは、体の glb（X Bot）を1つと、ポーズの表（23 種類 × 骨 65 本の姿勢）を読み、実行時に体の骨へ姿勢を当てる（ポーズボタンで、読み込みを待たずに変わる）。`tools/character_assets.mjs` で、配信するフォルダに書き出す。

```sh
node tools/character_assets.mjs assets-src/converted/characters assets-src/delivery/v2/characters
node tools/make_manifest.mjs assets-src/delivery
```

| key | 中身 | ファイル |
| --- | --- | --- |
| character-body | X Bot を meshopt で圧縮したもの（量子化 + `EXT_meshopt_compression`。約 0.35 MB） | `character-body-{512,1024}.glb` |
| character-poses | メッシュは持たず、scene の extras（`rondoPoses`）にポーズの表だけを入れたもの（約 80 KB）。骨ごとの位置・回転と、ポーズごとの外接箱（圧縮後の体に当てて、全頂点をスキンで動かして測ったもの） | `character-poses-{512,1024}.glb` |

- 体にテクスチャが無いので、512 と 1024 は同じ中身（manifest は key と品質で引くため、両方に置く）
- ポーズの識別子・表示名・素材の名前は、共有の見本 `packages/contracts/src/fixtures/veryare-poses.json` にある（道具は source の名前で、ポーズの glb を読む）
- 23 本と X Bot は、骨 65 本の名前・並び・逆バインド行列と、2つのメッシュ（頂点位置まで）が同じで、骨の姿勢だけが違う（issue-56 で確認）。骨の名前・並びが違うポーズがあれば、道具は止まる
- 道具は、各ポーズの一番低い点と高さ（体の高さ 1.6 m にそろえたとき）を、標準出力に出す
- 配信の前に、Mixamo の規約の写しを `assets-src/licenses/` に保存する（下の「素材の規約」）

### 待機ルームのほかのメンバー（issue-59）

- 待機ルームのほかのメンバー（最大 4 人）も、同じ体の素材（character-body と character-poses）で描く。素材が無いときは、仮のカプセル（薄い青灰色）で描き、位置と向きは同じように同期して見える
- 体の素材が待機ルームの間に差し替わると、メンバーの体も作り直す（名前と動きの状態はそのまま）
- 頭上の名前は素材ではなく、実行時に canvas で文字を描いた画像（Sprite）。名前を作り直すとき・体を消すときに、画像と材質を解放する
- 待機ルームの「ポーズを変える」ボタンは、素材の体のときだけ出す（仮のカプセルではポーズが変わらないため）

### 既知の問題

- `character.fbx` は FBX 6.1（版 6100）で、Blender の FBX 読み込み（7.1 以降のみ）では読めない。いまは使わない（基準姿勢の人型は X Bot を使う）

## 平屋: FBX を元にする（いまの手順）

平屋は `~/Downloads/平屋和風/平屋和風.fbx` を元にする。`.blend` から書き出した `hiraya.glb` には、壁に戸の開口が無い・切り抜き用の箱が見える・隠した部品が原点に出る、という問題があった（下の「元データを調べる」）。FBX は、ブーリアンが適用済みで、隠したオブジェクトを含まないため、どれも起きない。

```sh
# 1. FBX を glb にする（アニメーションは含めない。テクスチャは FBX と同じフォルダの textures/ から読む）
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/fbx_to_glb.py -- \
  --input ~/Downloads/平屋和風/平屋和風.fbx \
  --output assets-src/house/hiraya-fbx.glb

# 2. 中身を調べる（戸の一覧と断面図の入力にもなる）
node tools/inspect_glb.mjs assets-src/house/hiraya-fbx.glb assets-src/house/hiraya-fbx-scene.json

# 3. ゲーム用 glb（屋内本体・屋外の飾り・屋根と天井 × 512 / 1024 の 6 本。形のデータは meshopt で圧縮）
node tools/build_house.mjs assets-src/house/hiraya-fbx.glb assets-src/converted/house-fbx-meshopt
#    圧縮しない版・量子化だけの版（比べるとき）: --geometry raw / --geometry quantize

# 4. 戸の一覧と、間取りの断面図
node tools/list_doors.mjs assets-src/house/hiraya-fbx-scene.json assets-src/house/doors-fbx.tsv
node tools/house_plan.mjs assets-src/house/hiraya-fbx.glb assets-src/house/plan-fbx.svg

# 大きさと数の表（--count で戸・障子・欄間のノードの数も）
node tools/glb_stats.mjs --count "ドア|障子|欄間" assets-src/converted/house-fbx-meshopt/*.glb
```

結果（2026-10-04）:

- `hiraya-fbx.glb`: 63.2 MB、Y が上、単位 m（ノードに拡大縮小なし）。ノード 978、メッシュ 798、三角形 965,850、マテリアル 46、テクスチャ 78。外壁は幅 11.2 m・奥行き 12.1 m（x −5.2〜6.0、z 0〜12.1）で、`hiraya.glb` と同じ
- `hiraya.glb` にあって FBX に無いトップレベルのノードは 22 個で、すべて `.blend` で非表示のもの（LineArt、切り抜き用の箱、照明の別の状態、電源コードなど）。名前の付き方の違いは無く、グループ分けの条件はそのまま使える
- 浴室のシャワーの部品（お風呂 シャワー Curve）は、FBX では浴室の中の正しい位置にあるので残す（`build_house.mjs` は、浴室の床の範囲の外にあるときだけ取り除く）
- 断面図で、壁の線が戸の位置で途切れることを確かめた。15 組の戸の中心・開口の幅・向きは、前回の `doors.tsv` と一致する（片開き戸の中心だけ 0.02〜0.03 m ずれる。開口の箱が無くなり、戸の部品の外接箱で測るため）
- 戸の部品の外接箱は、開口の箱より薄く低い（厚み 0.3 m → 0.1 m、床から 0.4 m → 0.6 m。開口の箱は枠の外側まで含んでいたため）

ガラスと透明:

- ガラスのマテリアル（ガラス、ガラス アルファ01・05・08、水）は、FBX では透過の拡張を失うが、`alphaMode: BLEND`・alpha 0.1〜0.8 の半透明として出ている。不透明に出ているガラスは無いので、手を加えていない
- その一方で、FBX から変換すると、不透明なはずのマテリアル（木目、壁、カラーパレットなど）も `BLEND`（alpha 1）で出る。three.js では、半透明は奥から順に並べて描くので、壁や床が欠けて見えたり、重くなったりする。そこで `build_house.mjs` で、次の方針で直す

不透明・半透明の方針（`build_house.mjs`。テクスチャを変換する前に、全マテリアルで決める）:

- 襖・障子・欄間・和紙のマテリアル（名前で見分ける。いまは「襖」「和紙」の 2 つ）は、必ず `OPAQUE` にする。向こう側の隠れ側が透けて見えないようにするため
- それ以外は、ベースカラーの alpha が 1 で、ベースカラーのテクスチャのうち、そのマテリアルの部品が UV で参照する画素に透明なものが無いものを `OPAQUE` にする。テクスチャが無いものも `OPAQUE` にする
  - 参照する画素は、各頂点の UV と各三角形の中心の UV で調べ、透明（alpha 255 未満）が 0.01% 未満なら、透明な画素が無いとみなす
  - 画像全体で調べないのは、カラーパレット（`color palette_col`）の画像が、使っていない区画の 3% だけ透明なため。画像全体で調べると、パレットを使う 563 部品がすべて半透明になる
- alpha が 1 未満のもの（ガラス、水）と、参照する画素に透明があるもの（葉、網戸）は、`BLEND` のまま残す
- 決めた結果は、`ALPHA` の行で、マテリアルごとに変更前・変更後・理由を出す

結果（2026-10-04）: 46 個のうち、`OPAQUE` に直したもの 36、もとから `OPAQUE` 5、`BLEND` のまま 10（ガラス 4、水 1、葉 4、網戸 1）。6 本の中では、屋内本体の `BLEND` は 5（水、ガラス 3、網戸）、屋外は 5（ガラス 1、葉 4）、屋根と天井は 0

形のデータの圧縮（issue-55）:

屋内本体は、形のデータが約 27.5 MB で、ファイルの大半を占めていた。`build_house.mjs` の最後に、量子化（`KHR_mesh_quantization`）と meshopt の圧縮（`EXT_meshopt_compression`。gltf-transform の `meshopt`、level `high`）を足した。`--geometry` で、圧縮しない（`raw`）・量子化だけ（`quantize`）も選べる。

結果（2026-10-11。gzip は Node の zlib の既定の強さで測った値）:

| ファイル | 圧縮しない（raw） | 量子化だけ | meshopt（既定） | メッシュ | 三角形 |
| --- | --- | --- | --- | --- | --- |
| hiraya-indoor-512 | 29.45 MB（gzip 14.48） | 21.66 MB（gzip 9.62） | **6.99 MB（gzip 4.12）** | 291 | 908,878 |
| hiraya-indoor-1024 | 30.25 MB（gzip 15.28） | 22.47 MB（gzip 10.42） | **7.80 MB（gzip 4.92）** | 291 | 908,878 |
| hiraya-outdoor-512 | 1.30 MB（gzip 1.01） | 1.13 MB（gzip 0.90） | **0.91 MB（gzip 0.83）** | 16 | 19,812 |
| hiraya-outdoor-1024 | 1.30 MB（gzip 1.01） | 1.13 MB（gzip 0.90） | **0.91 MB（gzip 0.83）** | 16 | 19,812 |
| hiraya-roof-512 | 1.68 MB（gzip 0.88） | 1.42 MB（gzip 0.80） | **0.69 MB（gzip 0.52）** | 6 | 37,160 |
| hiraya-roof-1024 | 2.00 MB（gzip 1.20） | 1.74 MB（gzip 1.12） | **1.02 MB（gzip 0.85）** | 6 | 37,160 |

- 屋内本体の 512 版は、そのままで 7 MB。送るときに圧縮されなくても、目標（gzip 後で 10 MB 以下）を満たす
- 三角形の数（インスタンスの数を掛けたもの）・メッシュ数・テクスチャ数・マテリアル数は、圧縮の前後で変わらない。テクスチャ（WebP）は変えていない
- 読み戻して、全頂点のワールド座標（インスタンスの変換を含む）で比べた。3 グループとも、頂点数・三角形数・平均位置が一致し、外接箱の差は 1 mm 以内（位置の量子化は 14 bit）
- ノードの数は 510 → 619 に増える（屋内本体）。量子化は、メッシュを持つノードのローカルの変換（位置・拡大）に、元の大きさへ戻す補正を書き込む。子を持つノードがメッシュも持つときは、メッシュを新しい子ノードに移してから補正する。メッシュを持たない親（戸の「操作軸」など）の変換は変わらないので、ゲームの側で戸を動かすとき（issue-46）は、操作軸を動かす（メッシュを持つノードの位置を直接書き換えない）
- 読み込む側に MeshoptDecoder が要る。apps/web の素材のローダーに設定済み（下の「読み込みとフォールバック」）
- 三角形の数（約 91 万）は、いまは減らしていない。大きさの目標は圧縮だけで満たした。スマホでの描画が重いときは、家具や小物の削除・簡略化を、issue-46 の表示で測ってから決める

## 平屋: 床の高さを測る（issue-46）

```sh
node tools/floor_heights.mjs assets-src/house/hiraya-fbx.glb            # 領域ごとの表と、例外のマス
node tools/floor_heights.mjs assets-src/house/hiraya-fbx.glb --cells    # マスごとの値も出す
```

- 平屋の床は地面より高い。体の足もとを床に合わせるため、床の高さを glb から測る（手では決めない）
- 地図は平屋の共有の見本（`packages/contracts/src/fixtures/veryare-hiraya-stage.json`）から読む。歩けるマスの中心から真下へ線を下ろし、床のノード（畳・部屋床・玄関床・お風呂の床・縁側・床の間の床板と前板。家具は含めない）の三角形に当たる高さを測る
- `TABLE` の行（領域ごとの最頻値）と `EXCEPTION` の行（領域の値から 5 mm より離れたマス）を、`apps/web/src/games/veryare/hiraya.ts` の `FLOOR_HEIGHTS` と `FLOOR_EXCEPTIONS` に書き写す。glb を作り直したら、測り直す

## 平屋: glb の中身を調べる

```sh
node tools/inspect_glb.mjs assets-src/house/hiraya.glb assets-src/house/hiraya-scene.json
```

- glb の JSON 部分を読み、次を JSON に書き出す: ノード名と親子関係、各ノードの位置（ローカル・ワールド）、メッシュごとの寸法（ローカル・ワールドの外接箱、m）、マテリアルの数、テクスチャの数と画像の大きさ（px・バイト数）
- 標準出力に要約を出す: シーンの一覧、ノード数、全体の寸法、屋根・天井・壁・床・襖・障子に見える名前
- glb が複数のシーンを持つときは、既定のシーンから辿れるノードだけで寸法と要約を出す（`hiraya.glb` は、Blender の LineArt 用の白背景シーンも含んでいて、同じノードが2組ある）

以下の「確認用 glb」「ゲーム用 glb」「戸の一覧」「断面図」の節の結果は、前回の `hiraya.glb`（.blend から）でのもの。いまは上の「FBX を元にする」の手順を使う。

## 平屋: 確認用 glb を作る（屋根・天井を外す）

```sh
node tools/prepare_house.mjs \
  assets-src/house/hiraya.glb \
  assets-src/house/hiraya-scene.json \
  assets-src/house/hiraya-preview.glb
node tools/inspect_glb.mjs assets-src/house/hiraya-preview.glb assets-src/house/hiraya-preview-scene.json
```

- 既定のシーン以外（白背景の LineArt 用シーン）を、そのノードごと取り除く
- 屋根と天井のノードを取り除く（ゲームの TPS カメラを遮るため）。名前は `hiraya-scene.json` の既定のシーンのノードから、屋根・天井の名前のもの（`inspect_glb.mjs` と同じ見分け方）を選ぶ。名前が一覧にないのに親ごと消える子孫があれば、一覧にして出す
- 使われなくなったメッシュ・マテリアル・テクスチャを整理し（prune）、重複を統合する（dedup）。空のノード（ドアの回転軸など）は残す
- テクスチャの中身（大きさ・形式）は変えない。マテリアルの拡張（ガラスの透過・発光の強さ・布の光沢）は残す

結果（2026-10-04）: 52.9 MB から 47.8 MB。屋根 22・天井 2 のノードを取り除き、ノード 1,362、メッシュ 669、マテリアル 44、テクスチャ 65。メッシュは2つのシーンで共有されていたため、白背景のシーンを外しても大きくは減らない。大半はテクスチャ（約 27 MB）で、縮小・圧縮は次の段階で行う。

## 平屋: ゲーム用 glb を作る

```sh
node tools/build_house.mjs assets-src/house/hiraya.glb assets-src/converted/house
```

入力は屋根・天井を外す前の `hiraya.glb`。トップレベルのノードの名前で3つに分け、それぞれテクスチャの長辺の上限 512px と 1024px の2種類、計6本を書き出す。

| グループ | 中身 | ファイル |
| --- | --- | --- |
| 屋内本体 | 建物、家具・設備、戸・障子・欄間、縁側、地面、玄関階段 | `hiraya-indoor-{512,1024}.glb` |
| 屋外の飾り | 木、低木、塀1・塀2、門まわり（表札、郵便受け、インターホン子機、門灯）、縁側の踏み石 | `hiraya-outdoor-{512,1024}.glb` |
| 屋根と天井 | 寄棟屋根、天井（ゲームの側で表示を切り替える） | `hiraya-roof-{512,1024}.glb` |
| 家具の箱 | メッシュは持たず、scene の extras（`rondoFurniture`）に家具の箱（AABB）の一覧だけを入れたもの。カメラの守りに使う（`tools/furniture_boxes.mjs` で、元の `hiraya-fbx.glb` から作る。512 と 1024 は同じ中身） | `hiraya-furniture-{512,1024}.glb` |

- 白背景のシーンを取り除き、LineArt と、浴室の外にあるシャワーの部品（お風呂 シャワー Curve。浴室の床の範囲の外にあるときだけ）と、中身の無い末端のノード（メッシュも子も無いもの。繰り返し）を取り除く。取り除いた名前と数、切り抜き用の箱の数、グループごとのトップレベルのノードは標準出力に出す
- 同じ形のメッシュ（低木_A など）は、インスタンス（`EXT_mesh_gpu_instancing`）にまとめる。動かさない部品は材質ごとに統合する（join）
- 戸・障子・欄間（名前に「ドア」「障子」「欄間」を含むノードとその子孫）は、インスタンスにも統合にも入れず、1枚ずつ別のノードのまま残す
- 整理（prune）と重複の統合（dedup）をしてから、テクスチャを WebP にして長辺を上限まで縮める（小さいものは拡大しない。品質は sharp の既定）
- マテリアルの拡張（透過・発光の強さ・光沢）は残す。three.js（0.186.1）の GLTFLoader は `EXT_texture_webp`・`EXT_mesh_gpu_instancing`・これらの拡張に対応している
- 最後に、形のデータを圧縮する（`--geometry`。既定は meshopt / issue-55。上の「形のデータの圧縮」）
- 各ファイルの大きさ・メッシュ数・三角形数（インスタンスの数を掛けたもの）・テクスチャ数を、`STATS` の行で出す

## ランダム間取り: 和室の小物のキットを作る（room-props / issue-72）

ランダム間取りの和室に置く、低い小物のキット。元の `hiraya-fbx.glb` から、4 種だけを取り出す。見た目だけで、判定（移動・見通し・射撃）とカメラの守りには入れない（ADR 0054）。旗 `PROPS_READY`（`apps/web/src/games/veryare/roomProps.ts`。既定 false）が立つまでは、開発用の合図（`NEXT_PUBLIC_VERYARE_HIRAYA=1` か `?roof=1`）のときと、動ける隠れ側の規則のルーム（旗 `ROAMING_PROPS`。既定 true）のときだけ読む。

```sh
node tools/room_props.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house
node tools/make_manifest.mjs assets-src/delivery
```

| 種類 | 元の根のノード | 幅 × 奥行き × 高さ（m） | 三角形（元 → キット） |
| --- | --- | --- | --- |
| `chabudai` | ちゃぶ台-002 W90D90H35 | 0.90 × 0.90 × 0.35 | 604 → 604 |
| `zaisu` | 座椅子-001（背もたれが -x、+x を向いて座る） | 0.54 × 0.40 × 0.51 | 1,948 → 528 |
| `tsubo` | 壺-001 | 0.28 × 0.28 × 0.36 | 4,736 → 364 |
| `yunomi` | 湯呑み(軽)-001（ちゃぶ台の上に置く） | 0.06 × 0.06 × 0.07 | 1,024 → 210 |

- 出力は `room-props-{512,1024}.glb`（中身は同じ。絵は 512）。2026-10-26 の実測で 55,576 バイト
- 小物ごとに 1 つのノード（名前は `room-prop:<種類>`）。足もとの中心を原点にし、回転は形に焼き込む。ノードの extras に幅・奥行き・高さと三角形の数、scene の extras（`rondoRoomProps`）に一覧を入れる
- 三角形は meshopt で減らす（上限は `roomProps.ts` の `PROP_TRIANGLES`）。色の絵だけを残し（法線・粗さの絵は外す）、512 の WebP にする。形は meshopt で圧縮する
- 第 1 段階の条件（高さ 0.55 m 以下、上から見た長い辺 1.0 m 以下）を超える小物があれば、何も書かずに止まる。急須（三角形 約 8,700）と座卓和風（天板 2.1 × 0.9 m。寝た体を上から覆う）は入れない
- 手元の素材の検査: `apps/web/src/games/veryare/roomPropsFile.test.ts`（素材が無ければ飛ばす）
- 置き方は `roomPropLayout.ts`（純粋関数）、読み込みと描画は `roomPropKit.ts`（種類 × 材質ごとに 1 つの InstancedMesh）

## ランダム間取り: 材質の素材を作る（stage-materials）

ランダム間取りの床・壁・襖の箱に、平屋の材質を貼るための素材。元の `hiraya-fbx.glb` から、5 つの材質だけを取り出す。

```sh
node tools/stage_materials.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house
node tools/make_manifest.mjs assets-src/delivery
```

| 鍵 | 元の材質 | 使う所 | 1枚の大きさ |
| --- | --- | --- | --- |
| `tatami` | 畳-005 と畳縁-001 から作った、畳 2 枚ぶん（1.8 × 1.8 m）に縁を描いた絵 | 和室（3種類）の床。絵の原点は部屋（スロット）の隅 | 1.8 m |
| `wood-board` | 木目-002-004 | 廊下、和室・押し入れ以外の部屋の床 | 1.0 m |
| `wood-dark` | 木目-002-003_001 | 壁（木の板張り。木目は縦）、押し入れ・縁側の床、襖の鴨居と柱、いつも閉じている戸 | 約 2.0 m |
| `fusuma` | 襖-001 | 襖の板（板の大きさに合わせず、そのまま繰り返す） | 約 3.27 m |
| `doma` | 壁-001-003 | 玄関の床（廊下と同じ茶色に寄せる） | 約 0.37 m |

- 出力は `stage-materials-{512,1024}.glb`（中身は同じ。品質は 512）。2026-10-12 の実測で 300,176 バイト（壁紙を外す前は 476,052 バイト）
- 色の絵と法線の絵を 512 の WebP にする（`EXT_texture_webp`）。材質ごとに、小さな四角いメッシュを1枚付ける（three の GLTFLoader は、メッシュから参照されない材質を読まないため）。材質の名前が鍵
- scene の extras（`rondoStageMaterials`）に、材質ごとの1枚の大きさ（メートル）と、色の絵の平均色（線形の値）を入れる。1枚の大きさは、元の glb のメッシュの UV と長さの比から測る
- 障子（和紙）と壁紙は入れない。ランダム間取りの箱に障子は無い（障子は平屋の glb だけ）。壁は木の板張りで、`wood-dark` を使う
- 壁の木目: `wood-dark` の絵は木目が縦（v の向き）に走る。壁の UV は、u が壁に沿う向き、v が −高さなので、そのまま貼ると木目が縦になる（入れ替えない）。床の UV は x・z
- 場所と材質の対応は `apps/web/src/games/veryare/stageMaterials.ts` の `FLOOR_MATERIALS`・`SURFACE_MATERIALS`。玄関を板にするときは、`genkan` の1行を変える
- 色の寄せ: 実行時に、材質の色の値へ「代表色 ÷ 絵の平均色」（線形の値、色ごと。0〜8 に抑える）を入れる。床はその場の代表色（`palette.ts`）。鴨居・柱・襖の板は寄せない
- 壁の暗さ: 壁は、絵に `WALL_MULTIPLY`（灰色 `#6c6c6c`。線形 0.15）をそのまま掛ける。壁の平均色の明るさ（CIELAB の L）は約 20 で、床のどの代表色（いちばん暗い押し入れで L 約 37.5）よりも 15 以上暗く、襖の板（L 約 87.8）とは 30 以上違う。値を変えたら、手元の素材の検査で確かめる
- ダミーの襖（開かない襖に見える壁。2026-10-12 に方針を変えて足した）: ランダム間取りの、2 つの歩ける場所の間の壁に、1 ステージ 4〜6 個（`dummyFusuma.ts`）。本物の閉じた襖と同じ板・鴨居・柱で、開けられない（サーバーは知らない）。位置は地図の行の文字列から作る乱数の種で決まり、全員の画面で同じ。本物の襖の辺とその両隣、玄関・縁側、ほかのダミーの隣には置かない。平屋には置かない。見分けるヒントとして、本物の閉じた襖の板にだけ、小さく暗い引き手（`hikite`）を付ける
- 囲む: 地図の端（東端・南端を含む）と、歩けないマス・庭との境には、すべて壁（縁側の外も、部屋の壁と同じ木の板張り）を立てる。歩けるマスの辺に見えない境が残らないことは、`stageEnclosure.ts` の `uncoveredEdges` のテストで、10 種の骨格の全マスについて確かめる
- 天井: 歩けるマスの上に、天井の板（下面が壁と同じ 2.4 m。下を向く面だけ）。材質は `wood-board` に `CEILING_MULTIPLY`（灰色 `#909090`）を掛け、L 約 27.6 で床のどの代表色よりも暗い。画面の右上の「設定」で、あり・なしを選べる（端末に覚える。既定はあり）。平屋は、屋根と天井の glb のうち、天井のノード（名前が「天井」で始まる）だけを切り替える
- 玄関: 外へ出る辺（地図の端に面した辺）の中央のマス（幅が奇数なら 1 マス、偶数なら 2 マス）に、いつも閉じた引き戸（壁と同じ材質の板と、濃い木の枠。見た目だけ）。ほかの辺は壁
- 読めない・形が違う（鍵が欠ける、extras が無い、色の絵が無い）ときは、色の箱のまま
- 手元に素材があるときだけの検査: `apps/web/src/games/veryare/stageMaterialsFile.test.ts`（大きさ、鍵、寄せたあとの色差、白飛びの割合、壁と床の L の差 15 以上、襖と壁の L の差 30 以上、`wood-dark` の木目が縦）。素材が無ければ飛ばす

## 平屋: 戸・障子・欄間の一覧

```sh
node tools/list_doors.mjs assets-src/house/hiraya-preview-scene.json assets-src/house/doors.tsv
```

- 名前に「ドア」「障子」「欄間」を含むノードすべてについて、名前、親、寸法、中心位置（x, z）、長辺の向き、床からの高さ、襖の候補かを TSV に書き出す
- 襖の候補は「ドア 引違い戸」（2枚戸）、「ドア 引違い戸 4枚戸」、「腰付障子 引違い戸 4枚戸」の部品。片開き戸と玄関の引違い戸は候補にしない
- 外接箱は、子孫に開口の箱（名前に「 B-」を含む部品）があればそれを使う。素材には、ワールドの原点に置かれてしまう小さな部品（ドアノブ、スイッチのボタン、照明の部品など）があり、子孫すべての外接箱だと原点まで伸びるため
- 標準出力に、引違い戸の組ごとの位置と向きを出す

## 平屋: 間取りの断面図

```sh
node tools/house_plan.mjs assets-src/house/hiraya-preview.glb assets-src/house/plan.svg
```

- 高さ y = 1.0m の水平面で外壁と内壁のメッシュを切り、断面の線分を描く。畳と部屋床は上から見た輪郭、戸・障子は開口の箱の輪郭を、種類ごとに色を変えて描く。1m の格子と x・z の目盛りを入れる。右が +x、下が +z（玄関側）
- ブラウザで開いて見る。要素にマウスを載せると名前が出る

### 素材の既知の問題（2026-10-04 に確認）

- 内壁・外壁のメッシュには、戸の開口が空いていない。y = 1.0 / 2.0 / 2.6m で切っても、戸の位置で壁が途切れない。戸ごとの開口の箱（名前に「 B-」を含む、頂点 24 の不透明な箱）は、Blender のブーリアンの切り抜き用の箱と見られ、切り抜きが適用されないまま、箱自体も見えるメッシュとして書き出されている
- 一部の小さな部品（ドアノブ、照明スイッチのボタン、蛇口、ペンダントライトの部品など）は、親の位置を打ち消す位置を持っていて、ワールドの原点（0, 0, 0）に置かれる。Blender では拘束などで正しい位置にあったものが、glTF に書き出すときに外れたと見られる

## 平屋: 元データ（.fbx / .blend）を調べる

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/inspect_house_source.py -- \
  --input ~/Downloads/平屋和風/平屋和風.fbx \
  --doors assets-src/house/doors.tsv \
  --output assets-src/converted/house/source-fbx.json
```

- `--input` に `.blend` も渡せる（読み込むだけで、保存しない）
- 壁をモディファイアーを適用した形で y = 1.0m で切り、`doors.tsv` の戸の組ごとに、開口の中に残る壁の断面の長さを測る（0 なら開口がある）。確かめのため、開口のすぐ脇の長さと、壁の断面の範囲も出す
- 切り抜き用の箱（「 B-」）の数と表示の設定、ブーリアンと拘束の数、ドアノブ・照明スイッチ・蛇口・ペンダントライトの部品の位置を出す

結果（2026-10-04）:

| 項目 | hiraya.glb | 平屋和風.fbx | 平屋和風.blend（評価後） |
| --- | --- | --- | --- |
| 戸の開口（15 組の、開口の中の壁） | 全部ふさがっている（4枚戸 6.72m、2枚戸 3.20m、片開き戸 1.12〜1.32m） | 全部 0（空いている） | 全部 0（空いている） |
| 切り抜き用の箱（「 B-」） | 見えるメッシュとして残っている | 無い | 37 個。表示・レンダーとも隠してあり、ワイヤー表示 |
| ブーリアン | 適用されていない | 適用済み（0 個） | 242 個（壁 29、家具・設備など） |
| 部品の位置 | 原点に置かれるものがある | 79 個、すべて正しい位置（原点 0） | 見える 79 個は正しい位置。原点の 50 個はすべて非表示（レンダーで隠す 2、隠したコレクション 12、ほか見えない 36） |

- `hiraya.glb` の2つの問題は、`.blend` から glTF に書き出すときに、モディファイアーを適用せず、隠したオブジェクト（切り抜き用の箱、別の状態の部品）も含めたために起きたと見られる
- `平屋和風.fbx` は、どちらの問題も無い。テクスチャは同じフォルダの `textures/`（89 枚）を参照し、すべて見つかる。オブジェクト 978、メッシュ 827、三角形 965,850、マテリアル 49。LineArt は無く、屋根 22・天井 2 を含む
- FBX は、ガラスの透過などの glTF のマテリアルの拡張を持てない。FBX から作るときは、ガラスのマテリアルを見直す

## 素材の配信（issue-43 / ADR 0040）

素材はリポジトリに入れず、`assets-rondo.chapy0706.com`（コンテナ `rondo-assets`）から配信する。アプリは、ビルド時の環境変数 `NEXT_PUBLIC_ASSET_BASE_URL` を基準 URL として読み込む。未設定なら素材は読み込まず、仮の表示（箱とカプセル）で動く。A1 での手作業の手順は `docs/deploy.md` の「素材の配信の手順」。

### 配信するフォルダの形

```
<素材ディレクトリ>/            （A1 では /srv/rondo-assets）
  manifest.json               素材の一覧（短くキャッシュする）
  v1/house/hiraya-indoor-512.glb
  v1/house/hiraya-indoor-1024.glb
  v1/test/test-cube-512.glb
  ...
```

- 素材のパスには、版（`v1/` など）を入れる。版付きのパスの中身は変えない（長期キャッシュ・immutable）。中身を変えるときは、新しい版のパス（`v2/...`）に置き、manifest.json を書き換える
- manifest.json の形（例: `docs/ops/assets-manifest.example.json`）

  | 項目 | 意味 |
  | --- | --- |
  | `version` | manifest の形の版（いまは 1） |
  | `assets[].key` | 論理的な名前（例: `hiraya-indoor`、`x-bot`、`test-cube`）。ゲームのコードは、ファイル名ではなく、この名前で素材を指す |
  | `assets[].quality` | 品質。テクスチャの長辺の上限（512 / 1024）。アプリは既定で 512 を使う |
  | `assets[].version` | 素材の版（パスの `v1` と同じ数） |
  | `assets[].path` | 基準 URL からの相対パス（先頭に `/` を付けない、`..` を使わない） |
  | `assets[].bytes` | バイト数（目安） |

- 素材をアップロードするときは、先に glb を送り、最後に manifest.json を送る（`docs/deploy.md` の手順 6）

### manifest.json を作る（issue-55）

配信するフォルダ（`assets-src/delivery/`）を、A1 の素材ディレクトリ（`/srv/rondo-assets`）と同じ形に並べてから、`tools/make_manifest.mjs` で manifest.json を作る。

```sh
# 1. 配信するフォルダに、版付きのパスで glb を並べる（版は、置いてあるものより上げる。上書きしない）
mkdir -p assets-src/delivery/v1/test assets-src/delivery/v2/house
cp assets-src/test/v1/test/*.glb assets-src/delivery/v1/test/
cp assets-src/converted/house-fbx-meshopt/*.glb assets-src/delivery/v2/house/

# 1b. 家具の箱の glb を作る（カメラの守り。元の glb から。--list で箱の一覧も出す）
node tools/furniture_boxes.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house

# 1c. 実データで、カメラのめり込みを全探索する（めり込みが 0 件なら終了コード 0）
node tools/check_camera_hiraya.mjs

# 1d. ランダム間取りの材質の glb を作る（上の「ランダム間取り: 材質の素材を作る」）
node tools/stage_materials.mjs assets-src/house/hiraya-fbx.glb assets-src/delivery/v2/house

# 2. manifest.json を作る（assets-src/delivery/manifest.json。上書きする）
node tools/make_manifest.mjs assets-src/delivery

# 3. アップロード: 先に glb（版付きのパス）、最後に manifest.json
#    manifest が、まだ届いていないファイルを指す時間を作らないため
rsync -av --chmod=D755,F644 --exclude manifest.json assets-src/delivery/ <user>@<A1>:/srv/rondo-assets/
rsync -av --chmod=F644 assets-src/delivery/manifest.json <user>@<A1>:/srv/rondo-assets/manifest.json
```

- 各項目は、ファイルから計算する。key と quality はファイル名（`<key>-<512|1024>.glb`）、version はパスの先頭の版（`v2/...` なら 2）、path はフォルダからの相対パス、bytes はファイルの大きさ
- 同じ key と quality が複数の版にあるときは、いちばん新しい版だけを載せる。古い版のファイルは、A1 に残しておいてよい（manifest を入れ替える前から読み込んでいる利用者が、読み終えられるように）
- manifest.json は全体を置き換えるので、配信を続けたい素材（疎通の確認用の立方体など）も、配信するフォルダに並べておく
- 形の違うファイル（名前が `<key>-<quality>.glb` でない、版のフォルダの外にある、glb の先頭が正しくない）や、同じ key・quality・版の重なりがあれば、manifest.json を書かずに止まる
- リポジトリの中では、`assets-src/` の下だけに書く（素材をコミットしないため）

### 読み込みとフォールバック（クライアント）

- 置き場所: `apps/web/src/infrastructure/assets/`。`preloadAsset(key)` で読み込みを始め、`createSwapSlot` で差し替えのタイミングを決める
- 読み込みは、ゲームの開始を待たせない。仮の表示で先に始め、見た目が急に変わらない時点（待機ルームの間など）で、読み込めていれば本素材に差し替える。その時点に間に合わなければ、その回は仮の表示のまま（差し替えの時点は、素材を使う機能 issue-46・issue-25 が決める）
- 失敗（基準 URL が未設定、manifest が無い・形が違う、manifest に無い素材、404・接続できない、壊れた glb、タイムアウト）は、利用者に警告を出さず、仮の表示に切り替える。原因は `console.info` に `[assets]` で記録する
- 素材は別オリジンから、資格情報（Cookie）を付けずに取得する。品質は既定で 512
- meshopt（issue-55）: glb の `extensionsUsed` に `EXT_meshopt_compression` があるときだけ、three に同梱の MeshoptDecoder（WebAssembly）を読み込み、GLTFLoader に設定する（`glb.ts`。1回読み込んだら使い回す）。圧縮していない素材（立方体など）は、デコーダを読まずに読む。デコーダを読み込めない（モジュールを取得できない、WebAssembly が使えない）ときは、`decoder-unavailable` として記録し、仮の表示に切り替える

### 疎通の確認用の glb

```sh
node tools/make_test_glb.mjs assets-src/test
```

- 1辺 1m の立方体の glb（品質 512 は黄、1024 は青）と、それを指す manifest.json を `assets-src/test/` に作る（コミットしない）
- このフォルダの中身を、そのまま素材ディレクトリに置けば、key `test-cube` で読み込める

### ローカルで素材の配信を試す

本番の rondo-assets は、本番のアプリのオリジンだけを許可する（CORS）。ローカル開発では、同じイメージを手元で起こし、許可するオリジンを `http://localhost:3000` にする。

```sh
docker build -t rondo-assets deploy/assets
docker run --rm -p 8081:3000 \
  -e ASSET_ALLOWED_ORIGIN=http://localhost:3000 \
  -v "$PWD/assets-src/test:/srv/assets:ro" rondo-assets
# 別のターミナルで
NEXT_PUBLIC_ASSET_BASE_URL=http://localhost:8081 pnpm --filter @rondo/web dev
```

## ゲームのロゴ（issue-69）

選択画面のカード・ロビー・起動画面・ゲーム画面・結果画面に出す、ゲームごとのロゴ（ゲームパッケージ）。3D 素材と違い、自作のロゴは公開リポジトリに入れてよい（第三者の絵・素材は入れない）。

### 置き場所と登録

- 置き場所: `apps/web/public/games/<識別子>/logo.svg`（WebP なら `logo.webp`、PNG なら `logo.png`）。識別子は登録の id（gameType）で、表示名ではない
- 登録: そのゲームの `apps/web/src/games/<識別子>/manifest.ts` の `logo` に、パスと背景の色を書く

  ```ts
  logo: { src: "/games/<識別子>/logo.svg", background: "#26315c" },
  ```

- 自作の絵（画像生成や、ほかの道具で作ったもの）に差し替えるときは、決まりどおりのファイルをその名前で置き、`src` を書くだけで出る（画面のコードは変えない）
- ロゴが無い・読めないときは、背景の色と、表示名の頭文字の仮のタイルが出る（壊れた画像は出さない / `apps/web/src/platform/brand/GameLogo.tsx`）

### 決まり

| 形式 | 決まり |
| --- | --- |
| SVG（基本） | `viewBox="0 0 512 512"`。最初の図形で、登録の背景の色を全面に塗る（`<rect width="512" height="512" fill="#…"/>`。角の丸めは画面の側の CSS）。文字を入れない（`text`・`tspan`・`font`。名前は画面に別に出る）。線（`stroke`）を使わず、平らな図形だけ。色は `#rrggbb` で書き、背景を含めて 5 色まで（図形は白か生成り `#f5efe0`、差し色 1 色）。外の画像・参照・スクリプトを含まない。20 KB 以下 |
| WebP | 512 × 512・200 KB 以下。背景を全面に塗る（透明にしない） |
| PNG | 1024 × 1024・sRGB・200 KB 以下。背景を全面に塗る（透明にしない） |

- SVG と WebP の決まりは、`apps/web/src/games/logos.test.ts` が `make verify` で確かめる（SVG は `apps/web/src/platform/brand/svgCheck.ts`、WebP は `webpCheck.ts` がファイルの頭から幅と高さを読む）。登録の `logo.src` が指すファイルが無ければ失敗する
- WebP に差し替えたゲームも、戻せるように、古い `logo.svg` を残す（`src` を `logo.svg` に戻せば、元のロゴに戻る）
- 暗い画面でも明るい画面でも見えるよう、背景の色はロゴの側に持つ
- 駒や牌などは、一般的な図形だけで描く。元の作品で有名な配色・形の並びに近づけない

### 確認用の見本

`tools/logos.html` をブラウザで直接開く（本番には出さない）。6 つのロゴを、160 px と 48 px で、明るい背景と暗い背景の両方に並べて見られる。SVG を直したら、再読み込みで見直せる。

### いまのロゴ

veryare・czz・tilt-maze・nikaku-keshi・minichess は WebP（`logo.webp`）に差し替えた。tetris は、画像のブロックの配色が有名な配色と同じため、SVG のまま。veryare のロゴは、ゲーム画面の画像（平屋のモデルと Mixamo のキャラクターが写っている）で、元のファイルは含まない（`docs/licenses/README.md`）。下の図柄は、SVG（`logo.svg`）のもの。

| ゲーム（識別子） | 背景 | 図柄 |
| --- | --- | --- |
| すごくアレ（veryare） | `#26315c` | 縦に 2 枚の襖と、隙間からのぞく目（黒目に黄） |
| 指示厨ゲーム（czz） | `#ffe3dc` | 白いコマンドの画面に、朱のカーソル「>_」と指し棒（マスコットの絵は、出どころの確認が済むまで使わない） |
| テ〇〇ス（tetris） | `#5b3f8f` | 生成りの 1 色で階段状に積んだ正方形 10 個と、落ちてくる黄の 2 つ |
| ころころ迷路（tilt-maze） | `#3f8f5a` | 生成りの迷路（3 × 3）と白い球・影、出口の黄の四角 |
| 二角消去（nikaku-keshi） | `#c8553d` | 生成りの牌 2 枚（藍の丸）を、直角に 2 回曲がる白い折れ線で結ぶ |
| ミニチェス（minichess） | `#2b2a33` | 5 × 5 の市松の盤（生成りと薄灰）、白い駒（円と台形）、行き先の黄の 1 マス |

### rondo のホーム画面のアイコン

- `apps/web/src/app/icon.svg`（ブラウザのタブ）、`app/apple-icon.tsx`（iPhone、180 × 180）、`app/pwa-icon/[size]/route.tsx`（192・512）、`app/manifest.ts`（name・short_name は rondo、display は `browser`）
- PNG は Next の画像の生成（`next/og`）でビルドのときに作るので、画像のファイルは置かない。図柄は RondoMark（アクセントの黄の輪）を、ink の背景の中央に置いたもの（`apps/web/src/platform/brand/rondoIcon.tsx`）

## 利用規約

規約の全文の写しは、公開リポジトリに入れない。原本は `assets-src/licenses/`（各自の手元）に置き、`docs/licenses/README.md` に素材ごとの要点だけをまとめる。

| 素材 | 制作者 | 原本 | 備考 |
| --- | --- | --- | --- |
| 平屋和風 | 3Dで漫画を作ろう | `assets-src/licenses/license.txt`（2025-10-11） | 二次的な配布・販売は禁止。入手先は未記入 |
| キャラクター（Mixamo） | Adobe | 未用意 | 規約の写しがまだ無い |
