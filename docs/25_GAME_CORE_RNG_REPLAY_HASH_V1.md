# エラバレタン：P1-04 game-core 乱数・リプレイ・状態ハッシュ実装記録 V1

- 文書状態：P1-04 / P1-04b 実装・訂正記録
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

## 3. P0-06実装整合訂正

P0-06正本の旧G01〜G03ハッシュ値は、生成元の完全な正規化JSONとrevision別入力が保存されていないため現行実装から再現できない。旧値はdocs/21の履歴欄へ隔離し、現行実装のassertionには使わない。

`state-hash.alpha-12.v1`の投影、正規化規則、バージョンは維持する。現行の完全な正規化JSONと実行証拠は、次のfixtureとmanifestを機械検査用の正本付属データとして扱う。

- `tests/fixtures/golden-alpha-12/g01-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/g02-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/g03-state-hash-input.json`
- `tests/fixtures/golden-alpha-12/golden-manifest.json`

G01は`executeAlpha12Command`を通る本番command pipelineで、revision 0→1→2、`COMMAND_ACCEPTED`は2件である。G02/G03は`resolveEffectQueue`を直接呼ぶ内部ハーネスで、revision 1→1、`COMMAND_ACCEPTED`なしである。docs/21とmanifestが食い違った場合は試験失敗とし、片方だけを変更しない。

3件のstate-hash input JSONは、`serializeStateForHash`の出力と同じUTF-8バイト列として保存し、末尾の改行を含めない。試験はtrimで改行を吸収せず、ファイルバイト列とハッシュ入力の一致を検査する。旧値へ合わせるために状態モデルから情報を削る実装は採用しない。

P1-05で結果へ影響する状態を追加・変更し、それをハッシュ投影へ含める必要が生じた場合は、`state-hash.alpha-12.v1`を暗黙に変更せず`state-hash.alpha-12.v2`へ移行する。V2移行時はmanifest、3件のstate-hash input JSON、revision別ハッシュ、期待最終ハッシュを一体で更新し、V1のfixtureと期待値を上書きしない。

## 4. 試験結果

```text
node --experimental-strip-types --test tests/game-core/*.test.mjs tests/content/*.test.mjs
npm run typecheck
56 tests passed
TypeScript typecheck passed
```

固定試験値、拒否抽選、5要素シャッフル、初期12種類セットアップ、SHA-256、ハッシュ変更検出、正常/不正/重複リプレイを含む。

## 5. 次の作業

P1-04の決定性基盤と本番相当リプレイ、P0-06実装整合訂正は完了した。旧値は履歴として隔離し、現行manifest・実行境界・fixtureバイト列を正本へ固定した。次はP1-05へ進む。

- 閲覧者ごとの公開状態投影
- command preview
- 結果画面向けsummary

P1-05でこれらを、ハッシュ対象とGameStateを変更しない純粋な境界として実装した。詳細は[P1-05実装契約](26_GAME_CORE_PROJECTION_PREVIEW_SUMMARY_V1.md)を参照する。
