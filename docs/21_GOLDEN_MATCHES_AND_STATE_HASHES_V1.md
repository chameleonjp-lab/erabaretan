# エラバレタン：ゴールデン試合と最終状態ハッシュ V1

- 文書状態：P0-06 正本・実装前検証値
- 更新日：2026-08-14
- 対象rulesetId：ruleset.alpha-12.v1
- 対象catalogHash：catalog.alpha-12.v1
- 関連文書：[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)
- 関連文書：[alpha-12 Fixture仕様 V1](18_FIXTURES_ALPHA_12_V1.md)
- 関連文書：[決定的乱数生成器と固定試験値 V1](20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)

## 1. この文書の役割

この文書は、同じ入力を処理したとき、終端状態、イベント順、採点結果が一致することを確認するための三つの固定試験を定義する。

| goldenMatchId | 内容 | 主な確認 |
|---|---|---|
| golden-g01-normal-defeat | 通常撃破 | 初期配札、先攻の補充、カード攻撃、通常終了、神の評価 |
| golden-g02-world-collapse | 世界崩壊 | 75・50・25の順、世界0、撃破との同時記録、責任による減点 |
| golden-g03-simultaneous-reflection | 反射を含む同時終了 | 反射、両者体力0、世界0、戦闘引き分け |

G01はP0-05の初期配札から始める。G02とG03は、12種類のカードだけでは一枚で作れない効果を確認するため、P0-03のX03と同じルールエンジン内部の試験用効果キューから始める。

試験用効果キューはクライアント命令ではない。クライアントがDAMAGE_WORLDやREFLECT_DAMAGEの数値を直接送ってよい、という意味ではない。

## 2. 状態ハッシュの契約

### 2.1 固定値

| 項目 | 固定値 |
|---|---|
| stateHashVersion | state-hash.alpha-12.v1 |
| ハッシュ方式 | SHA-256 |
| 入力文字コード | UTF-8 |
| JSONの空白 | なし |
| オブジェクトのキー順 | Unicodeコードポイントの昇順 |
| 配列の順序 | 変更しない |

状態ハッシュは、同じ内部状態が同じ文字列へ変換されたことを確認する。秘密情報を隠す機能ではないため、ハッシュ計算はサーバー側または試験環境だけで行う。

### 2.2 ハッシュ対象

最終状態から、次のキーを持つオブジェクトを作る。cardZonesRefは2.4の固定カード領域へ展開してからハッシュする。

~~~text
stateHashVersion
activeField
activePlayerId
cardZones
effectQueue
engineVersion
judgment
matchId
pendingAction
phase
players
randomConsumptionCount
revision
rngAlgorithmVersion
roundNumber
rulesetId
seed
shuffleAlgorithmVersion
terminalFlags
turnSequence
world
~~~

playersはeffectiveWorldRestore、hand、hitPoints、maxHitPoints、statusEffects、survivedRoundCount、worldDamageResponsibilityを持つ。cardZonesはdiscardPile、drawPile、hands、revealedCardsを持つ。worldはdurability、maxDurability、triggeredThresholds、worldLawIdを持つ。

### 2.3 正規化とハッシュの手順

1. 省略表記を使わず、カード実体IDを完全な文字列へ戻す。
2. cardZonesRefを固定カード領域へ展開する。
3. オブジェクトのキーを再帰的に昇順へ並べる。
4. 配列、手札、山札、境界の順序は変えない。
5. 空白なしのJSON文字列を作る。
6. UTF-8バイト列へSHA-256を適用する。
7. 64文字の小文字16進数で保存する。

実時間、描画状態、通信状態、再接続トークン、表示名、調査用ログID、表示文、音、粒子、イベント履歴そのものはハッシュへ含めない。イベント順はexpectedEventTypesと別に比較する。

### 2.4 固定カード領域

次のJSONをPOST_SETUP_ALPHA_12_V1として登録する。これはP0-05の固定種による配札直後のカード領域である。

~~~json
{"hands":{"P1":["attack.rift-pebble.v1#02","intervention.judgment-of-scars.v1#01","attack.star-breaker.v1#01","intervention.careful-redraw.v1#01","field.frenzied-fracture.v1#01","intervention.verdant-bargain.v1#02","intervention.judgment-of-scars.v1#03"],"P2":["field.frenzied-fracture.v1#02","field.root-sanctuary.v1#02","intervention.oath-of-renewal.v1#01","attack.star-breaker.v1#02","intervention.field-nullification.v1#01","field.root-sanctuary.v1#03","attack.steadfast-strike.v1#01"]},"drawPile":["attack.steadfast-strike.v1#03","intervention.verdant-bargain.v1#03","defense.ashen-bulwark.v1#03","intervention.oath-of-renewal.v1#03","intervention.careful-redraw.v1#03","attack.rift-pebble.v1#01","defense.guardian-veil.v1#03","field.root-sanctuary.v1#01","intervention.field-nullification.v1#02","intervention.careful-redraw.v1#02","intervention.oath-of-renewal.v1#02","attack.rift-pebble.v1#03","intervention.verdant-bargain.v1#01","intervention.judgment-of-scars.v1#02","attack.steadfast-strike.v1#02","defense.ashen-bulwark.v1#01","defense.guardian-veil.v1#02","field.frenzied-fracture.v1#03","attack.star-breaker.v1#03","defense.ashen-bulwark.v1#02","defense.guardian-veil.v1#01","intervention.field-nullification.v1#03"],"discardPile":[],"revealedCards":[]}
~~~

G01の最終カード領域は、P2が最初の手番開始時に山札の先頭を引き、attack.steadfast-strike.v1#01を使って捨て札へ移した後の次のJSONである。これをPOST_G01_ALPHA_12_V1と呼ぶ。

~~~json
{"hands":{"P1":["attack.rift-pebble.v1#02","intervention.judgment-of-scars.v1#01","attack.star-breaker.v1#01","intervention.careful-redraw.v1#01","field.frenzied-fracture.v1#01","intervention.verdant-bargain.v1#02","intervention.judgment-of-scars.v1#03"],"P2":["field.frenzied-fracture.v1#02","field.root-sanctuary.v1#02","intervention.oath-of-renewal.v1#01","attack.star-breaker.v1#02","intervention.field-nullification.v1#01","field.root-sanctuary.v1#03","attack.steadfast-strike.v1#03"]},"drawPile":["intervention.verdant-bargain.v1#03","defense.ashen-bulwark.v1#03","intervention.oath-of-renewal.v1#03","intervention.careful-redraw.v1#03","attack.rift-pebble.v1#01","defense.guardian-veil.v1#03","field.root-sanctuary.v1#01","intervention.field-nullification.v1#02","intervention.careful-redraw.v1#02","intervention.oath-of-renewal.v1#02","attack.rift-pebble.v1#03","intervention.verdant-bargain.v1#01","intervention.judgment-of-scars.v1#02","attack.steadfast-strike.v1#02","defense.ashen-bulwark.v1#01","defense.guardian-veil.v1#02","field.frenzied-fracture.v1#03","attack.star-breaker.v1#03","defense.ashen-bulwark.v1#02","defense.guardian-veil.v1#01","intervention.field-nullification.v1#03"],"discardPile":["attack.steadfast-strike.v1#01"],"revealedCards":["attack.steadfast-strike.v1#01"]}
~~~

### 2.5 ゴールデン試験の共通最終項目

三つの試験のハッシュ入力では、個別に記載がない限り、次を固定する。

~~~text
stateHashVersion: state-hash.alpha-12.v1
engineVersion: game-core.alpha-12.v1
rngAlgorithmVersion: rng.xoshiro128ss.v1
shuffleAlgorithmVersion: shuffle.fisher-yates-desc.v1
seed: 123456789abcdef00fedcba987654321
randomConsumptionCount: 36
activeField: null
activePlayerId: null
pendingAction: null
effectQueue: []
roundNumber: 1
turnSequence: 1
players.maxHitPoints: 30
players.survivedRoundCount: 1
players.effectiveWorldRestore: 0
players.hand: cardZones.handsと同じ配列
judgment.playerScores: 最終状態欄に記載した値
~~~

G01のstatusEffectsはfragileWorld=false、nextDefensePenalty=0とする。G02は両者のfragileWorld=true、P1のnextDefensePenalty=2、P2のnextDefensePenalty=0とする。G03は両者のfragileWorld=true、nextDefensePenalty=0とする。

### 2.6 変更検出

体力、手札順、山札先頭、世界責任、発生済み境界、randomConsumptionCountを一つだけ変更したコピーは、すべてハッシュが変わらなければならない。表示名やイベント表示文だけの変更では、ハッシュを変えない。

## 3. Golden G01：通常撃破

### 3.1 開始状態

G01は、P0-05の固定種で配札し、P2の最初の手番開始時の補充を終えた状態から始める。通常の初期体力だけでは一枚で撃破できないため、ルールエンジンの通常撃破終端を検査する準備済み状態としてP1の体力を6へ設定する。

~~~text
goldenMatchId: golden-g01-normal-defeat
initialStateMode: PREPARED_POST_SETUP
seed: 123456789abcdef00fedcba987654321
rngAlgorithmVersion: rng.xoshiro128ss.v1
shuffleAlgorithmVersion: shuffle.fisher-yates-desc.v1
randomConsumptionCount: 36
initialPlayerOrder: [P1, P2]
firstPlayerId: P2
phase: ACTION_SELECTION
revision: 0
roundNumber: 1
turnSequence: 1
activePlayerId: P2
P1.hp: 6
P2.hp: 30
world.durability: 100
world.triggeredThresholds: []
cardZonesRef: POST_SETUP_ALPHA_12_V1 after P2 first-turn draw
~~~

### 3.2 受理操作とイベント

~~~text
1. PLAY_CARD(commandId=g01-command-001, playerId=P2, expectedRevision=0,
   cardInstanceId=attack.steadfast-strike.v1#01, playMode=RELEASE, targetPlayerId=P1)
2. ACCEPT_DAMAGE(commandId=g01-command-002, playerId=P1, expectedRevision=1)

expectedEventTypes:
COMMAND_ACCEPTED, CARD_PLAYED, RESPONSE_ACCEPTED,
DAMAGE_PLAYER_APPLIED(amount=6,target=P1), PLAYER_DEFEATED(playerId=P1),
JUDGMENT_COMPUTED, MATCH_FINISHED
~~~

### 3.3 最終状態とハッシュ

~~~text
phase: FINISHED
revision: 2
P1.hp: 0
P2.hp: 30
world.durability: 100
world.triggeredThresholds: []
worldCollapsed: false
defeatedPlayerIds: [P1]
battleWinnerId: P2
divineSelectionWinnerId: P2
P1.score: 2
P2.score: 72
cardZonesRef: POST_G01_ALPHA_12_V1
stateHashVersion: state-hash.alpha-12.v1
stateHash: 5a71a8de1fc13516e5494ddd1f4a2c3f35ab4303291dd541cc7cd46b4c98283c
~~~

### 3.4 G01の採点

P1はsurvivedRoundCount=1で体力0のため2点、P2はsurvivedRoundCount=1、体力30、生存ボーナス40で72点となる。

## 4. Golden G02：世界崩壊

### 4.1 開始状態と試験用効果キュー

G02は、P0-03のX03と同じ内部試験である。GOLDEN_EFFECT_QUEUE_RESOLVEは公開命令ではない。

~~~text
goldenMatchId: golden-g02-world-collapse
initialStateMode: ENGINE_PRECONDITION
seed: 123456789abcdef00fedcba987654321
rngAlgorithmVersion: rng.xoshiro128ss.v1
shuffleAlgorithmVersion: shuffle.fisher-yates-desc.v1
randomConsumptionCount: 36
phase: RESOLUTION
revision: 0
roundNumber: 1
turnSequence: 1
P1.hp: 30
P2.hp: 30
world.durability: 80
world.triggeredThresholds: []
cardZonesRef: POST_SETUP_ALPHA_12_V1

commandType: GOLDEN_EFFECT_QUEUE_RESOLVE
commandId: g02-command-001
sourceKind: SYSTEM
effects: DAMAGE_PLAYER(target=P2,amount=30) -> DAMAGE_WORLD(sourceOwner=P1,amount=80)
~~~

世界80から0へ下がるため、75、50、25を順に発生済みへ追加する。75はP1へ次の防御ペナルティ2を付け、50は実効世界再生者がいないため追加ドローを起こさない。25は次の世界損傷カードへ有効になる。

### 4.2 最終状態とハッシュ

~~~text
expectedEventTypes:
COMMAND_ACCEPTED, DAMAGE_PLAYER_APPLIED(amount=30,target=P2), PLAYER_DEFEATED(playerId=P2),
DAMAGE_WORLD_APPLIED(requested=80,effective=80,owner=P1),
WORLD_THRESHOLD_TRIGGERED(75), WORLD_THRESHOLD_TRIGGERED(50), WORLD_THRESHOLD_TRIGGERED(25),
WORLD_LAW_EFFECT_APPLIED(75,target=P1,penalty=2),
WORLD_LAW_EFFECT_APPLIED(50,target=none,draw=0), WORLD_LAW_EFFECT_APPLIED(25,target=none),
WORLD_COLLAPSED, JUDGMENT_COMPUTED, MATCH_FINISHED

phase: FINISHED
revision: 1
P1.hp: 30
P2.hp: 0
P1.worldDamageResponsibility: 80
P2.worldDamageResponsibility: 0
world.durability: 0
world.triggeredThresholds: [75, 50, 25]
P1.nextDefensePenalty: 2
P1.fragileWorld: active
P2.fragileWorld: active
worldCollapsed: true
defeatedPlayerIds: [P2]
battleWinnerId: P1
divineSelectionWinnerId: P2
P1.score: -193
P2.score: 2
cardZonesRef: POST_SETUP_ALPHA_12_V1
stateHashVersion: state-hash.alpha-12.v1
stateHash: 3fb02be15bc2ea4aaa4b6f4044381de3d5eaeb752124f1becd9b28ccf7b3e46b
~~~

P1は戦闘上の生存者だが、世界を80損傷させたため、世界損傷の減点と破界責任25を受ける。その結果、戦闘では敗れたP2が神の選定者になる。

## 5. Golden G03：反射を含む同時終了

### 5.1 開始状態と試験用効果キュー

G03は、初期12種類のカード展開では使わないREFLECT_DAMAGEを、効果命令の登録処理として検査する。反射への再応答は開かない。

~~~text
goldenMatchId: golden-g03-simultaneous-reflection
initialStateMode: ENGINE_PRECONDITION
seed: 123456789abcdef00fedcba987654321
rngAlgorithmVersion: rng.xoshiro128ss.v1
shuffleAlgorithmVersion: shuffle.fisher-yates-desc.v1
randomConsumptionCount: 36
phase: RESOLUTION
revision: 0
roundNumber: 1
turnSequence: 1
P1.hp: 10
P2.hp: 10
world.durability: 30
world.triggeredThresholds: []
cardZonesRef: POST_SETUP_ALPHA_12_V1
pendingAttackId: golden-g03-attack

commandType: GOLDEN_EFFECT_QUEUE_RESOLVE
commandId: g03-command-001
sourceKind: SYSTEM
effects: DAMAGE_PLAYER(target=P2,amount=10) -> REFLECT_DAMAGE(target=P1,amount=10,pendingAttackId=golden-g03-attack) -> DAMAGE_WORLD(sourceOwner=P1,amount=30)
~~~

### 5.2 最終状態とハッシュ

~~~text
expectedEventTypes:
COMMAND_ACCEPTED, DAMAGE_PLAYER_APPLIED(amount=10,target=P2),
REFLECT_DAMAGE_APPLIED(amount=10,target=P1), PLAYER_DEFEATED(playerId=P1),
PLAYER_DEFEATED(playerId=P2), DAMAGE_WORLD_APPLIED(requested=30,effective=30,owner=P1),
WORLD_THRESHOLD_TRIGGERED(25), WORLD_LAW_EFFECT_APPLIED(25,target=none),
WORLD_COLLAPSED, JUDGMENT_COMPUTED, MATCH_FINISHED

phase: FINISHED
revision: 1
P1.hp: 0
P2.hp: 0
P1.worldDamageResponsibility: 30
P2.worldDamageResponsibility: 0
world.durability: 0
world.triggeredThresholds: [25]
P1.fragileWorld: active
P2.fragileWorld: active
worldCollapsed: true
defeatedPlayerIds: [P1, P2]
battleWinnerId: null
divineSelectionWinnerId: P2
P1.score: -113
P2.score: 2
cardZonesRef: POST_SETUP_ALPHA_12_V1
stateHashVersion: state-hash.alpha-12.v1
stateHash: e627f69a3bf8c319570f7645a6b059926468c8f61c71136b08aed55187ba9577
~~~

両者の体力が0なので戦闘は引き分けである。ただし、P1が世界を30損傷させたため、神の評価はP2が上回る。世界崩壊と同時死亡は、どちらか一方へ潰さず、両方の終端フラグを保存する。

## 6. 再生時の合格条件

各試験は、次をすべて満たしたときだけ合格とする。

1. rulesetId、catalogHash、乱数版、シャッフル版、種が一致する。
2. 受理された命令列が一致する。
3. 各revisionの状態要約が一致する。
4. expectedEventTypesの順番が一致する。
5. 最終状態ハッシュが完全一致する。
6. 不正命令や同じ命令の再送で、乱数消費数と状態が変わらない。
7. G02、G03の試験用効果キューを、公開クライアント命令として受理しない。

ハッシュが一致してもイベント順が違う場合は合格にしない。逆にイベント順だけが一致してハッシュが違う場合も合格にしない。

## 7. P0-06完了判定

- [x] 通常撃破、世界崩壊、反射を含む同時終了の3ケースを定義した。
- [x] P0-05の種、乱数版、シャッフル版、初期カード領域を各ケースへ接続した。
- [x] SHA-256、UTF-8、キー順、配列順、除外項目を固定した。
- [x] 最終状態へ含める体力、責任、境界、終端フラグ、採点を固定した。
- [x] 各ケースの期待イベント順を固定した。
- [x] 各ケースの最終状態ハッシュを固定した。
- [x] 反射と複数境界は、初期12種類のクライアントカードではなく、ルール命令試験として区別した。
- [x] ハッシュ変更検出と、不正命令・再送時の乱数非消費を定義した。

P0-06は完了とする。P0-01〜P0-06の仕様固定が終わったため、次はP1-01「純粋なstate / command基盤」へ進む。P1では、画面、通信、保存、CPUをまだ混ぜない。
