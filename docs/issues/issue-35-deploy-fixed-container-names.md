---
status: open
created_at: 2026-10-01
closed_at:
---

# issue-35: デプロイ構成の固定化（Docker Compose とコンテナ名の固定）

## 背景

現在の本番デプロイは、Coolify に Dockerfile を直接指定する形で、コンテナ名が再デプロイのたびに変わる。名前が変わるたびに、A1 の Traefik 動的設定（コンテナ名を直接書いたもの）が外れて 502 になる。発表まで何度も本番へ出す予定のため、先にこの手間をなくす。

A1 のデプロイ指針書（playbook）の鉄則に従い、Docker Compose で `container_name` を固定する。rondo は Coolify のアプリにせず、A1 のリポジトリの作業コピーで docker compose を手で実行して起動する（Coolify 自体は動き続け、プロキシ `coolify-proxy`・`coolify` ネットワーク・動的設定のディレクトリだけを使う）。あわせて、staging を廃止して prod 一本にした運用を、手順書へ反映する。

## スコープ

### このissueでやること（リポジトリ内）

- `docker-compose.web.prod.yml` を作る
  - サービス `rondo-app`、`container_name: rondo-app`
  - ビルドは、リポジトリ直下を起点に `apps/web/Dockerfile`
  - ビルド引数 `NEXT_PUBLIC_RONDO_WS_URL` を受け取れる（未設定ならモック動作のまま）
  - `coolify` ネットワーク（外部ネットワーク）に参加、待ち受けポートは 3000、`restart: unless-stopped`
- `docker-compose.server.prod.yml` を作る
  - サービス `rondo-ws`、`container_name: rondo-ws`
  - ビルドは `server/` を起点に `server/Dockerfile`
  - 同じネットワーク、ポート 3000、`restart: unless-stopped`
- Traefik のルーティングは、compose のラベルに頼らず、動的設定ファイルで行う（設定を1か所にまとめるため）。設定の見本を `docs/ops/traefik-rondo.yaml` として置く（`rondo.chapy0706.com` → `http://rondo-app:3000`、`ws-rondo.chapy0706.com` → `http://rondo-ws:3000`）
- `docs/deploy.md` を更新する
  - staging 廃止、prod 一本の運用に直す
  - Docker Compose 方式と、固定したコンテナ名
  - A1 での初回の起動手順と、通常の更新の手順（下の「人手作業」）
  - 切り分けの順（コンテナ → 内部応答 → Traefik → 外部）

### このissueでやらないこと

- アプリのコードの変更
- Coolify の古いアプリの停止、A1・Cloudflare の設定変更（人手作業。手順を手順書に書く）

## 人手作業（手順書に書く内容）

`docs/deploy.md` の「初回の起動手順」に、次の順で書く。

1. A1 にリポジトリの作業コピーを用意し、`git switch prod && git pull` する。ビルド変数を書いた env ファイルを、リポジトリの外に用意する（いまの `NEXT_PUBLIC_RONDO_WS_URL` の値を写す）
2. Host の振り分けは変えずに、新しいコンテナ `rondo-app` と `rondo-ws` を先に起動する（`deploy/a1-deploy.sh`、または docker compose の build と up -d）
3. `coolify-proxy` の中から `wget` で、コンテナ名で内部の応答を確かめる
4. Coolify 側の古い rondo のアプリ（web・server）を止める（削除はしない。自動デプロイも切る）。同じドメインの振り分けが重ならないようにするため
5. `/data/coolify/proxy/dynamic/rondo.yaml` を控えてから、固定した名前に一度だけ書き換える（末尾の空行を忘れない）
6. `curl -s -o /dev/null -w "%{http_code}\n" -H "Host: rondo.chapy0706.com" http://localhost:80` と、ブラウザで、外から確かめる
7. 戻し方: 控えた動的設定に戻し、新しいコンテナを止め、古い Coolify のアプリを起動し直す

## 受け入れ条件

- 2つの compose ファイルが存在し、`docker compose -f ... config` で構文が通る
- コンテナ名が `rondo-app`、`rondo-ws` に固定されている
- `docs/deploy.md` が、現在の運用（prod 一本、compose、固定名、手順）と一致している
- アプリのコードに変更がない
- `make verify` が通る

## 段階

1. 既存の `apps/web/Dockerfile`、`server/Dockerfile`、`docker-compose.yml`（ローカル確認用）を読む
2. compose ファイル2本を作る
3. Traefik 設定の見本を置く
4. `docs/deploy.md` を更新する

## 関連

- 参考: A1 アプリデプロイ指針書（playbook）の鉄則 3・5
- 先行: issue-15
- 関連: issue-31（実接続に切り替える時に、web のビルド変数を設定し直す）
