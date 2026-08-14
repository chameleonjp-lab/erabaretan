# エラバレタン：初期12種類カード仕様 V1

- 文書状態：P0-01 正本・初期検証値
- 更新日：2026-08-14
- 適用対象：`ruleset.alpha-12.v1`
- 上位文書：[統合計画 V4](14_INTEGRATED_PLAN_V4.md)、[実装実行計画 V1](15_IMPLEMENTATION_EXECUTION_PLAN_V1.md)
- 効果命令：[共通効果命令の正式型 V1](19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)
- 後続検証：[alpha-12 Fixture仕様 V1](18_FIXTURES_ALPHA_12_V1.md)
- 関連契約：[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)

## 1. この文書の役割

この文書は、P0-01で固定する初期12種類のカード正本である。後の`game-core`は、ここに書いたカード定義、効果の順序、条件、複製枚数を参照する。

ここで決める数値は完成版の最終バランスではない。12種類で「解放するか、抑制するか」「攻撃を通すか、防御を温存するか」「自分を削って世界を守るか」という判断が生まれるかを検証するための初期値である。

この段階では、カード専用のJavaScript処理、ランダム対象、大量のランダム効果、山札の並び替え、相手の手札を直接見る効果、復活、反射への再反射を使わない。

## 2. カタログ全体

12種類を各3枚ずつ、合計36枚の共有山札へ入れる。

12種類すべてに`cardVersion = 1`と`introducedRulesetId = ruleset.alpha-12.v1`を設定する。

| 区分 | 種類数 | 枚数 | 内訳 |
|---|---:|---:|---|
| 世界損傷 | 5 | 15 | 02、03、05、09、11 |
| 世界中立 | 5 | 15 | 01、04、08、10、12 |
| 世界再生 | 2 | 6 | 06、07 |
| 合計 | 12 | 36 | 各カード3枚 |

| No. | `cardDefinitionId` | 表示名 | 役割 | `worldImpactType` | `playModes` | `responseModes` | 枚数 |
|---:|---|---|---|---|---|---|---:|
| 01 | `attack.steadfast-strike.v1` | 堅実な一撃 | `ATTACK` | `NEUTRAL` | `RELEASE` | なし | 3 |
| 02 | `attack.star-breaker.v1` | 星砕き | `ATTACK` | `DAMAGE` | `RELEASE`, `RESTRAIN` | なし | 3 |
| 03 | `attack.rift-pebble.v1` | 裂け目の礫 | `ATTACK` | `DAMAGE` | `RELEASE`, `RESTRAIN` | なし | 3 |
| 04 | `defense.guardian-veil.v1` | 守りの帳 | `DEFENSE` | `NEUTRAL` | なし | `RESPONSE` | 3 |
| 05 | `defense.ashen-bulwark.v1` | 灰燼の城壁 | `DEFENSE` | `DAMAGE` | なし | `RESPONSE` | 3 |
| 06 | `intervention.verdant-bargain.v1` | 緑の取引 | `INTERVENTION` | `RESTORE` | なし | `RESPONSE` | 3 |
| 07 | `intervention.oath-of-renewal.v1` | 再生の誓約 | `INTERVENTION` | `RESTORE` | `RELEASE` | なし | 3 |
| 08 | `intervention.judgment-of-scars.v1` | 傷痕への審罰 | `INTERVENTION` | `NEUTRAL` | `RELEASE`, `RESTRAIN` | なし | 3 |
| 09 | `field.frenzied-fracture.v1` | 狂奔する亀裂 | `FIELD` | `DAMAGE` | `RELEASE` | なし | 3 |
| 10 | `field.root-sanctuary.v1` | 根守りの結界 | `FIELD` | `NEUTRAL` | `RELEASE` | なし | 3 |
| 11 | `intervention.field-nullification.v1` | 無色の宣告 | `INTERVENTION` | `DAMAGE` | `RELEASE` | なし | 3 |
| 12 | `intervention.careful-redraw.v1` | 静かな手直し | `INTERVENTION` | `NEUTRAL` | `RELEASE` | なし | 3 |

### 2.1 `worldImpactType`の扱い

`worldImpactType`はカードを一覧で理解するための分類であり、実際の責任計算は選択したモードの効果から行う。解放と抑制で世界への影響が異なるカードは、解放側の主な性格を分類へ使う。

初期12種類では、1つのモード内で`DAMAGE_WORLD`と`RESTORE_WORLD`を同時に実行しない。世界損傷、世界中立、世界再生の実効値は、実際に世界耐久が変化した量から計算する。

## 3. 共通定義

### 3.1 使用方法

- `RELEASE`：カードの強い主効果を使う。
- `RESTRAIN`：カードを抑制して、世界への負担を小さくするか、別の安全な効果へ変える。
- `RESPONSE`：攻撃を受けた側が、`RESPONSE_SELECTION`で選ぶ。

カードを使った場合、選んだカード実体は解決後に捨て札へ移す。効果の対象として自分の手札を選ぶとき、解決中のカード実体自身は選べない。

### 3.2 効果命令の記法

以下は新しい命令名ではなく、[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)の共通効果命令へ渡す固定された引数である。

| 記法 | 意味 |
|---|---|
| `DAMAGE_PLAYER(target, amount)` | 対象の体力へ固定値のダメージを与える。防御・反射の通常処理を受ける。 |
| `ADD_SHIELD(target, amount, expiry)` | 対象へ指定値の盾を付ける。盾は次の適用可能な攻撃へ使い、指定時点を過ぎたら消える。 |
| `REDUCE_INCOMING_DAMAGE(amount)` | 現在の攻撃だけを指定値だけ軽減する。余りは持ち越さない。 |
| `PAY_HP(target, amount, minimumRemainingHp)` | 通常ダメージとは別に体力を支払う。盾、軽減、反射の対象にならない。 |
| `DRAW_CARD(target, count)` | 山札の上から指定枚数を引く。山札が足りない分は引かない。 |
| `DISCARD_CARD(target, selectionRule)` | 条件に合う手札を選んで捨て札へ置く。 |
| `DAMAGE_WORLD(amount)` | 世界耐久へ固定値の損傷を与え、実効値を使用者の責任へ記録する。 |
| `RESTORE_WORLD(amount)` | 世界耐久へ固定値の再生を与え、実効値を使用者の実効世界再生へ記録する。 |
| `SET_FIELD(fieldDefinitionId, expiresAfterTurnSequence)` | 現在のフィールドを終了し、指定したフィールドを設定する。 |
| `CLEAR_FIELD()` | 現在のフィールドを直ちに終了する。終了時効果は発生しない。 |

### 3.3 盾の初期仕様

- 応答カードの盾は、現在の保留中攻撃にだけ適用する。
- 行動選択で抑制したカードの盾は、使用者の次の自分の手番開始まで有効とする。通常の交互進行では`expiresAfterTurnSequence = currentTurnSequence + 2`で表す。
- 盾の余りは次の攻撃へ持ち越さない。
- `PAY_HP`は盾や反射で置き換えない。

### 3.4 フィールドの期限

`SET_FIELD`で、カードを解決している`turnSequence`を`N`とする。`expiresAfterTurnSequence = N + 3`を指定したフィールドは、現在のカード解決後から`N + 1`と`N + 2`の手番まで有効で、`N + 3`の手番開始前に終了する。

フィールドの自動効果は、カードの主効果と防御・反応効果を処理した後に適用する。フィールドによる世界損傷の増減も、世界境界の確認前に処理する。

## 4. カード定義

### 01. 堅実な一撃

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `attack.steadfast-strike.v1` |
| `cardVersion` | `1` |
| `displayName` | 堅実な一撃 |
| `role` | `ATTACK` |
| `worldImpactType` | `NEUTRAL` |
| `targetRule` | 相手プレイヤー1人 |
| `conditions` | 自分の`ACTION_SELECTION`でのみ使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：相手へ6ダメージ。世界への影響なし。
- 効果：`DAMAGE_PLAYER(OPPONENT, 6)`

このカードは、世界を傷つけずに相手へ圧力をかける基準カードとする。

### 02. 星砕き

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `attack.star-breaker.v1` |
| `cardVersion` | `1` |
| `displayName` | 星砕き |
| `role` | `ATTACK` |
| `worldImpactType` | `DAMAGE` |
| `targetRule` | 相手プレイヤー1人、抑制時は自分 |
| `conditions` | 解放・抑制ともに自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：相手へ16ダメージ。世界へ7損傷。
- 効果の順序：
  1. `DAMAGE_PLAYER(OPPONENT, 16)`
  2. `DAMAGE_WORLD(7)`

#### `RESTRAIN`

- 表示文：次に受ける攻撃を3軽減。世界への影響なし。
- 効果：`ADD_SHIELD(SELF, 3, expiresAfterTurnSequence = currentTurnSequence + 2)`

解放は大きな撃破力を持つが、初期世界の75境界を越える局面を作りやすい。抑制は手札を無駄にせず防御へ変えるが、相手へ直接圧力をかけない。

### 03. 裂け目の礫

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `attack.rift-pebble.v1` |
| `cardVersion` | `1` |
| `displayName` | 裂け目の礫 |
| `role` | `ATTACK` |
| `worldImpactType` | `DAMAGE` |
| `targetRule` | 相手プレイヤー1人、抑制時は自分 |
| `conditions` | 解放・抑制ともに自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：相手へ4ダメージ。世界へ2損傷。
- 効果の順序：
  1. `DAMAGE_PLAYER(OPPONENT, 4)`
  2. `DAMAGE_WORLD(2)`

#### `RESTRAIN`

- 表示文：次に受ける攻撃を1軽減。世界への影響なし。
- 効果：`ADD_SHIELD(SELF, 1, expiresAfterTurnSequence = currentTurnSequence + 2)`

星砕きより弱いが、世界損傷も小さい。世界境界の直前で、解放の小さな圧力を使うか抑制するかを確認する。

### 04. 守りの帳

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `defense.guardian-veil.v1` |
| `cardVersion` | `1` |
| `displayName` | 守りの帳 |
| `role` | `DEFENSE` |
| `worldImpactType` | `NEUTRAL` |
| `targetRule` | 自分。保留中攻撃に対する応答 |
| `conditions` | `RESPONSE_SELECTION`で、自分が防御側のとき |
| `playModes` | なし |
| `responseModes` | `RESPONSE` |
| `copiesInDeck` | 3 |

#### `RESPONSE`

- 表示文：この攻撃を7防ぐ。世界への影響なし。
- 効果：`ADD_SHIELD(SELF, 7, currentPendingAttack)`

応答可能な攻撃では、防御カードを持っているかどうかを攻撃側へ知らせない。防御側本人だけがこのカードを合法な応答候補として見る。

### 05. 灰燼の城壁

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `defense.ashen-bulwark.v1` |
| `cardVersion` | `1` |
| `displayName` | 灰燼の城壁 |
| `role` | `DEFENSE` |
| `worldImpactType` | `DAMAGE` |
| `targetRule` | 自分。保留中攻撃に対する応答 |
| `conditions` | `RESPONSE_SELECTION`で、自分が防御側のとき |
| `playModes` | なし |
| `responseModes` | `RESPONSE` |
| `copiesInDeck` | 3 |

#### `RESPONSE`

- 表示文：この攻撃を12防ぐ。世界へ4損傷。
- 効果の順序：
  1. `ADD_SHIELD(SELF, 12, currentPendingAttack)`
  2. `DAMAGE_WORLD(4)`

大きな攻撃を受け止められるが、守る行動そのものが世界を傷つける。攻撃側の世界損傷ではなく、カードを使った防御側の責任として記録する。

### 06. 緑の取引

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `intervention.verdant-bargain.v1` |
| `cardVersion` | `1` |
| `displayName` | 緑の取引 |
| `role` | `INTERVENTION` |
| `worldImpactType` | `RESTORE` |
| `targetRule` | 自分の保留中攻撃と共有世界 |
| `conditions` | `RESPONSE_SELECTION`で、自分が防御側のとき |
| `playModes` | なし |
| `responseModes` | `RESPONSE` |
| `copiesInDeck` | 3 |

#### `RESPONSE`

- 表示文：この攻撃を3軽減し、世界を4再生。
- 効果の順序：
  1. `REDUCE_INCOMING_DAMAGE(3)`
  2. `RESTORE_WORLD(4)`

防御カードを1枚使う機会と引き換えに世界を戻す。世界が満タンなら、実効世界再生は0として記録する。

### 07. 再生の誓約

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `intervention.oath-of-renewal.v1` |
| `cardVersion` | `1` |
| `displayName` | 再生の誓約 |
| `role` | `INTERVENTION` |
| `worldImpactType` | `RESTORE` |
| `targetRule` | 自分の体力と共有世界 |
| `conditions` | 自分の体力が5以上、かつ世界耐久が最大値未満 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：自分の体力を4支払い、世界を7再生。
- 効果の順序：
  1. `PAY_HP(SELF, 4, minimumRemainingHp = 1)`
  2. `RESTORE_WORLD(7)`

体力の支払いは通常ダメージではない。そのため、防御、軽減、反射で支払いを減らせず、体力が5未満ならカード命令を受理しない。戦闘資源と世界の責任を直接交換するカードである。

### 08. 傷痕への審罰

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `intervention.judgment-of-scars.v1` |
| `cardVersion` | `1` |
| `displayName` | 傷痕への審罰 |
| `role` | `INTERVENTION` |
| `worldImpactType` | `NEUTRAL` |
| `targetRule` | 相手プレイヤー1人 |
| `conditions` | 自分の`ACTION_SELECTION`で使用可能。解放だけ相手の公開された世界損傷責任を参照する |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 条件：相手の`worldDamageResponsibility >= 5`。
- 表示文：破壊責任が5以上の相手へ8ダメージ。世界への影響なし。
- 効果：`DAMAGE_PLAYER(OPPONENT, 8)`

#### `RESTRAIN`

- 条件：なし。
- 表示文：相手へ3ダメージ。世界への影響なし。
- 効果：`DAMAGE_PLAYER(OPPONENT, 3)`

相手の過去の破壊を現在の戦闘へ戻す。ただし、相手の手札、山札、未公開情報は参照しない。責任が少ない相手へ解放を使うことはできず、抑制で小さな攻撃へ変える。

### 09. 狂奔する亀裂

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `field.frenzied-fracture.v1` |
| `cardVersion` | `1` |
| `displayName` | 狂奔する亀裂 |
| `role` | `FIELD` |
| `worldImpactType` | `DAMAGE` |
| `targetRule` | 共有フィールド |
| `conditions` | 自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：次の2手番の間、世界損傷を伴う解放の損傷を1増やす。
- 効果：`SET_FIELD(field.frenzied-fracture.v1, expiresAfterTurnSequence = currentTurnSequence + 3)`

#### フィールド定義 `field.frenzied-fracture.v1`

- 世界損傷を伴う`RELEASE`カードの`DAMAGE_WORLD`要求値へ、1回につき1を加える。
- 1つのカード解決で複数の`DAMAGE_WORLD`があっても、このフィールドによる加算はカード1枚につき1回だけとする。
- 加算分の責任者は、元のカードを使ったプレイヤーとする。
- フィールド自体を置いたことだけでは、世界損傷を記録しない。

世界を壊す誘惑を強めるフィールドだが、相手も同じ恩恵を受ける。自分だけが安全に利用できる効果ではない。

### 10. 根守りの結界

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `field.root-sanctuary.v1` |
| `cardVersion` | `1` |
| `displayName` | 根守りの結界 |
| `role` | `FIELD` |
| `worldImpactType` | `NEUTRAL` |
| `targetRule` | 共有フィールド |
| `conditions` | 自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：次の2手番の間、各手番で最初の世界損傷を2軽減する。
- 効果：`SET_FIELD(field.root-sanctuary.v1, expiresAfterTurnSequence = currentTurnSequence + 3)`

#### フィールド定義 `field.root-sanctuary.v1`

- 各`turnSequence`の最初の`DAMAGE_WORLD`要求値から2を減らす。
- 軽減後の損傷は0未満にならない。
- その手番で2回目以降に発生する世界損傷へは、この軽減を使わない。
- 実際に減った世界損傷の責任は、元のカードを使ったプレイヤーへ記録する。

守るフィールドは世界損傷を直接回復しない。これにより、世界再生カードだけが持つ「実際に減った世界を戻す」役割を保つ。

### 11. 無色の宣告

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `intervention.field-nullification.v1` |
| `cardVersion` | `1` |
| `displayName` | 無色の宣告 |
| `role` | `INTERVENTION` |
| `worldImpactType` | `DAMAGE` |
| `targetRule` | 現在の共有フィールドと共有世界 |
| `conditions` | 現在フィールドが1つ以上あるとき、自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：現在のフィールドを消し、世界へ2損傷。
- 効果の順序：
  1. `CLEAR_FIELD()`
  2. `DAMAGE_WORLD(2)`

フィールドを消す代償として世界を傷つける。フィールドがないときはこのカードをプレイできず、通常の手札破棄で処理する。`CLEAR_FIELD`で終了したフィールドの終了時効果は発生しない。

### 12. 静かな手直し

| 項目 | 定義 |
|---|---|
| `cardDefinitionId` | `intervention.careful-redraw.v1` |
| `cardVersion` | `1` |
| `displayName` | 静かな手直し |
| `role` | `INTERVENTION` |
| `worldImpactType` | `NEUTRAL` |
| `targetRule` | 自分の手札から、使用中カード以外を1枚選ぶ |
| `conditions` | 自分の手札が2枚以上あるとき、自分の`ACTION_SELECTION`で使用可能 |
| `copiesInDeck` | 3 |

#### `RELEASE`

- 表示文：手札を1枚捨て、山札から1枚引く。世界への影響なし。
- 効果の順序：
  1. `DISCARD_CARD(SELF, oneOtherCardFromOwnHand)`
  2. `DRAW_CARD(SELF, 1)`

捨てるカードと使用中カードを混同しない。山札が空でも、選んだカードの破棄は成立し、追加のカードは引かない。山札の並び替えや相手の手札確認は行わない。

## 5. カードと世界影響の確認

| 役割 | カード | 期待する判断 |
|---|---|---|
| 中立標準攻撃 | 堅実な一撃 | 世界を傷つけずに圧力をかけるか |
| 世界損傷を伴う大攻撃 | 星砕き | 解放して撃破を狙うか、抑制して守るか |
| 小損傷の圧力攻撃 | 裂け目の礫 | 小さな損傷を許容するか |
| 中立標準防御 | 守りの帳 | 防御を今使うか温存するか |
| 強力だが世界を傷つける防御 | 灰燼の城壁 | 世界を傷つけて大攻撃を受けるか |
| 再生を伴う防御・介入 | 緑の取引 | 防御機会を再生へ交換するか |
| 自己犠牲型世界再生 | 再生の誓約 | 体力4を払って世界7を戻すか |
| 相手の世界損傷を利用する制裁 | 傷痕への審罰 | 相手の責任が5以上なら強く裁くか |
| 破壊を促すフィールド | 狂奔する亀裂 | 相手も強くなる場を置くか |
| 世界を守りやすくするフィールド | 根守りの結界 | 直接再生せず、次の損傷を抑えるか |
| フィールド上書き介入 | 無色の宣告 | 世界を傷つけて現在のフィールドを消すか |
| 手札を整える中立介入 | 静かな手直し | 手札1枚と引き換えに山札を引くか |

## 6. P0-01の検証対象

この仕様を実装する前に、次を手計算できることを確認する。

1. 世界79で星砕きを解放すると、世界は72になる。75境界を越えるため、世界律の反応を後続処理へ送る。
2. 世界45、体力8で再生の誓約を使うと、体力は4、世界は52になる。支払いは通常ダメージではない。
3. 相手の世界損傷責任が4なら傷痕への審罰の解放は拒否され、抑制の3ダメージだけ選べる。
4. 狂奔する亀裂の後に星砕きを解放すると、世界損傷要求値は7ではなく8になる。
5. 根守りの結界の最初の世界損傷が2なら、実効世界損傷は0になる。責任にも0だけを記録する。
6. 無色の宣告は現在のフィールドを消した後に世界へ2損傷を与えるため、消したフィールドの軽減を受けない。
7. 静かな手直しで山札が空でも、選択した追加カードは捨てられ、カード補充だけが起きない。

## 7. P0-01から後続工程へ引き継ぐもの

P0-02で、世界律と`ruleset`検証値を[別の正本](17_RULESET_ALPHA_12_V1.md)へ固定した。P0-01のカード定義と本書の効果命令は、その正本を参照する。

P0-03で、カード効果と世界律を組み合わせた初期状態・操作・期待結果を[Fixture正本](18_FIXTURES_ALPHA_12_V1.md)へ固定した。

P0-04で、カード効果を表す共通効果命令の外枠、入力型、実効値、責任、拒否条件を[効果命令正本](19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)へ固定した。

- [x] 75、50、25の世界律の具体的な効果をP0-02で定義した
- [x] 初期`ruleset`の全数値と採点係数をP0-02で定義した
- 防御値、盾、世界損傷が同じ解決内で混ざる場合の全処理例
- 決定的シャッフルのアルゴリズムと固定試験値
- [x] Fixture A〜F、X01〜X14の完全な初期状態と期待結果をP0-03で定義した
- [x] 共通効果命令の正式型と初期12種類の命令展開をP0-04で定義した
- 最終版のカード数値、使用率、勝率

P0-01からP0-03の正本が揃った。P0-04、P0-05、P0-06が終わるまで、`game-core`本実装、画面、CPU、通信は開始しない。

## 8. 完了判定

- [x] 12種類すべてに必須項目を定義した。
- [x] 世界損傷5・中立5・再生2へ分類した。
- [x] 各カードの複製枚数を3枚へ定義した。
- [x] 解放、抑制、応答の使用方法を定義した。
- [x] `PAY_HP`を使う自己犠牲カードを1種類定義した。
- [x] カード専用JavaScript処理を使わない構成にした。
- [x] フィールド3種類の効果、期限、責任を定義した。
- [x] 相手の秘密情報を参照するカードを入れていない。
- [x] 最初の世界律をP0-02の正本へ定義した。
- [x] `ruleset`検証値をP0-02の正本へ固定した。
- [x] Fixture A〜F、X01〜X14をP0-03の正本へ仕様化した。

この文書でP0-01を完了し、P0-02〜P0-04の正本追加後は、次にP0-05「決定的乱数生成器と固定試験値」へ進む。
