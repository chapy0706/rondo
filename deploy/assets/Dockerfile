# rondo の素材配信（rondo-assets）のイメージ（issue-43 / ADR 0040）。
#
# 公式 nginx イメージに、設定の雛形（default.conf.template）だけを入れる。素材そのものは
# イメージに入れず、ホストの素材ディレクトリを /srv/assets に読み取り専用でマウントする
# （docker-compose.assets.prod.yml）。素材は公開リポジトリに入れない。
FROM nginx:1.27-alpine

# 雛形の ${ASSET_ALLOWED_ORIGIN} は、起動時に環境変数の値で置き換わる。
COPY default.conf.template /etc/nginx/templates/default.conf.template

# 未設定のときは本番のアプリのオリジンを許可する。
ENV ASSET_ALLOWED_ORIGIN=https://rondo.chapy0706.com
