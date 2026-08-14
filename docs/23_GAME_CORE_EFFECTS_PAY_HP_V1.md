# エラバレタン P1-02 game-core effects / PAY_HP 実装記録 v1

## 1. 位置づけ

P1-02は、P1-01で固定した純粋な`GameState`とcommand境界へ、カード解決で使う効果命令を接続する段階である。

対象は次の範囲とする。

- 16種類の`EffectCommandType`の入力型、検証、結果、イベント
- 1回の解決における効果キューの順序処理と上限32
- 後続効果が拒否された場合のキュー全体の原子的なロールバック
- 体力ダメージ、盾、受けるダメージ軽減、反射、手札移動、世界耐久、フィールドの基礎処理
- `PAY_HP`を通常ダメージから分離した自己体力支払い
- 初期12枚のカード定義から効果命令列を作るデータ駆動のビルダー

画面、通信、保存、CPU、乱数、世界境界の反応、最終採点、リプレイハッシュ、公開状態投影はこの段階の対象外である。

## 2. 実装した契約

### 2.1 効果命令

次の16種類を`packages/game-core/src/effects/types.ts`に固定した。

```text
DAMAGE_PLAYER
HEAL_PLAYER
PAY_HP
ADD_SHIELD
REDUCE_INCOMING_DAMAGE
REFLECT_DAMAGE
DRAW_CARD
DISCARD_CARD
DAMAGE_WORLD
RESTORE_WORLD
SET_FIELD
CLEAR_FIELD
MODIFY_STAT_UNTIL_TURN_END
MODIFY_NEXT_ACTION
REVEAL_PUBLIC_INFORMATION
ADD_SCORE_MODIFIER
```

各命令は、`effectId`、`source`、`target`、`payload`、`attributionPolicy`、`executionTiming`を持つ。クライアントが結果値を持ち込むことは許可せず、`effective`はgame-coreが計算する。

### 2.2 PAY_HP

`PAY_HP`は次の規則で処理する。

- 対象は`source.ownerPlayerId`と同じプレイヤーだけ
- `amount`は1〜29、`minimumRemainingHp`は0〜29
- 実行後の体力が最低残存値未満、または0になる場合は拒否
- 盾、軽減、反射、`worldDamageResponsibility`の対象外
- キュー内で拒否された場合、先行していた効果も含めて状態とイベントをコミットしない

これにより、再生の誓約は「通常ダメージを4受ける」ではなく、「自分の体力から4を支払う」として扱える。

### 2.3 盾と保留中攻撃

`pendingAttack`へ、攻撃ID、攻撃側、防御側、基礎ダメージ、応答回数、現在攻撃の盾・軽減、実効ダメージ、反射済みフラグを保持する。

- `CURRENT_PENDING_ATTACK`は現在の攻撃だけへ適用
- `NEXT_APPLICABLE_ATTACK`は次の攻撃で一度だけ消費
- `UNTIL_TURN_SEQUENCE`は期限まで残る
- 75境界の`nextDefensePenalty`は、盾または軽減の量から先に差し引く
- 反射は1つの保留中攻撃につき1回だけ

### 2.4 原子的な効果キュー

`resolveEffectQueue`は効果を定義順に適用する。すべて成功した場合だけ状態、イベント、空の`effectQueue`を返す。重複`effectId`、不正な入力、条件不成立、キュー上限超過は固定された拒否コードで扱う。

キューが32件を超えた場合は、試合を`INVALID_MATCH`で終了させ、効果を一部だけ適用しない。

## 3. 初期12枚の効果ビルダー

`packages/content/src/cards/initial-12.ts`に、初期12枚のカード定義と`buildInitial12CardEffects`を追加した。主な効果列は次のとおりである。

| カード | 効果列 |
|---|---|
| 堅実な一撃 | `DAMAGE_PLAYER(6)` |
| 星砕き・解放 | `DAMAGE_PLAYER(16)` → `DAMAGE_WORLD(7)` |
| 星砕き・抑制 | `ADD_SHIELD(3, NEXT_APPLICABLE_ATTACK)` |
| 裂け目の礫・解放 | `DAMAGE_PLAYER(4)` → `DAMAGE_WORLD(2)` |
| 裂け目の礫・抑制 | `ADD_SHIELD(1, NEXT_APPLICABLE_ATTACK)` |
| 守りの帳 | `ADD_SHIELD(7, CURRENT_PENDING_ATTACK)` |
| 灰燼の城壁 | `ADD_SHIELD(12)` → `DAMAGE_WORLD(4)` |
| 緑の取引 | `REDUCE_INCOMING_DAMAGE(3)` → `RESTORE_WORLD(4)` |
| 再生の誓約 | `PAY_HP(4)` → `RESTORE_WORLD(7)` |
| 傷痕への審罰 | 解放`DAMAGE_PLAYER(8)`／抑制`DAMAGE_PLAYER(3)` |
| 狂奔する亀裂／根守りの結界 | `SET_FIELD` |
| 無色の宣告 | `CLEAR_FIELD` → `DAMAGE_WORLD(2)` |
| 静かな手直し | `DISCARD_CARD` → `DRAW_CARD(1)` |

カードの条件判定、フィールド自動効果、世界律反応は後続P1-03で追加する。

## 4. 検証

次のコマンドでgame-coreとcontentのテストを実行した。

```bash
node --experimental-strip-types --test tests/game-core/*.test.mjs tests/content/*.test.mjs
```

22テストが成功している。PAY_HPの分離、支払い不足時の原子性、盾と期限、世界耐久の実効値、カードの順序、反射の一回性、初期12枚の効果列を確認した。

## 5. 次段階

次はP1-03として、世界耐久75・50・25の境界反応、フィールド自動効果、カード条件、終端判定を`game-core`へ接続する。
