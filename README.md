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
- [game-core projection / preview / summary V1](docs/26_GAME_CORE_PROJECTION_PREVIEW_SUMMARY_V1.md)
- [game-core invariant / secrecy tests V1](docs/27_GAME_CORE_INVARIANT_SECRECY_TESTS_V1.md)
- [game-core battle shell V1](docs/28_GAME_CORE_BATTLE_SHELL_V1.md)
- [battle hand / action UX V1](docs/29_BATTLE_HAND_ACTION_UX_V1.md)
- [battle world preview / judgment hint V1](docs/30_BATTLE_WORLD_PREVIEW_JUDGMENT_HINT_V1.md)
- [result judgment / summary V1](docs/31_RESULT_JUDGMENT_SUMMARY_V1.md)

### レビュー

- [ゲームエンジニアレビュー](docs/06_GAME_ENGINEERING_REVIEW.md)
- [ゲームプロデューサーレビュー](docs/03_PRODUCER_REVIEW.md)

## 旧版

初期検討の経緯として保持しています。内容が現行文書と食い違う場合は、現行文書を採用します。

- [ゲーム企画・アイデア設計書 V1](docs/01_GAME_CONCEPT_AND_DESIGN.md)
- [実装計画書 V1](docs/02_IMPLEMENTATION_PLAN.md)

## 現在の段階

P3-04の結果審定・転換点要約を実装し、自動検証を完了した段階です。実ブラウザ・iPhone実機の手動確認は未実施です。

P0-01として、[初期12種類カード仕様 V1](docs/16_INITIAL_12_CARD_SPEC_V1.md)を作成しました。カードの最終バランスではなく、12種類で中心体験を検証するための正本です。

P0-02として、[ruleset alpha-12 と砕けゆく原初界 V1](docs/17_RULESET_ALPHA_12_V1.md)を作成しました。世界律、世界境界、実効損傷・再生、初期採点値を固定する正本です。

P0-03として、[alpha-12 Fixture仕様 V1](docs/18_FIXTURES_ALPHA_12_V1.md)を作成しました。通常例6件と敵対的例14件の初期状態、操作、期待結果を固定する正本です。

P0-04として、[共通効果命令の正式型 V1](docs/19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)を作成しました。効果命令16種類の入力型、結果型、責任、拒否条件、初期12種類への展開を固定する正本です。

P0-05として、[決定的乱数生成器と固定試験値 V1](docs/20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)を作成しました。乱数の版、種、山札シャッフル、初期配布、先攻決定、固定試験値を固定する正本です。

P0-06として、[ゴールデン試合と最終状態ハッシュ V1](docs/21_GOLDEN_MATCHES_AND_STATE_HASHES_V1.md)を作成しました。通常撃破、世界崩壊、反射を含む同時終了の3ケースと、SHA-256による最終状態ハッシュを固定する正本です。

P1-01として、[game-core state / command基盤 V1](docs/22_GAME_CORE_STATE_AND_COMMAND_BASE_V1.md)を実装しました。画面・通信・保存・時刻・乱数に依存しないGameState、7種類のcommand型、validation、revision、再送防止、基礎状態遷移を固定しています。

P1-02として、[game-core effects / PAY_HP V1](docs/23_GAME_CORE_EFFECTS_PAY_HP_V1.md)を実装しました。16種類の効果命令、原子的な効果キュー、盾・反射・世界耐久の基礎処理、`PAY_HP`、初期12枚の効果ビルダーを固定しています。

P1-03として、[game-core world boundaries / terminal / scoring V1](docs/24_GAME_CORE_WORLD_BOUNDARIES_TERMINAL_V1.md)を実装しました。世界境界、フィールド自動効果、カード条件、終了判定、採点を固定し、P1-03関連のgame-core試験を通しました。

P1-04として、[game-core RNG / replay / state hash V1](docs/25_GAME_CORE_RNG_REPLAY_HASH_V1.md)を実装しました。決定的乱数、初期配札、状態ハッシュ、本番相当の受理command列再生、G01〜G03の現行正規化JSON・イベント・revision・乱数消費数をmanifest fixtureへ固定し、56件の試験とTypeScript型検査を通しました。P0-06は、旧値を履歴欄へ隔離したうえで、現行manifestと実装境界を正本へ反映する訂正を完了しました。

P1-05として、[game-core projection / preview / summary V1](docs/26_GAME_CORE_PROJECTION_PREVIEW_SUMMARY_V1.md)を実装しました。閲覧者ごとの手札公開境界、安全な公開zone、production executorを使う純粋なpreview、正常・非正常終了のsummaryを追加し、既存のstate hashとP1-04の決定性を維持しました。秘密情報差分、preview純粋性、拒否コード正規化、結果summaryの検査を追加しました。

ゲームエンジニアレビューにより、次を初期ルールとして固定しました。

- カード補充は手番開始時
- 先攻は最初の補充を行わない
- 初期手札7枚、手札上限9枚
- 一つの攻撃への防御・反応は最大1枚
- 反射への再反射は入れない
- 世界境界を複数越えた場合の処理順
- 同時死亡、世界0、最大ラウンド、降参、切断の扱い
- 決定的な乱数、リプレイ、秘密情報、ルール版固定の方針

P0-01、P0-02、P0-03、P0-04、P0-05、P0-06、P1-01、P1-02、P1-03、P1-04、P1-04b、P1-05、P2-01、P2-02、P2-03、P3-01、P3-02、P3-03、P3-04の実装は完了しました。P0-06の現行golden値、実行境界、manifest付属データを正本へ反映し、旧値は履歴として隔離しています。

P1-04bまでの決定性とハッシュ境界を維持したまま、P1-05で公開状態投影・preview・結果summaryを追加し、P2-01でFixture A〜F、P2-02で敵対的Fixture X01〜X14、P2-03で不変条件・秘密情報試験を自動化しました。P3-01では同一端末のbattle shell、端末受け渡し、カード破棄、応答、結果表示、再戦を追加しました。P3-02ではカード説明、行動ごとの効果表示、世界損傷7の解放確認、使えない行動の無効化を追加しました。次は実ブラウザ・iPhone縦画面の確認後にP4-01へ進みます。

P2-02では、X01〜X14の境界再通過、複数境界、世界崩壊、同率責任、山札切れ、盾、フィールド上書き、重複命令、不正入力を契約試験へ固定しました。P2-03では不変条件、効果キュー上限、初期12種類全modeの合法性、公開状態、応答待ち、preview、結果summaryの秘密情報境界を固定しました。手札・山札・解決中カードを公開履歴へ混入できないこと、実ドローpreviewが山札順を漏らさないことも確認しています。P2-03時点で全96件の試験と型検査が通過し、Sol・Highの独立レビューを完了しています。P3-01では型検査、静的Webビルド、全102件の試験が通過し、Sol・Highの再レビューもAPPROVEとなりました。P3-02では全104件の試験が通過し、Sol・Highの再レビューもAPPROVEとなりました。P3-03では全106件の試験が通過し、Sol・Highの独立再レビューもAPPROVEとなりました。

通信機能からは作りません。面白さ、採点の納得感、決定的な再現性を確認した後、24種類のオフライン試作、36種類の完成品質確認版、合言葉オンライン対戦、48種類の限定公開版へ進みます。


P3-04として、[結果審定・転換点要約 V1](docs/31_RESULT_JUDGMENT_SUMMARY_V1.md)を追加しました。正式な`summarizeMatch`結果を使った終了理由・評価内訳・神の選定を表示し、公開可能なイベントから同一行動の重複を避けて最大3件の転換点を抽出します。手札、山札順、カードID、seed、command履歴は結果要約へ渡しません。P3-04専用試験を含め、全111件が成功しています。実ブラウザ・iPhone実機の手動確認は未実施です。
