# デプロイ手順（本番）

rondo の本番は、A1 のリポジトリの作業コピーで docker compose を直接実行してビルド・起動し（`deploy/a1-deploy.sh`）、Cloudflare Tunnel を通じて公開する。staging は廃止し、prod 一本で運用する（issue-35）。

Coolify そのものは A1 で動き続ける。rondo が使うのは、Coolify のプロキシ（Traefik のコンテナ `coolify-proxy`）、`coolify` ネットワーク、動的設定のディレクトリ `/data/coolify/proxy/dynamic/` だけで、rondo は Coolify のアプリにしない（Coolify の画面からはビルド・起動しない）。

## 構成

```
ブラウザ
  │  https（TLS は Cloudflare で終端）
  ▼
Cloudflare（DNS / Tunnel）
  │  A1 は公開 IP を持たないため、Tunnel で A1 の 80 番へ届ける
  ▼
A1: Traefik（coolify-proxy を流用 / entryPoint: http / 80 番）
  │  動的設定 /data/coolify/proxy/dynamic/rondo.yaml でホスト名ごとに振り分ける
  ├─ rondo.chapy0706.com         → http://rondo-app:3000     フロント（Next.js）
  ├─ ws-rondo.chapy0706.com      → http://rondo-ws:3000      リアルタイム基盤（Gleam / mist、/ws）
  └─ assets-rondo.chapy0706.com  → http://rondo-assets:3000  素材の配信（nginx、issue-43）
```

- 3つのコンテナは `coolify` ネットワーク（外部ネットワーク）に参加し、Traefik からコンテナ名で届く。ホストへのポート公開はしない
- コンテナ名は compose の `container_name` で **`rondo-app`**、**`rondo-ws`**、**`rondo-assets`** に固定している。再ビルドしても名前が変わらないので、Traefik の動的設定は一度書けば書き換えなくてよい
- Traefik のルーティングは、compose のラベルに頼らず、動的設定ファイルで行う（設定を1か所にまとめるため）

## ファイル

| ファイル | 役割 |
| --- | --- |
| `docker-compose.web.prod.yml` | フロントの本番構成。サービス・コンテナ名 `rondo-app`。リポジトリ直下を起点に `apps/web/Dockerfile` でビルド |
| `docker-compose.server.prod.yml` | リアルタイム基盤の本番構成。サービス・コンテナ名 `rondo-ws`。`server/` を起点に `server/Dockerfile` でビルド |
| `docker-compose.assets.prod.yml` | 素材の配信の本番構成。サービス・コンテナ名 `rondo-assets`。`deploy/assets/` を起点にビルドし、A1 の素材ディレクトリ（既定 `/srv/rondo-assets`）を読み取り専用でマウントする |
| `deploy/assets/` | 素材の配信の nginx（`Dockerfile` と設定の雛形 `default.conf.template`。CORS とキャッシュのヘッダ） |
| `docs/ops/traefik-rondo.yaml` | A1 の Traefik 動的設定の見本。`/data/coolify/proxy/dynamic/rondo.yaml` に置く内容 |
| `deploy/a1-deploy.sh` | A1 での更新のスクリプト。prod の確認、git pull、docker compose build、up -d、起動の確認を順に行う |
| `docs/ops/assets-manifest.example.json` | 素材の一覧（manifest.json）の例。素材そのものはリポジトリに入れない |
| `docker-compose.yml` | ローカルで2サービスを本番相当に起動して確かめる用（本番では使わない） |

## 運用

- ブランチは **prod** だけを本番に使う。prod へマージしても、自動では反映されない。A1 で `deploy/a1-deploy.sh` を実行して反映する（下の「更新の手順」）
- ビルド変数（`NEXT_PUBLIC_RONDO_WS_URL`、`NEXT_PUBLIC_ASSET_BASE_URL`）と、素材の配信の設定（`ASSET_ALLOWED_ORIGIN` など）は、A1 の、リポジトリの外の env ファイル（例: `~/rondo.env`）に書き、`--env-file` で渡す。このファイルはコミットしない
- 素材（glb など）はリポジトリに入れず、`rondo-assets` から配信する（ADR 0040）。フロントは、ビルド変数 `NEXT_PUBLIC_ASSET_BASE_URL` が未設定なら素材を読み込まず、仮の表示で動く。素材の配信が止まっても、仮の表示で続く
- フロントは既定でモック動作（サーバー不要）。リアルタイム基盤に実接続するときは、env ファイルの `NEXT_PUBLIC_RONDO_WS_URL` に `wss://ws-rondo.chapy0706.com/ws` を書いて、web を再ビルドする（issue-31）。`NEXT_PUBLIC_*` はビルド時に埋め込まれるため、設定を変えたら必ず再ビルドする

## env ファイル（A1。リポジトリの外）

A1 で、リポジトリの外に1つ置く（例: `~/rondo.env`。持ち主だけが読めるよう `chmod 600`）。コミットしない。

```
# 実接続しないなら空（モック動作）
NEXT_PUBLIC_RONDO_WS_URL=wss://ws-rondo.chapy0706.com/ws
# 素材を使わないなら空（仮の表示）
NEXT_PUBLIC_ASSET_BASE_URL=https://assets-rondo.chapy0706.com
# 素材の配信が CORS で許可するオリジン（省略時は https://rondo.chapy0706.com）
ASSET_ALLOWED_ORIGIN=https://rondo.chapy0706.com
```

- `NEXT_PUBLIC_RONDO_WS_URL` と `NEXT_PUBLIC_ASSET_BASE_URL` は、**2行とも必ず書く**。`deploy/a1-deploy.sh` は、web をビルドするとき、どちらかの行が無いか、値が空なら、止まって警告する（片方を忘れると、その機能が黙って止まるため）。わざと空にするときだけ、`--allow-empty` を付ける
- 値を変えたら、web を再ビルドする（`NEXT_PUBLIC_*` はビルド時にコードへ埋め込まれる）

## 更新の手順（通常）

A1 のリポジトリの作業コピーで実行する。

```bash
cd <A1 のリポジトリの作業コピー>
git switch prod
deploy/a1-deploy.sh --env-file ~/rondo.env web      # フロントだけ
deploy/a1-deploy.sh --env-file ~/rondo.env ws       # リアルタイム基盤だけ
deploy/a1-deploy.sh --env-file ~/rondo.env assets   # 素材の配信だけ
deploy/a1-deploy.sh --env-file ~/rondo.env all      # 3つとも（ws → assets → web の順）
```

- 対象は、引数の代わりに環境変数 `RONDO_DEPLOY_TARGET`、env ファイルは `RONDO_ENV_FILE` でも渡せる（引数が優先）
- スクリプトがすること: prod ブランチであることの確認、`git pull --ff-only`、`docker compose --env-file <env> -f <compose> build`、同じく `up -d`、コンテナが動いていることの確認。コンテナやボリュームを消す操作はしない
- スクリプトを使わずに手で行うときは、次と同じ（web の例。ws と assets は compose ファイルを替える）

  ```bash
  git switch prod && git pull --ff-only
  docker compose --env-file ~/rondo.env -f docker-compose.web.prod.yml build
  docker compose --env-file ~/rondo.env -f docker-compose.web.prod.yml up -d
  docker ps --filter name=rondo-app
  ```

  手で行うときは、2つの `NEXT_PUBLIC_*` が env ファイルにそろっているかを、自分で確かめる。シェルに同じ名前の環境変数が残っていると env ファイルより優先されるので、残っていないことも確かめる（`env | grep NEXT_PUBLIC`）

## 初回の起動手順（Coolify のアプリから、手動の docker compose へ。一度だけ行う人手作業）

順番どおりに行う。新しいコンテナを先に起こして中から確かめ、古いアプリを止めてから、振り分けを切り替える。途中で問題が出たら、g の戻し方で戻す。

**a. 作業コピーを用意する**

```bash
# まだ無ければ、A1 にリポジトリを取り出す（場所は任意。以後「作業コピー」と呼ぶ）
cd <A1 のリポジトリの作業コピー>
git switch prod && git pull
```

あわせて、上の「env ファイル」を A1 に用意する。いま本番の web に設定している `NEXT_PUBLIC_RONDO_WS_URL` の値（Coolify の画面で確かめる）を、そのまま写す。素材の配信をまだ用意していないなら、`NEXT_PUBLIC_ASSET_BASE_URL=`（空）にして、b で `--allow-empty` を付ける。

**b. 新しいコンテナを先に起動する（rondo-app、rondo-ws）。Host の振り分けは、まだ変えない**

先に、同じ名前のコンテナが無いことを確かめる（あれば、同じ名前では起動できないので、止まって確かめる）。

```bash
docker ps -a --format '{{.Names}}' | grep -E '^rondo-(app|ws)$'   # 何も出なければよい
```

```bash
deploy/a1-deploy.sh --env-file ~/rondo.env ws
deploy/a1-deploy.sh --env-file ~/rondo.env web
# 素材の配信をまだ用意していないとき: deploy/a1-deploy.sh --env-file ~/rondo.env --allow-empty web
```

手で行うときは、「更新の手順」の手のコマンドを、ws と web について実行する。新しいコンテナは Traefik のラベルを持たず、動的設定もまだ古い向き先のままなので、この時点では外からの要求は古いアプリに届き続ける。

**c. 内部の応答を確かめる**（Traefik のコンテナ `coolify-proxy` の中から、コンテナ名で叩く）

```bash
docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-app:3000/ 2>&1 | head -1
docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-ws:3000/ 2>&1 | head -1
# HTTP/1.1 200 OK が出れば応答している
```

返らない場合は、ここで止め、「うまく動かないときの切り分け」の 1・2 を見る。古いアプリは動いたままなので、利用者への影響はない。

**d. Coolify 側の古い rondo のアプリを止める**（同じドメインの振り分けが重ならないようにする）

- Coolify の画面で、rondo の web アプリと server アプリを、それぞれ **Stop** する。アプリは削除しない（g で戻すため）
- prod へのマージで古いアプリが勝手に起き直さないよう、各アプリの自動デプロイ（Auto Deploy）を切る
- 古いアプリのドメイン欄に rondo のホスト名が入っているなら、止めたことで Coolify の自動ラベルの振り分けも消える。止めたあと、A1 で古いコンテナが動いていないことを確かめる（`docker ps` に rondo の古いコンテナが出ないこと。`rondo-app` と `rondo-ws` は出てよい）

ここから f までの間は、外からの要求が 404 / 502 になる。e は続けてすぐ行う。

**e. 動的設定を書き換える**（書き換える前に、今のファイルを控える）

```bash
# 控えは、動的設定のディレクトリの外に置く（中に置くと、Traefik が設定として読むおそれがある）
sudo cp -p /data/coolify/proxy/dynamic/rondo.yaml ~/rondo.yaml.before-compose
# 見本で上書きする（作業コピーの docs/ops/traefik-rondo.yaml。末尾に空行が1つ残っていること）
sudo cp docs/ops/traefik-rondo.yaml /data/coolify/proxy/dynamic/rondo.yaml
docker logs --tail 20 coolify-proxy   # 読み込みのエラーが出ていないこと
```

Traefik は保存を検知して自動で読み直す。見本には `rondo-assets` の振り分けも入っている。素材の配信をまだ起こしていなければ、`assets-rondo` だけ 502 になるが、ほかには影響しない。

**f. 外から確かめる**

```bash
# A1 で（Traefik を通す。200 が返れば成功）
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: rondo.chapy0706.com" http://localhost:80
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: ws-rondo.chapy0706.com" http://localhost:80
```

最後に、手元のブラウザで `https://rondo.chapy0706.com` を開く。実接続しているなら、ルームに入れること（WebSocket が繋がること）も確かめる。

以後の更新では、コンテナ名が変わらないので、e の書き換えは不要。「更新の手順」だけを行う。

**g. 戻し方**（古い Coolify のアプリに戻す）

```bash
# 控えた動的設定に戻す
sudo cp -p ~/rondo.yaml.before-compose /data/coolify/proxy/dynamic/rondo.yaml
# 新しいコンテナは止めるだけにする（消さない）
docker compose -f docker-compose.web.prod.yml stop
docker compose -f docker-compose.server.prod.yml stop
```

そのあと、Coolify の画面で、古い web アプリと server アプリを **Start**（必要なら Redeploy）し、自動デプロイを元に戻す。f と同じ curl で 200 を確かめる。古いアプリのコンテナ名が変わっていた場合は、控えの動的設定の向き先が外れているので、新しい名前（`docker ps` で確かめる）に合わせて書き直す。

## 素材の配信の手順（issue-43。一度だけ行う人手作業）

順番どおりに行う。素材を使う機能（平屋 issue-46、キャラクター issue-25）ができる前でも、疎通の確認用の小さな glb（立方体）で確かめられる。

1. **A1 に素材ディレクトリを作る**

   ```bash
   sudo mkdir -p /srv/rondo-assets
   # 手元から rsync で書き込むユーザーを持ち主にする（<user> は A1 のログインユーザー）
   sudo chown <user>:<user> /srv/rondo-assets
   # コンテナの nginx が読めるよう、ディレクトリは 755、ファイルは 644 にする
   sudo chmod 755 /srv/rondo-assets
   ```

2. **rondo-assets を起動する**（A1 で、リポジトリの作業コピーから）

   ```bash
   cd <A1 のリポジトリの作業コピー>
   git switch prod
   deploy/a1-deploy.sh --env-file ~/rondo.env assets   # 最後に「rondo-assets は動いている」が出れば成功
   ```

   手で行うときは、次と同じ。

   ```bash
   git switch prod && git pull --ff-only
   docker compose --env-file ~/rondo.env -f docker-compose.assets.prod.yml build
   docker compose --env-file ~/rondo.env -f docker-compose.assets.prod.yml up -d
   docker ps --format '{{.Names}}' | grep rondo-assets   # rondo-assets が出れば成功
   ```

   - 環境変数は、compose ファイルの `${...}` に、env ファイル（または実行するシェルの環境変数）から入る。設定しなければ既定の値が使われる
     - `ASSET_ALLOWED_ORIGIN`: 素材を読み込んでよいアプリのオリジン（1つ）。既定は `https://rondo.chapy0706.com`
     - `ASSET_HOST_DIR`: A1 の素材ディレクトリ。既定は `/srv/rondo-assets`
   - 既定から変えるときは、env ファイル（リポジトリの外。コミットしない）に書く
   - 環境変数を変えたら、同じスクリプト（または `up -d`）を実行し直す（コンテナが作り直され、nginx の設定が起動時に作り直される）
   - `coolify` ネットワーク（外部ネットワーク）に参加するので、A1 の Traefik（`coolify-proxy`）からコンテナ名で届く

3. **Cloudflare Tunnel に公開ホスト名を追加する**（Cloudflare のダッシュボード、Zero Trust の Tunnel の設定）
   - Public hostname: **`assets-rondo.chapy0706.com`**
   - Service: ほかの2つ（`rondo` と `ws-rondo`）と同じく、**HTTP の `localhost:80`**（A1 の Traefik）

4. **Traefik の動的設定を置き直す**: A1 の **`/data/coolify/proxy/dynamic/rondo.yaml`** を、`docs/ops/traefik-rondo.yaml` の内容（`rondo-assets` の振り分けを足したもの）に書き換える。**ファイルの末尾に空行を1つ残す**

5. **Cloudflare のキャッシュのルールを作る**
   - Cloudflare は、拡張子でキャッシュするかを決め、既定の一覧に `.glb` は入っていない（JSON と HTML も既定ではキャッシュしない）。そのままだと glb は毎回 A1 まで取りに来る。キャッシュさせるには、Cache Rules でキャッシュの対象にする（公式ドキュメント: Default cache behavior、Cache Rules）
   - ダッシュボードの **Caching → Cache Rules → Create rule**
     - Rule name: `rondo-assets versioned glb`
     - When incoming requests match: **Custom filter expression**。`Hostname` equals `assets-rondo.chapy0706.com` **AND** `URI Path` starts with `/v`
     - Then: Cache eligibility は **Eligible for cache**
     - Edge TTL: **Use cache-control header if present, use default Cloudflare caching behavior if not**（rondo-assets が付ける `max-age=31536000` を使う）
     - Browser TTL: **Respect origin**
     - **Deploy**
   - `manifest.json` は、このルールに当てない（`/v` で始まらないので当たらない）。Cloudflare では既定どおりキャッシュされず、ブラウザが 60 秒だけ持つ
   - Cloudflare は既定で `Vary` を見ず、`Origin` をキャッシュの鍵に入れられるのは Enterprise だけ。そのため rondo-assets は、要求の `Origin` に関わらず、許可した1つのオリジンを `Access-Control-Allow-Origin` に返す（要求ごとに変えると、ほかのオリジン向けの応答が配られてしまう）

6. **素材をアップロードする**（手元から。素材は公開リポジトリに入れない）

   ```bash
   # 疎通の確認用の立方体と manifest.json を作る（assets-src/test/。コミットしない）
   node tools/make_test_glb.mjs assets-src/test
   # 先に glb（版付きのパス）を送り、最後に manifest.json を送る。manifest が、まだ届いていない
   # ファイルを指す時間を作らないため
   rsync -av --chmod=D755,F644 --exclude manifest.json assets-src/test/ <user>@<A1>:/srv/rondo-assets/
   rsync -av --chmod=F644 assets-src/test/manifest.json <user>@<A1>:/srv/rondo-assets/manifest.json
   ```

   ゲームの素材を送るときは、`docs/assets.md` の「素材の配信」の形（版付きのパスと manifest.json）に並べたフォルダを、同じように送る。中身を変えるときは、上書きせず、版を上げた新しいパス（`v2/...`）に置いて、manifest.json を書き換える

7. **確認する**

   まず A1 で、nginx の設定を検査する（起動時に雛形から作られた設定が、正しく読めるか）。

   ```bash
   docker exec rondo-assets nginx -t
   # 「syntax is ok」と「test is successful」が出れば通っている
   # 許可するオリジンが置き換わっているかも見る（${ASSET_ALLOWED_ORIGIN} のまま残っていないこと）
   docker exec rondo-assets grep Access-Control-Allow-Origin /etc/nginx/conf.d/default.conf
   ```

   次に、手元から確かめる。

   ```bash
   # manifest.json: 200、access-control-allow-origin が https://rondo.chapy0706.com、cache-control が max-age=60
   curl -sI -H "Origin: https://rondo.chapy0706.com" https://assets-rondo.chapy0706.com/manifest.json
   # glb: 200、content-type が model/gltf-binary、cache-control が max-age=31536000, immutable
   curl -sI -H "Origin: https://rondo.chapy0706.com" https://assets-rondo.chapy0706.com/v1/test/test-cube-512.glb
   # 同じ glb をもう一度取ると、cf-cache-status が HIT になる（5 のルールが効いている）
   curl -sI https://assets-rondo.chapy0706.com/v1/test/test-cube-512.glb | grep -i cf-cache-status
   # 無いファイルは 404 で、cache-control（immutable）が付かない
   curl -sI https://assets-rondo.chapy0706.com/v1/test/none.glb
   # 一覧は出さない（404）
   curl -sI https://assets-rondo.chapy0706.com/v1/
   ```

   ブラウザで `https://rondo.chapy0706.com` を開き、開発者ツールの Console で次を実行して 200 が出れば、アプリのオリジンから読める。ほかのオリジン（例: `https://example.com` を開いた Console）から同じことをすると、CORS で止まる。

   ```js
   await fetch("https://assets-rondo.chapy0706.com/v1/test/test-cube-512.glb").then((r) => r.status)
   ```

8. **素材を使うようにする**: web を、`NEXT_PUBLIC_ASSET_BASE_URL` を設定して再ビルドする（A1 で）。`NEXT_PUBLIC_*` はビルド時にコードへ埋め込まれるので、値を変えたら、必ず再ビルドしてコンテナを作り直す。素材を使う機能ができるまでは、設定しても見た目は変わらない

   env ファイルの `NEXT_PUBLIC_ASSET_BASE_URL` を `https://assets-rondo.chapy0706.com` にしてから、

   ```bash
   cd <A1 のリポジトリの作業コピー>
   deploy/a1-deploy.sh --env-file ~/rondo.env web
   ```

   手で行うときは、次と同じ。

   ```bash
   docker compose --env-file ~/rondo.env -f docker-compose.web.prod.yml build
   docker compose --env-file ~/rondo.env -f docker-compose.web.prod.yml up -d
   ```

   - **2つの変数は、毎回そろえて渡す**。片方が抜けると、その変数は空でビルドされる（例: `NEXT_PUBLIC_RONDO_WS_URL` が抜けると、実接続をやめてモック動作になる）。そのため、値はコマンドに書かず、env ファイルにまとめる。スクリプトは、片方が無いか空なら止まる
   - `docker compose ... build --build-arg NEXT_PUBLIC_ASSET_BASE_URL=...` でも渡せるが、渡さなかった変数は compose ファイルの既定（空）になるので、使わない
   - 埋め込まれた値は、ビルドしたコンテナの中の JavaScript に入る。確かめるには、ブラウザの開発者ツールの Network で、`manifest.json` を取りに行っているかを見る

**戻し方**:

- 素材を読み込まないようにする: env ファイルの `NEXT_PUBLIC_ASSET_BASE_URL` を空にして（`NEXT_PUBLIC_RONDO_WS_URL` は今の値のまま）、`deploy/a1-deploy.sh --env-file ~/rondo.env --allow-empty web` を実行する。素材を読み込まず、仮の表示に戻る
- 素材の配信だけを止める: `docker compose -f docker-compose.assets.prod.yml stop`。web はそのままでも、読み込みが失敗して仮の表示で続く（利用者に警告は出ない）

## うまく動かないときの切り分け

外側から疑わず、内側から順に確かめる。

1. **コンテナ**: 起きているか

   ```bash
   docker ps --filter name=rondo
   docker logs --tail 100 rondo-app
   docker logs --tail 100 rondo-ws
   docker logs --tail 100 rondo-assets
   ```

   出ない場合は、作業コピーで `deploy/a1-deploy.sh` を実行し直し、ビルドや起動のエラーを見る。compose ファイルの構文は `docker compose --env-file ~/rondo.env -f docker-compose.web.prod.yml config > /dev/null` で確かめられる（エラーが出なければ通っている）。Coolify の古いアプリが同じホスト名を振り分けていないか（止まっているか）も確かめる。

2. **内部応答**: `coolify` ネットワークの中から、コンテナ名で応答が返るか（Traefik のコンテナ `coolify-proxy` から叩く）

   ```bash
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-app:3000/ 2>&1 | head -1
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-ws:3000/ 2>&1 | head -1
   # HTTP/1.1 200 OK が出れば応答している
   ```

   返らない場合は、コンテナが `coolify` ネットワークに参加しているかを確かめる（`docker inspect rondo-app --format '{{json .NetworkSettings.Networks}}'`）。

3. **Traefik**: ホスト名で振り分けられるか（初回の起動手順 f の curl）。404 の場合は動的設定のホスト名・ファイル名・末尾の空行を、502 の場合は動的設定の向き先（コンテナ名・ポート 3000）を確かめる。読み込みエラーは `docker logs --tail 100 coolify-proxy` に出る
4. **外部**: ブラウザや手元から `https://rondo.chapy0706.com` を開く。ここだけ失敗する場合は、Cloudflare Tunnel の状態と、Cloudflare 側の公開ホスト名の設定を確かめる
