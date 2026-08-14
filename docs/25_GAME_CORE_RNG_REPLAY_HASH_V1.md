# エラバレタン：P1-04 game-core 乱数・リプレイ・状態ハッシュ実装記録 V1

- 文書状態：P1-04 実装記録
- 更新日：2026-08-15
- 対象rulesetId：`ruleset.alpha-12.v1`
- 関連正本：[決定的乱数生成器と固定試験値 V1](20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)
- 関連正本：[ゴールデン試合と最終状態ハッシュ V1](21_GOLDEN_MATCHES_AND_STATE_HASHES_V1.md)
- 関連実装：[P1-03 世界境界・終端・採点](24_GAME_CORE_WORLD_BOUNDARIES_TERMINAL_V1.md)

## 1. 実装範囲

P1-04では、画面、通信、保存先へ依存しない決定性の基礎を追加した。

- `rng.xoshiro128ss.v1`
- `shuffle.fisher-yates-desc.v1`
- 初期12種類の36枚生成、シャッフル、交互配札、先攻抽選
- `state-hash.alpha-12.v1`の正規化とSHA-256
- 受理済みcommand列の再生と最終状態ハッシュ検証

効果解決へ乱数を追加していない。初期12種類で乱数を使う処理は、シャッフル35回と先攻抽選1回だけである。

## 2. 実装上の固定点

### 2.1 乱数

`packages/game-core/src/rng/xoshiro128ss.ts`へ、4語の符号なし32ビット状態、`Math.imul`、拒否抽選、消費数、スナップショット、Fisher-Yatesを実装した。

`seed`は32文字の小文字16進数だけを受理し、4語すべてが0の種を拒否する。ゲーム開始時の種生成はWeb Cryptoの`getRandomValues`を使う。

### 2.2 初期配札

`packages/content/src/setup/alpha-12.ts`でカード定義IDをUTF-8バイト順に並べ、各3枚の実体IDを生成する。固定席順`[P1, P2]`へ7枚ずつ交互に配り、その後に`nextInt(2)`で先攻を決める。

固定種の期待値は、P1/P2の手札、山札先頭10枚、山札末尾3枚、P2先攻、消費数36をテストしている。

### 2.3 状態ハッシュ

`packages/game-core/src/hash/state-hash.ts`は、正本で定めたキーと配列順を保った投影を作り、オブジェクトキーをUnicodeコードポイント順に並べ、空白なしUTF-8 JSONを純粋なSHA-256へ渡す。

実時間、通信状態、command履歴、表示用情報はハッシュ投影へ含めない。ハッシュは秘密情報を隠す機能ではないため、公開状態の安全性とは別に扱う。

### 2.4 リプレイ

`packages/game-core/src/replay.ts`は、ruleset、catalog、乱数版、シャッフル版、種、初期席順を照合したうえで、受理済みcommandだけを順番に実行器へ渡す。既定実行器はgame-coreのcommand受理器であり、alpha-12では`executeAlpha12Command`が本番と同じカード条件、応答選択、効果キュー、終端処理を接続する。

- 不正commandは再生失敗
- 同一commandの重複は再生失敗
- revision、イベント順、終了種別、最終状態ハッシュを検証
- 各revisionのrevision番号、乱数消費数、状態ハッシュを必須配列として検証し、途中で不一致になった時点で失敗
- G02/G03の内部効果キューを公開commandとして受け付ける機能は追加しない

## 3. P0-06旧ハッシュ値との整合

P0-06正本に記載されたG01〜G03の旧ハッシュ値は、生成元の完全な正規化JSONとrevision別入力がリポジトリへ保存されていないため、今回の実装で再現できなかった。旧値は履歴上の値として保持し、現行実装へ合わせるためのassertionには使わない。

現行の`state-hash.alpha-12.v1`が実際にハッシュする完全な正規化JSONは、次のfixtureとして保存した。

- `tests/fixtures/golden-alpha-12/g01-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/g02-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/g03-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/golden-manifest.json`

これらには現行GameStateの重要な状態、revision、イベント境界に対応する入力が含まれる。G01は本番command pipeline、G02/G03は`resolveEffectQueue`を直接呼ぶ内部ハーネスであり、後者は`COMMAND_ACCEPTED`を生成せずrevision 1のまま進む境界をmanifestへ明記した。旧ハッシュ値へ合わせるために、現行状態モデルから情報を削る実装は採用しない。P1-05へ進む前に、P0-06の完全な入力JSON・revision別ハッシュ・イベント列を再固定し、旧版V1を維持するか`state-hash.alpha-12.v2`へ移行するかを別作業で決める。

## 4. 試験結果

```text
node --experimental-strip-types --test tests/game-core/*.test.mjs tests/content/*.test.mjs
npm run typecheck
56 tests passed
TypeScript typecheck passed
```

固定試験値、拒否抽選、5要素シャッフル、初期12種類セットアップ、SHA-256、ハッシュ変更検出、正常/不正/重複リプレイを含む。

## 5. 次の作業

P1-04の決定性基盤と本番相当リプレイは実装済みである。P0-06旧ハッシュ値との整合は未解決の契約差分として隔離しており、先にその訂正作業を完了してからP1-05へ進む。

- 閲覧者ごとの公開状態投影
- command preview
- 結果画面向けsummary

これらはハッシュ対象や秘密情報の境界を変更する可能性があるため、P1-04の決定性実装へ混ぜない。
