# エラバレタン：共通効果命令の正式型 V1

- 文書状態：P0-04 正本・実装前検証値
- 更新日：2026-08-14
- effectSchemaId：effect-schema.alpha-12.v1
- 対象rulesetId：ruleset.alpha-12.v1
- 対象catalogHash：catalog.alpha-12.v1
- 関連文書：[初期12種類カード仕様 V1](16_INITIAL_12_CARD_SPEC_V1.md)
- 関連文書：[ruleset alpha-12 と砕けゆく原初界 V1](17_RULESET_ALPHA_12_V1.md)
- 関連文書：[alpha-12 Fixture仕様 V1](18_FIXTURES_ALPHA_12_V1.md)
- 関連契約：[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)

## 1. この文書の役割

この文書は、カード定義から作られる効果命令の形、入力条件、処理結果、責任記録を固定する。

カードは自由なJavaScript処理を持たない。カード定義は、ここで定めた共通効果命令を記載順に組み合わせる。ルールエンジンは、命令の種類を見て処理するが、カード名ごとの特別な分岐は持たない。

この文書で決めるのは、次の範囲である。

- 効果命令の共通外枠
- 初期版で使える命令の種類
- 命令ごとの入力型と上限
- 効果を実行した結果の型
- 体力、世界耐久、フィールド、手札、採点責任の記録方法
- 効果キュー、応答、世界境界との接続
- 不正な効果を拒否する条件

この文書は、決定的シャッフルのアルゴリズム、状態ハッシュの計算方法、通信の保存方法を定義しない。これらはP0-05とP0-06で固定する。

## 2. 基本方針

### 2.1 クライアントは効果値を送らない

クライアントが送るのは、カード実体ID、使用方法、対象、応答の選択だけである。

クライアントは、ダメージ値、再生値、盾の量、採点値、世界責任を送らない。ルールエンジンが、ruleset、カード正本、現在状態から効果命令を作る。

### 2.2 効果命令は識別可能にする

一つの解決単位で作られた各命令へ、決定的なeffectIdを付ける。

~~~text
effectId = effect.<resolutionId>.<queueOrdinal>
例：effect.resolution-0042.0007
~~~

queueOrdinalは1から始め、効果命令が追加された順に増やす。乱数、時刻、端末情報をeffectIdへ入れない。

### 2.3 すべて整数で処理する

効果量、体力、世界耐久、手札枚数、手番番号、期限は整数だけを使う。小数、NaN、Infinity、負のゼロ、文字列化した数値を受理しない。

### 2.4 実効値と要求値を分ける

命令に書かれた量をrequested、実際に状態へ適用できた量をeffectiveとして記録する。

例：

~~~text
開始世界耐久：6
DAMAGE_WORLD requested：7
DAMAGE_WORLD effective：6
終了世界耐久：0
~~~

世界責任、採点、境界反応は、原則としてeffectiveを使う。

## 3. 共通効果命令の外枠

### 3.1 EffectCommand

すべての効果命令は、次の外枠を持つ。

~~~json
{
  "effectId": "effect.resolution-0042.0007",
  "commandType": "DAMAGE_WORLD",
  "source": {
    "sourceKind": "CARD",
    "ownerPlayerId": "P1",
    "cardDefinitionId": "attack.star-breaker.v1",
    "cardInstanceId": "p1-star-01",
    "mode": "RELEASE"
  },
  "target": {
    "targetKind": "WORLD"
  },
  "payload": {
    "amount": 7
  },
  "attributionPolicy": "SOURCE_OWNER",
  "executionTiming": "IMMEDIATE"
}
~~~

### 3.2 外枠の項目

| 項目 | 型 | 必須 | 内容 |
|---|---|---:|---|
| effectId | 固定形式の文字列 | 必須 | 解決単位内で一意な命令ID |
| commandType | EffectCommandType | 必須 | 命令の種類 |
| source | EffectSource | 必須 | 命令を発生させたカード、フィールド、世界律、システム |
| target | EffectTarget | 命令ごと | 対象プレイヤー、世界、手札、フィールド |
| payload | 命令ごとの型 | 必須 | 数値や条件 |
| attributionPolicy | AttributionPolicy | 必須 | 責任記録の規則 |
| executionTiming | ExecutionTiming | 必須 | 直ちに処理するか、応答確定後に処理するか |

ルールエンジンが作る内部命令には、実装上必要ならresolutionId、causeEffectId、queueOrdinalを追加してよい。ただし、それらはクライアント入力ではない。

### 3.3 EffectSource

~~~json
{
  "sourceKind": "CARD",
  "ownerPlayerId": "P1",
  "cardDefinitionId": "attack.star-breaker.v1",
  "cardInstanceId": "p1-star-01",
  "mode": "RELEASE"
}
~~~

sourceKindは次のいずれかとする。

| sourceKind | ownerPlayerId | 用途 |
|---|---|---|
| CARD | 必須 | 手札から使ったカード |
| FIELD | 必須 | 有効なフィールドの付随効果 |
| WORLD_LAW | なし | 75・50・25の世界律 |
| SYSTEM | 原則なし | 終端、時間切れ、試験用内部処理 |

CARDのmodeはRELEASE、RESTRAIN、RESPONSE、SYSTEMのいずれかとする。FIELD、WORLD_LAW、SYSTEMのmodeはSYSTEMとする。

cardDefinitionIdとcardInstanceIdは、sourceKindがCARDなら必須である。FIELDでは、現在のフィールド定義IDをcardDefinitionIdへ入れず、fieldDefinitionIdをsourceへ追加する。WORLD_LAWではworldLawIdをsourceへ追加する。

### 3.4 EffectTarget

targetKindは命令ごとに許可された値だけを使う。

~~~text
PLAYER
WORLD
CURRENT_PENDING_ATTACK
CURRENT_FIELD
SELF_HAND
PUBLIC_INFORMATION
SCORE_LEDGER
NONE
~~~

相手の非公開手札、未配布の山札順、乱数状態、通信接続状態をEffectTargetへ指定しない。

### 3.5 AttributionPolicy

| 値 | 内容 |
|---|---|
| SOURCE_OWNER | source.ownerPlayerIdへ世界責任または効果責任を付ける |
| ORIGINAL_CARD_OWNER | フィールド修正後も、元のカード使用者へ世界責任を付ける |
| TARGET_PLAYER | 対象プレイヤーへ効果責任を付ける |
| NO_LEDGER | 世界責任や採点責任へ加えない |
| SYSTEM_LEDGER | システムが定義した台帳へ記録する |

カード定義から作る初期版のDAMAGE_WORLDとRESTORE_WORLDはSOURCE_OWNERを使う。フィールドによる増減分も、元の世界損傷カードの使用者へ帰属させるため、結果記録ではORIGINAL_CARD_OWNERを使う。

### 3.6 ExecutionTiming

| 値 | 用途 |
|---|---|
| IMMEDIATE | 現在の効果キュー位置で処理する |
| AFTER_RESPONSE_MODIFIERS | 保留中攻撃への盾・軽減を確定してから処理する |
| WORLD_LAW_PHASE | 主カード、応答、フィールド付随効果の後に処理する |
| TERMINAL_PHASE | 必須効果が終わった後の終了判定で処理する |

攻撃カードのDAMAGE_PLAYERは、応答による盾・軽減を使うため、内部的にAFTER_RESPONSE_MODIFIERSとして扱う。DAMAGE_WORLDは、カード定義の効果順に従う。

## 4. 命令の正式な種類

EffectCommandTypeは次の16種類で固定する。

~~~text
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
~~~

### 4.1 DAMAGE_PLAYER

~~~json
{
  "commandType": "DAMAGE_PLAYER",
  "target": { "targetKind": "PLAYER", "playerId": "P2" },
  "payload": {
    "amount": 16,
    "damageKind": "DIRECT"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "AFTER_RESPONSE_MODIFIERS"
}
~~~

- amountは1〜30の整数。
- targetは生存中のプレイヤー1人。
- damageKindはDIRECT、REFLECTION、FRAGILE_WORLD、WORLD_LAWのいずれか。
- 体力へ入る量は、攻撃側修正、フィールド修正、世界律修正、盾、軽減を順番に適用した後で決める。
- 体力は0未満にしない。
- 盾や軽減で実効値が0になっても、命令自体は合法である。
- FRAGILE_WORLDも通常のプレイヤーダメージとして処理し、盾・軽減・反射の通常規則を使う。
- PAY_HPはこの命令へ変換しない。

### 4.2 HEAL_PLAYER

~~~json
{
  "commandType": "HEAL_PLAYER",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "amount": 5,
    "allowRevive": false
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- amountは1〜30の整数。
- 最大体力を超える分は切り捨てる。
- allowReviveは初期版では常にfalse。
- 体力0のプレイヤーを同じ解決単位の通常回復で復活させない。
- 初期12種類はHEAL_PLAYERを使用しない。世界再生にはRESTORE_WORLDを使う。

### 4.3 PAY_HP

~~~json
{
  "commandType": "PAY_HP",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "amount": 4,
    "minimumRemainingHp": 1
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- amountは1〜29の整数。
- target.playerIdはsource.ownerPlayerIdと同じでなければならない。
- minimumRemainingHpは0〜29の整数で、初期版の再生の誓約は1を使う。
- hp - amountがminimumRemainingHp未満なら、カード命令全体を受理しない。
- 盾、軽減、反射の対象にしない。
- 実行後の体力が0になるPAY_HPは、初期版では作らない。
- 支払った量はDAMAGE_PLAYERやworldDamageResponsibilityへ記録しない。

### 4.4 ADD_SHIELD

~~~json
{
  "commandType": "ADD_SHIELD",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "amount": 7,
    "scope": "CURRENT_PENDING_ATTACK",
    "pendingAttackId": "attack-0042"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

scopeは次のいずれかとする。

| scope | 必須項目 | 内容 |
|---|---|---|
| CURRENT_PENDING_ATTACK | pendingAttackId | 今回の保留中攻撃だけへ適用 |
| NEXT_APPLICABLE_ATTACK | expiresAfterTurnSequence | 次に受ける攻撃へ一度だけ適用 |
| UNTIL_TURN_SEQUENCE | expiresAfterTurnSequence | 指定手番番号まで有効 |

- amountは1〜30の整数。
- 余った盾は次の攻撃へ持ち越さない。
- 75境界のnextDefensePenaltyは、盾量または軽減量から先に引く。
- 応答カードの盾はCURRENT_PENDING_ATTACKを使う。
- 抑制カードの盾はNEXT_APPLICABLE_ATTACKを使う。
- 盾の合計が30を超えないように状態側で上限を適用する。

### 4.5 REDUCE_INCOMING_DAMAGE

~~~json
{
  "commandType": "REDUCE_INCOMING_DAMAGE",
  "target": {
    "targetKind": "CURRENT_PENDING_ATTACK",
    "pendingAttackId": "attack-0042"
  },
  "payload": {
    "amount": 3
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "AFTER_RESPONSE_MODIFIERS"
}
~~~

- amountは1〜30の整数。
- 対象は現在の保留中攻撃だけである。
- 余った軽減量は次の攻撃へ持ち越さない。
- 75境界のペナルティを軽減量へ先に適用する。
- pendingAttackIdが現在の攻撃と一致しなければ拒否する。
- 一つの攻撃へ複数の任意応答を追加しない。

### 4.6 REFLECT_DAMAGE

~~~json
{
  "commandType": "REFLECT_DAMAGE",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "amount": 4,
    "pendingAttackId": "attack-0042"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- amountは1〜30の整数。
- targetは保留中攻撃の使用者でなければならない。
- 反射量は、保留中攻撃の実効ダメージを上限とする。
- 反射ダメージへ任意の応答を受け付けない。
- 反射から再反射を発生させない。
- 反射で攻撃者が体力0になっても、現在の必須効果を最後まで処理する。
- 初期12種類ではREFLECT_DAMAGEを使用しない。

### 4.7 DRAW_CARD

~~~json
{
  "commandType": "DRAW_CARD",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "count": 1,
    "reason": "WORLD_LAW_50"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "WORLD_LAW_PHASE"
}
~~~

- countは1〜9の整数。
- 手札上限9枚を超えない。
- 山札が足りない分は引かない。
- 山札が空でも命令は合法であり、statusはNO_OPになる。
- 引いたカードの内容は本人だけへ公開する。
- 乱数はカードを引く効果では消費しない。山札順は試合開始時に確定している。
- 初期12種類では、通常補充、静かな手直し、50境界の追加ドローで使用する。

### 4.8 DISCARD_CARD

~~~json
{
  "commandType": "DISCARD_CARD",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "selection": {
      "selectionKind": "EXPLICIT_CARD_INSTANCE",
      "cardInstanceId": "p1-filler-01"
    },
    "reason": "CARD_EFFECT"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

selectionKindは次のいずれかとする。

| 値 | 内容 |
|---|---|
| EXPLICIT_CARD_INSTANCE | 指定した手札実体を捨てる |
| NEWEST_CARD_INSTANCE | 最も新しく引いたカードを捨てる |
| OLDEST_CARD_INSTANCE | 最も古く引いたカードを捨てる |

- 指定カードが対象者の手札にない場合は拒否する。
- 解決中のカード実体自身を選べない。
- 初期12種類では、静かな手直しと時間切れの既定処理で使用する。
- 相手の手札内容や未公開カードの順序を選択条件にしない。

### 4.9 DAMAGE_WORLD

~~~json
{
  "commandType": "DAMAGE_WORLD",
  "target": { "targetKind": "WORLD" },
  "payload": {
    "amount": 7,
    "reason": "CARD_RELEASE"
  },
  "attributionPolicy": "SOURCE_OWNER",
  "executionTiming": "IMMEDIATE"
}
~~~

- amountは1〜100の整数。
- フィールドと世界律の修正を先に適用する。
- effectiveはmin(requestedAfterModifiers, worldDurabilityBefore)とする。
- effectiveだけをsource.ownerPlayerIdのworldDamageResponsibilityへ加える。
- 世界耐久は0未満にしない。
- 世界0の後の追加損傷はeffective=0で、責任へ加えない。
- 75、50、25の未発生境界を、変更前と変更後から検出する。
- 25境界がすでに有効なら、カード1枚につきFRAGILE_WORLDの自己損傷を1回だけ追加する。
- 25境界を越えた同じカード自身へ、自己損傷を追加しない。

### 4.10 RESTORE_WORLD

~~~json
{
  "commandType": "RESTORE_WORLD",
  "target": { "targetKind": "WORLD" },
  "payload": {
    "amount": 4,
    "reason": "CARD_RESPONSE"
  },
  "attributionPolicy": "SOURCE_OWNER",
  "executionTiming": "IMMEDIATE"
}
~~~

- amountは1〜100の整数。
- effectiveはmin(requested, worldMaxDurability - worldDurabilityBefore)とする。
- effectiveだけをsource.ownerPlayerIdのeffectiveWorldRestoreへ加える。
- 世界が満タンならeffective=0で、statusはNO_OPになる。
- effective=0の再生は50境界の対象者を更新しない。
- 他のプレイヤーが壊した世界を再生しても、過去のworldDamageResponsibilityを消さない。
- 初期12種類では、一枚のモード内でDAMAGE_WORLDとRESTORE_WORLDを同時に実行しない。

### 4.11 SET_FIELD

~~~json
{
  "commandType": "SET_FIELD",
  "target": { "targetKind": "CURRENT_FIELD" },
  "payload": {
    "fieldDefinitionId": "field.root-sanctuary.v1",
    "ownerPlayerId": "P1",
    "expiresAfterTurnSequence": 4
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- fieldDefinitionIdはcatalogHashに存在する定義だけを使う。
- ownerPlayerIdはカードを使ったプレイヤーと一致させる。
- 新しいフィールドを置くと、古いフィールドを直ちに終了してから新しいフィールドを設定する。
- 古いフィールドの終了時効果は発生させない。
- 同時に有効なフィールドは1枚だけである。
- expiresAfterTurnSequenceは、現在のturnSequenceより大きい整数である。
- 初期12種類では、currentTurnSequence + 3を使う。

### 4.12 CLEAR_FIELD

~~~json
{
  "commandType": "CLEAR_FIELD",
  "target": { "targetKind": "CURRENT_FIELD" },
  "payload": {
    "reason": "CARD_RELEASE"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- 現在のフィールドを直ちに終了する。
- フィールドがない場合、カード条件で拒否する。無色の宣告はフィールドがある場合だけ使用可能である。
- 終了時効果は発生させない。
- CLEAR_FIELD後に同じカードのDAMAGE_WORLDが続く場合、消したフィールドの軽減を使わない。

### 4.13 MODIFY_STAT_UNTIL_TURN_END

~~~json
{
  "commandType": "MODIFY_STAT_UNTIL_TURN_END",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "stat": "INCOMING_DAMAGE_REDUCTION",
    "delta": -2,
    "expiresAfterTurnSequence": 3
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "IMMEDIATE"
}
~~~

- statは登録済みの値だけを使う。
- deltaは-30〜30の0以外の整数。
- expiresAfterTurnSequenceは現在のturnSequenceより大きい整数。
- 不明なstatを文字列で追加してはならない。
- 初期12種類では使用しない。75境界の一回だけの防御ペナルティはMODIFY_NEXT_ACTIONで表す。

### 4.14 MODIFY_NEXT_ACTION

~~~json
{
  "commandType": "MODIFY_NEXT_ACTION",
  "target": { "targetKind": "PLAYER", "playerId": "P1" },
  "payload": {
    "stat": "DEFENSE_VALUE",
    "delta": -2,
    "consumeWhen": "NEXT_DEFENSE_CARD"
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "WORLD_LAW_PHASE"
}
~~~

- statはDEFENSE_VALUE、INCOMING_DAMAGE_REDUCTION、ACTION_DAMAGEのいずれか。
- deltaは-30〜30の0以外の整数。
- consumeWhenはNEXT_DEFENSE_CARD、NEXT_APPLICABLE_ATTACK、NEXT_ACTIONのいずれか。
- 75境界のnextDefensePenaltyは、DEFENSE_VALUEまたはINCOMING_DAMAGE_REDUCTIONへ負のdeltaとして記録する。
- ACCEPT_DAMAGEを選んだだけでは消費しない。
- 対象者が次の防御カードを使用したときに消費する。
- 初期12種類では、同じnextDefensePenaltyを二重に積まない。

### 4.15 REVEAL_PUBLIC_INFORMATION

~~~json
{
  "commandType": "REVEAL_PUBLIC_INFORMATION",
  "target": { "targetKind": "PUBLIC_INFORMATION" },
  "payload": {
    "informationKind": "WORLD_THRESHOLD",
    "threshold": 75
  },
  "attributionPolicy": "NO_LEDGER",
  "executionTiming": "WORLD_LAW_PHASE"
}
~~~

informationKindはCARD_PLAYED、CARD_DISCARDED、WORLD_THRESHOLD、FIELD_CHANGED、DRAW_OCCURRED、MATCH_FINISHEDのいずれかとする。

- audienceは初期版ではPUBLIC固定である。
- 相手の手札内容、山札順、乱数状態、秘密の対象候補を公開しない。
- 表示用の短文はカード正本または世界律正本から作る。
- クライアントが送った表示文をそのまま採用しない。

### 4.16 ADD_SCORE_MODIFIER

~~~json
{
  "commandType": "ADD_SCORE_MODIFIER",
  "target": { "targetKind": "SCORE_LEDGER" },
  "payload": {
    "playerId": "P1",
    "modifierKind": "WORLD_COLLAPSE_PENALTY",
    "amount": 25
  },
  "attributionPolicy": "SYSTEM_LEDGER",
  "executionTiming": "TERMINAL_PHASE"
}
~~~

modifierKindはWORLD_COLLAPSE_PENALTY、SURVIVAL_BONUS、WORLD_DAMAGE_RESPONSIBILITY、EFFECTIVE_WORLD_RESTOREのいずれかとする。

- amountは1〜100の整数。
- 初期12種類の通常カードから直接発行しない。
- 世界損傷と世界再生は、まず専用台帳へ実効値を記録し、採点時に初期式へ反映する。
- 破界責任25は、世界0の終端確認後にシステムが一度だけ発行する。
- クライアントが採点値を送った場合は拒否する。

## 5. EffectResult

効果命令を処理した結果は、次の形で返す。

~~~json
{
  "effectId": "effect.resolution-0042.0007",
  "commandType": "DAMAGE_WORLD",
  "status": "APPLIED",
  "requested": 7,
  "effective": 7,
  "before": {
    "worldDurability": 79
  },
  "after": {
    "worldDurability": 72
  },
  "ledgerDelta": {
    "worldDamageResponsibility": {
      "playerId": "P1",
      "amount": 7
    }
  },
  "spawnedEffectIds": [],
  "eventTypes": [
    "DAMAGE_WORLD_APPLIED",
    "WORLD_THRESHOLD_TRIGGERED"
  ]
}
~~~

### 5.1 status

| status | 意味 | 状態変更 |
|---|---|---|
| APPLIED | 要求を一部または全部適用した | あり |
| NO_OP | 命令は合法だが実効値が0、または対象量がない | 最小限の記録のみ |
| REJECTED | 入力条件を満たさない | なし |
| INVALID_MATCH | 効果キューや状態の整合性が壊れた | 通常続行しない |

NO_OPの例は、満タン世界へのRESTORE_WORLD、空の山札からのDRAW_CARD、盾で全量を防いだDAMAGE_PLAYERである。カード使用そのものが合法なら、カード実体は通常どおり捨て札へ移る。

### 5.2 requestedとeffective

- DAMAGE_PLAYER、HEAL_PLAYER、DAMAGE_WORLD、RESTORE_WORLD、DRAW_CARD、DISCARD_CARD、ADD_SHIELDは、requestedとeffectiveを記録する。
- PAY_HPは、受理できた場合はrequestedとeffectiveが同じである。条件を満たさなければREJECTEDである。
- SET_FIELD、CLEAR_FIELD、MODIFY_NEXT_ACTION、REVEAL_PUBLIC_INFORMATIONは、effectiveを件数または適用状態で記録する。
- すべての結果にbefore、after、eventTypesを含める。
- 状態に変更がないREJECTEDでは、beforeだけを監査記録へ残し、afterを作らない。

## 6. 効果命令の検証

### 6.1 共通検証

次のどれかに該当した命令はREJECTEDとする。

- commandTypeが未登録
- effectIdが同じ解決単位ですでに使われている
- sourceが現在のカード、フィールド、世界律と一致しない
- targetKindが命令の許可範囲にない
- 整数でない値、小数、NaN、Infinity、文字列数値を含む
- 命令ごとの上限を超える
- 必須項目が欠けている
- 秘密情報を対象または公開内容へ入れている
- 現在のphaseやpendingActionと合わない
- 同じ解決単位で許可されない再反応を作る
- クライアント由来の効果値を含む

### 6.2 拒否理由

効果命令の拒否理由は、調査可能な固定値にする。

~~~text
EFFECT_UNKNOWN_TYPE
EFFECT_DUPLICATE_ID
EFFECT_BAD_SOURCE
EFFECT_BAD_TARGET
EFFECT_BAD_INTEGER
EFFECT_OUT_OF_RANGE
EFFECT_MISSING_FIELD
EFFECT_CONDITION_NOT_MET
EFFECT_PENDING_ATTACK_REQUIRED
EFFECT_NO_ACTIVE_FIELD
EFFECT_REVIVE_FORBIDDEN
EFFECT_SECRET_DATA
EFFECT_CLIENT_VALUE
EFFECT_REACTION_LIMIT
EFFECT_QUEUE_LIMIT
EFFECT_STATE_INCONSISTENT
~~~

カードを選べない命令は、カード使用自体を受理しない。受理後に一部だけ適用して、残りを捨てる処理はしない。

## 7. 効果処理の順序

一つの解決単位は、次の段階で進む。

~~~text
1. カード・応答の選択を検証
2. カード定義から効果命令を作成
3. 効果命令の外枠とpayloadを検証
4. 保留中攻撃へ盾・軽減を束ねる
5. 主カードの命令を記載順に処理
6. 応答の世界・その他の命令を記載順に処理
7. フィールド付随効果を処理
8. 未発生世界境界を75、50、25の順で反応キューへ入れる
9. 世界律の命令を処理
10. 必須効果の終端確認
11. 体力0、世界0、最大ラウンドを記録
12. 必要なら神の評価を計算
~~~

保留中攻撃のDAMAGE_PLAYERは、4で確定した盾・軽減を使い、5のカード効果の位置で体力へ適用する。

主カードがDAMAGE_WORLDを持ち、応答がRESTORE_WORLDを持つ場合、主カードの世界損傷を先に処理する。その損傷で境界を記録した後、応答の世界再生を処理し、境界反応は7の後に行う。

一つのカード内の命令は、カード正本に書かれた順序を変えない。

## 8. 効果キューと安全上限

- 一解決単位で処理する命令は32件まで。
- キューへ33件目を追加しようとした時点でINVALID_MATCHにする。
- 残りの命令を黙って捨てない。
- INVALID_MATCHでは勝敗と神の選定を確定しない。
- 次の調査情報を保存する。

~~~text
rulesetId
effectSchemaId
catalogHash
cardDefinitionId
cardInstanceId
commandId
effectId
queueOrdinal
processedEffectCount
stateHash
~~~

- 25境界の自己損傷、世界律の追加ドロー、フィールド付随効果も命令数へ含める。
- 合法な初期12種類の通常組み合わせでは、32件を超えない。

## 9. 初期12種類の命令展開

各カードは、次の共通命令だけで表す。

| No. | カード | 使用方法 | 命令列 |
|---:|---|---|---|
| 01 | 堅実な一撃 | RELEASE | DAMAGE_PLAYER(6) |
| 02 | 星砕き | RELEASE | DAMAGE_PLAYER(16) → DAMAGE_WORLD(7) |
| 02 | 星砕き | RESTRAIN | ADD_SHIELD(3, NEXT_APPLICABLE_ATTACK) |
| 03 | 裂け目の礫 | RELEASE | DAMAGE_PLAYER(4) → DAMAGE_WORLD(2) |
| 03 | 裂け目の礫 | RESTRAIN | ADD_SHIELD(1, NEXT_APPLICABLE_ATTACK) |
| 04 | 守りの帳 | RESPONSE | ADD_SHIELD(7, CURRENT_PENDING_ATTACK) |
| 05 | 灰燼の城壁 | RESPONSE | ADD_SHIELD(12, CURRENT_PENDING_ATTACK) → DAMAGE_WORLD(4) |
| 06 | 緑の取引 | RESPONSE | REDUCE_INCOMING_DAMAGE(3) → RESTORE_WORLD(4) |
| 07 | 再生の誓約 | RELEASE | PAY_HP(4) → RESTORE_WORLD(7) |
| 08 | 傷痕への審罰 | RELEASE | DAMAGE_PLAYER(8) |
| 08 | 傷痕への審罰 | RESTRAIN | DAMAGE_PLAYER(3) |
| 09 | 狂奔する亀裂 | RELEASE | SET_FIELD(frenzied-fracture, currentTurnSequence+3) |
| 10 | 根守りの結界 | RELEASE | SET_FIELD(root-sanctuary, currentTurnSequence+3) |
| 11 | 無色の宣告 | RELEASE | CLEAR_FIELD() → DAMAGE_WORLD(2) |
| 12 | 静かな手直し | RELEASE | DISCARD_CARD(1) → DRAW_CARD(1) |

初期12種類では、次の命令をカードから直接発行しない。

~~~text
HEAL_PLAYER
REFLECT_DAMAGE
MODIFY_STAT_UNTIL_TURN_END
MODIFY_NEXT_ACTION
REVEAL_PUBLIC_INFORMATION
ADD_SCORE_MODIFIER
~~~

世界律の表示、75境界のペナルティ、50境界のドロー、25境界の自己損傷は、同じEffectCommandの外枠を使う。ただしsourceKindはWORLD_LAWまたはSYSTEMとし、カード命令へ直接混ぜない。

## 10. P0-04完了判定

- [x] EffectCommandの共通外枠を定義した。
- [x] source、target、payload、責任規則、処理時点を定義した。
- [x] 共通命令16種類の名前と入力型を定義した。
- [x] requestedとeffective、APPLIEDとNO_OPを分離した。
- [x] PAY_HPを通常ダメージから分離した。
- [x] 盾、軽減、反射、手札、世界、フィールド、採点の命令型を定義した。
- [x] 効果拒否理由を固定した。
- [x] 効果処理順と32件の安全上限を固定した。
- [x] 初期12種類すべてを共通命令だけへ展開した。
- [x] カード専用JavaScript処理、eval、new Function、クライアント効果値を禁止した。

P0-04は完了とする。次はP0-05「決定的乱数生成器と固定試験値」へ進む。P0-05とP0-06が終わるまで、game-core本実装と画面実装は開始しない。

