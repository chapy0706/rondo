# デプロイ手順（本番）

rondo の本番は、A1 上の Coolify が Docker Compose でビルド・起動し、Cloudflare Tunnel を通じて公開する。staging は廃止し、prod 一本で運用する（issue-35）。

## 構成

```
ブラウザ
  │  https（TLS は Cloudflare で終端）
  ▼
Cloudflare（DNS / Tunnel）
  │  A1 は公開 IP を持たないため、Tunnel で A1 の 80 番へ届ける
  ▼
A1: Traefik（Coolify のプロキシ / entryPoint: http / 80 番）
  │  動的設定 /data/coolify/proxy/dynamic/rondo.yaml でホスト名ごとに振り分ける
  ├─ rondo.chapy0706.com         → http://rondo-app:3000     フロント（Next.js）
  ├─ ws-rondo.chapy0706.com      → http://rondo-ws:3000      リアルタイム基盤（Gleam / mist、/ws）
  └─ assets-rondo.chapy0706.com  → http://rondo-assets:3000  素材の配信（nginx、issue-43）
```

- 2つのコンテナは `coolify` ネットワーク（外部ネットワーク）に参加し、Traefik からコンテナ名で届く。ホストへのポート公開はしない
- コンテナ名は compose の `container_name` で **`rondo-app`** と **`rondo-ws`** に固定している。再デプロイしても名前が変わらないので、Traefik の動的設定は一度書けば書き換えなくてよい
- Traefik のルーティングは、compose のラベルや Coolify の自動ラベルに頼らず、動的設定ファイルで行う（Coolify の自動ラベルは Host が空になって壊れることがあるため）

## ファイル

| ファイル | 役割 |
| --- | --- |
| `docker-compose.web.prod.yml` | フロントの本番構成。サービス・コンテナ名 `rondo-app`。リポジトリ直下を起点に `apps/web/Dockerfile` でビルド |
| `docker-compose.server.prod.yml` | リアルタイム基盤の本番構成。サービス・コンテナ名 `rondo-ws`。`server/` を起点に `server/Dockerfile` でビルド |
| `docker-compose.assets.prod.yml` | 素材の配信の本番構成。サービス・コンテナ名 `rondo-assets`。`deploy/assets/` を起点にビルドし、A1 の素材ディレクトリ（既定 `/srv/rondo-assets`）を読み取り専用でマウントする |
| `deploy/assets/` | 素材の配信の nginx（`Dockerfile` と設定の雛形 `default.conf.template`。CORS とキャッシュのヘッダ） |
| `docs/ops/traefik-rondo.yaml` | A1 の Traefik 動的設定の見本。`/data/coolify/proxy/dynamic/rondo.yaml` に置く内容 |
| `docs/ops/assets-manifest.example.json` | 素材の一覧（manifest.json）の例。素材そのものはリポジトリに入れない |
| `docker-compose.yml` | ローカルで2サービスを本番相当に起動して確かめる用（本番では使わない） |

## 運用

- ブランチは **prod** だけを本番に使う。prod へマージすると、Coolify が2つのアプリを再ビルドする
- 素材（glb など）はリポジトリに入れず、`rondo-assets` から配信する（ADR 0040）。フロントは、ビルド変数 `NEXT_PUBLIC_ASSET_BASE_URL` が未設定なら素材を読み込まず、仮の表示で動く。素材の配信が止まっても、仮の表示で続く
- フロントは既定でモック動作（サーバー不要）。リアルタイム基盤に実接続するときは、web のビルド変数 `NEXT_PUBLIC_RONDO_WS_URL` に `wss://ws-rondo.chapy0706.com/ws` を設定して再デプロイする（issue-31）。`NEXT_PUBLIC_*` はビルド時に埋め込まれるため、設定を変えたら必ず再ビルドする

## Docker Compose 方式への切り替え手順（一度だけ行う人手作業）

順番どおりに行う。

1. **web アプリを compose 方式にする（Coolify）**
   - Build Pack: **Docker Compose**
   - Docker Compose Location: **`/docker-compose.web.prod.yml`**
   - Branch: **prod**
   - ビルド変数 `NEXT_PUBLIC_RONDO_WS_URL`: 実接続に切り替えるまでは未設定のままでよい
   - ドメイン欄: **空にする**（ルーティングは Traefik の動的設定で行う）
2. **server アプリを compose 方式にする（Coolify）**
   - 1 と同様に、Docker Compose Location を **`/docker-compose.server.prod.yml`** にする（Branch は prod、ドメイン欄は空）
3. 既存アプリの Build Pack を切り替えられない場合は、上の設定で新しいアプリを作り直す（古いアプリは、新しいほうの動作を確かめてから止める）
4. 再ビルド後、A1 でコンテナ名を確認する

   ```bash
   docker ps --format '{{.Names}}' | grep rondo
   # rondo-app と rondo-ws が出れば成功
   ```

   compose ファイルの構文は、A1 のリポジトリの作業コピーで次のように確かめられる（エラーが出なければ通っている）。

   ```bash
   docker compose -f docker-compose.web.prod.yml config > /dev/null
   docker compose -f docker-compose.server.prod.yml config > /dev/null
   ```

5. A1 の **`/data/coolify/proxy/dynamic/rondo.yaml`** を、`docs/ops/traefik-rondo.yaml` の内容（固定した名前 `rondo-app` / `rondo-ws` を向いたもの）に一度だけ書き換える。**ファイルの末尾に空行を1つ残す**。Traefik は保存を検知して自動で読み直す
6. 疎通を確認する（200 が返れば成功）

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -H "Host: rondo.chapy0706.com" http://localhost:80
   curl -s -o /dev/null -w "%{http_code}\n" -H "Host: ws-rondo.chapy0706.com" http://localhost:80
   ```

以後の再デプロイでは、コンテナ名が変わらないので、5 の書き換えは不要。

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

2. **rondo-assets を起動する**（A1 で、リポジトリの作業コピーから docker compose を直接実行する）

   ```bash
   cd <A1 のリポジトリの作業コピー>
   git switch prod && git pull
   docker compose -f docker-compose.assets.prod.yml up -d --build
   docker ps --format '{{.Names}}' | grep rondo-assets   # rondo-assets が出れば成功
   ```

   - 環境変数は、compose ファイルの `${...}` に、実行するシェルの環境変数から入る。設定しなければ既定の値が使われる
     - `ASSET_ALLOWED_ORIGIN`: 素材を読み込んでよいアプリのオリジン（1つ）。既定は `https://rondo.chapy0706.com`
     - `ASSET_HOST_DIR`: A1 の素材ディレクトリ。既定は `/srv/rondo-assets`
   - 既定から変えるときは、コマンドの前に付ける（例: `ASSET_ALLOWED_ORIGIN=https://rondo.chapy0706.com docker compose -f docker-compose.assets.prod.yml up -d --build`）。`--env-file <ファイル>` で、リポジトリの外に置いたファイルから渡してもよい（そのファイルはコミットしない）
   - 環境変数を変えたら、同じ `up -d` を実行し直す（コンテナが作り直され、nginx の設定が起動時に作り直される）
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

   ```bash
   cd <A1 のリポジトリの作業コピー>
   NEXT_PUBLIC_RONDO_WS_URL=<いまの値> \
   NEXT_PUBLIC_ASSET_BASE_URL=https://assets-rondo.chapy0706.com \
     docker compose -f docker-compose.web.prod.yml build
   docker compose -f docker-compose.web.prod.yml up -d
   ```

   - **2つの変数は、毎回そろえて渡す**。片方を書き忘れると、その変数は空でビルドされる（例: `NEXT_PUBLIC_RONDO_WS_URL` を忘れると、実接続をやめてモック動作になる）。いまの値は、ここに書かず、各自の手元の控え（リポジトリの外）で管理する。実接続しているなら `wss://ws-rondo.chapy0706.com/ws`、していないなら空
   - 取り違えを防ぐには、2つの変数を書いたファイルをリポジトリの外に置き、`docker compose --env-file <ファイル> -f docker-compose.web.prod.yml build` で渡す（そのファイルはコミットしない）
   - `docker compose ... build --build-arg NEXT_PUBLIC_ASSET_BASE_URL=...` でも渡せるが、渡さなかった変数は compose ファイルの既定（空）になるので、同じく両方を渡す
   - 埋め込まれた値は、ビルドしたコンテナの中の JavaScript に入る。確かめるには、ブラウザの開発者ツールの Network で、`manifest.json` を取りに行っているかを見る

**戻し方**:

- 素材を読み込まないようにする: `NEXT_PUBLIC_ASSET_BASE_URL` を空にして（`NEXT_PUBLIC_RONDO_WS_URL` は今の値のまま）、手順 8 と同じく web を再ビルドし、`up -d` する。素材を読み込まず、仮の表示に戻る
- 素材の配信だけを止める: `docker compose -f docker-compose.assets.prod.yml down`。web はそのままでも、読み込みが失敗して仮の表示で続く（利用者に警告は出ない）

## うまく動かないときの切り分け

外側から疑わず、内側から順に確かめる。

1. **コンテナ**: 2つとも起きているか

   ```bash
   docker ps --filter name=rondo
   docker logs --tail 100 rondo-app
   docker logs --tail 100 rondo-ws
   ```

   名前が `rondo-app` / `rondo-ws` でない場合は、Coolify の Build Pack と Docker Compose Location を見直す。

2. **内部応答**: `coolify` ネットワークの中から、コンテナ名で応答が返るか（Traefik のコンテナ `coolify-proxy` から叩く）

   ```bash
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-app:3000/ 2>&1 | head -1
   docker exec coolify-proxy wget -q -S -O /dev/null http://rondo-ws:3000/ 2>&1 | head -1
   # HTTP/1.1 200 OK が出れば応答している
   ```

   返らない場合は、コンテナが `coolify` ネットワークに参加しているかを確かめる（`docker inspect rondo-app --format '{{json .NetworkSettings.Networks}}'`）。

3. **Traefik**: ホスト名で振り分けられるか（手順 6 の curl）。404 の場合は動的設定のホスト名・ファイル名・末尾の空行を、502 の場合は動的設定の向き先（コンテナ名・ポート 3000）を確かめる。読み込みエラーは `docker logs --tail 100 coolify-proxy` に出る
4. **外部**: ブラウザや手元から `https://rondo.chapy0706.com` を開く。ここだけ失敗する場合は、Cloudflare Tunnel の状態と、Cloudflare 側の公開ホスト名の設定を確かめる
