# ADR 0009: 契約は TypeScript を中心に置く

- ステータス: 受理
- 日付: 2026-06-24

## 文脈

フロントエンドは TypeScript、リアルタイム基盤は Gleam という異なる言語で実装される。両者の間でやり取りするメッセージやマニフェストの型を、どちらの言語を正として管理するかを決める必要がある。

## 決定

契約（contracts）は TypeScript を正とする。Game / SoloGame / RealtimeGame インターフェース、GameManifest、メッセージ型、結果型を TypeScript で定義し、Gleam 側の protocol をそれに対応させる。

## 理由

- ゲーム実装とフロントは TypeScript であり、契約に触れる箇所が圧倒的に多い
- 契約を1箇所に正として置くことで、二重定義による不整合を避ける
- Gleam 側はリアルタイムのメッセージという限られた範囲だけ対応すればよい

## 検討した代替案

- Gleam を契約の正とする案。契約を参照する大半のコードが TypeScript であるため、参照側から遠くなり却下した
- 両言語で対等に二重管理する案。不整合の温床になるため却下した

## 結果

- packages/contracts に TypeScript で契約を定義する
- Gleam 側は protocol/message.gleam を contracts に手動で対応させ、対応関係をテストで守る
