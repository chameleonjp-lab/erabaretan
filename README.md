# 選ばれたん

約7分で、相手を倒すか世界を守るかを迫られ、最後に神から戦い方そのものを査定される対戦カードゲームです。

**戦闘に勝っても、神に選ばれるとは限りません。**

プレイヤーは神から一時的な権能を与えられた守護者候補です。強力なカードは相手だけでなく世界も傷つけます。世界を回復する行動は評価されますが、体力、手札、攻撃機会などを支払います。

結果では、最後まで生存した「戦闘勝者」と、生存、世界損傷、世界再生を合わせて決まる「神の選定者」を分けて表示します。

## 現行計画

最初に[現行計画の参照順](docs/00_CURRENT_PLAN.md)を確認してください。

### 商品とゲーム体験

- [ゲーム・商品計画書 V2](docs/04_GAME_PRODUCT_PLAN_V2.md)

### ルールと技術

- [技術設計・実装計画 V3](docs/07_TECHNICAL_ARCHITECTURE_V3.md)
- [ルールエンジン契約](docs/08_RULE_ENGINE_CONTRACT.md)
- [実装・検証・公開計画書 V2](docs/05_IMPLEMENTATION_AND_RELEASE_PLAN_V2.md)
- [初期12種類カード仕様 V1](docs/16_INITIAL_12_CARD_SPEC_V1.md)
- [ruleset alpha-12 と砕けゆく原初界 V1](docs/17_RULESET_ALPHA_12_V1.md)
- [alpha-12 Fixture仕様 V1](docs/18_FIXTURES_ALPHA_12_V1.md)
- [共通効果命令の正式型 V1](docs/19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)
- [決定的乱数生成器と固定試験値 V1](docs/20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)
- [ゴールデン試合と最終状態ハッシュ V1](docs/21_GOLDEN_MATCHES_AND_STATE_HASHES_V1.md)
- [game-core state / command基盤 V1](docs/22_GAME_CORE_STATE_AND_COMMAND_BASE_V1.md)
- [game-core effects / PAY_HP V1](docs/23_GAME_CORE_EFFECTS_PAY_HP_V1.md)
- [game-core world boundaries / terminal / scoring V1](docs/24_GAME_CORE_WORLD_BOUNDARIES_TERMINAL_V1.md)
- [game-core RNG / replay / state hash V1](docs/25_GAME_CORE_RNG_REPLAY_HASH_V1.md)

### レビュー

- [ゲームエンジニアレビュー](docs/06_GAME_ENGINEERING_REVIEW.md)
- [ゲームプロデューサーレビュー](docs/03_PRODUCER_REVIEW.md)

## 旧版

初期検討の経緯として保持しています。内容が現行文書と食い違う場合は、現行文書を採用します。

- [ゲーム企画・アイデア設計書 V1](docs/01_GAME_CONCEPT_AND_DESIGN.md)
- [実装計画書 V1](docs/02_IMPLEMENTATION_PLAN.md)

## 現在の段階

P1-04の決定性基盤実装段階（P0-06ハッシュ整合の訂正作業を残す）です。

P0-01として、[初期12種類カード仕様 V1](docs/16_INITIAL_12_CARD_SPEC_V1.md)を作成しました。カードの最終バランスではなく、12種類で中心体験を検証するための正本です。

P0-02として、[ruleset alpha-12 と砕けゆく原初界 V1](docs/17_RULESET_ALPHA_12_V1.md)を作成しました。世界律、世界境界、実効損傷・再生、初期採点値を固定する正本です。

P0-03として、[alpha-12 Fixture仕様 V1](docs/18_FIXTURES_ALPHA_12_V1.md)を作成しました。通常例6件と敵対的例14件の初期状態、操作、期待結果を固定する正本です。

P0-04として、[共通効果命令の正式型 V1](docs/19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)を作成しました。効果命令16種類の入力型、結果型、責任、拒否条件、初期12種類への展開を固定する正本です。

P0-05として、[決定的乱数生成器と固定試験値 V1](docs/20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)を作成しました。乱数の版、種、山札シャッフル、初期配布、先攻決定、固定試験値を固定する正本です。

P0-06として、[ゴールデン試合と最終状態ハッシュ V1](docs/21_GOLDEN_MATCHES_AND_STATE_HASHES_V1.md)を作成しました。通常撃破、世界崩壊、反射を含む同時終了の3ケースと、SHA-256による最終状態ハッシュを固定する正本です。

P1-01として、[game-core state / command基盤 V1](docs/22_GAME_CORE_STATE_AND_COMMAND_BASE_V1.md)を実装しました。画面・通信・保存・時刻・乱数に依存しないGameState、7種類のcommand型、validation、revision、再送防止、基礎状態遷移を固定しています。

P1-02として、[game-core effects / PAY_HP V1](docs/23_GAME_CORE_EFFECTS_PAY_HP_V1.md)を実装しました。16種類の効果命令、原子的な効果キュー、盾・反射・世界耐久の基礎処理、`PAY_HP`、初期12枚の効果ビルダーを固定しています。

P1-03として、[game-core world boundaries / terminal / scoring V1](docs/24_GAME_CORE_WORLD_BOUNDARIES_TERMINAL_V1.md)を実装しました。世界境界、フィールド自動効果、カード条件、終了判定、採点を固定し、P1-03関連のgame-core試験を通しました。

P1-04として、[game-core RNG / replay / state hash V1](docs/25_GAME_CORE_RNG_REPLAY_HASH_V1.md)を実装しました。決定的乱数、初期配札、状態ハッシュ、本番相当の受理command列再生、G01〜G03の現行正規化JSON・イベント・revision・乱数消費数をmanifest fixtureへ固定し、56件の試験とTypeScript型検査を通しました。P0-06旧ハッシュ値との整合は、生成元JSONが未保存のため別の訂正作業として残しています。

ゲームエンジニアレビューにより、次を初期ルールとして固定しました。

- カード補充は手番開始時
- 先攻は最初の補充を行わない
- 初期手札7枚、手札上限9枚
- 一つの攻撃への防御・反応は最大1枚
- 反射への再反射は入れない
- 世界境界を複数越えた場合の処理順
- 同時死亡、世界0、最大ラウンド、降参、切断の扱い
- 決定的な乱数、リプレイ、秘密情報、ルール版固定の方針

P0-01、P0-02、P0-03、P0-04、P0-05、P0-06、P1-01、P1-02、P1-03、P1-04の決定性基盤実装は完了しました。P0-06旧ハッシュ値との整合は未解決の契約差分として別作業に切り出しています。次の実装作業は次のとおりです。

1. P1-04b：P0-06ゴールデン入力JSON・revision別ハッシュ・イベント列の訂正
2. P1-05：projection / preview / summary

P1-04までの決定性とハッシュ境界を維持しながら、閲覧者ごとの公開状態投影、preview、結果summaryを純粋な処理へ追加します。

通信機能からは作りません。面白さ、採点の納得感、決定的な再現性を確認した後、24種類のオフライン試作、36種類の完成品質確認版、合言葉オンライン対戦、48種類の限定公開版へ進みます。
