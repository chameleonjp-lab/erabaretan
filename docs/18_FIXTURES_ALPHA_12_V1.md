# エラバレタン：alpha-12 Fixture仕様 V1

- 文書状態：P0-03 正本・実装前検証値
- 更新日：2026-08-14
- fixtureSetId：fixture.alpha-12.v1
- 対象rulesetId：ruleset.alpha-12.v1
- 対象worldLawId：world-law.primordial-fracture.v1
- 関連文書：[初期12種類カード仕様 V1](16_INITIAL_12_CARD_SPEC_V1.md)
- 関連文書：[ruleset alpha-12 と砕けゆく原初界 V1](17_RULESET_ALPHA_12_V1.md)
- 関連文書：[共通効果命令の正式型 V1](19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)
- 関連文書：[決定的乱数生成器と固定試験値 V1](20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)
- 関連契約：[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)

## 1. この文書の役割

この文書は、最初の12種類を実装する前に、ルールエンジンへ渡す入力と、必ず一致させる結果を固定する。画面の表示や通信の試験ではなく、同じ初期状態と同じ受理操作から同じ状態へ到達することを確認する。

通常の動きを確認する6件をFixture A〜F、境界条件や不正入力を確認する14件をFixture X01〜X14とする。

この文書でいう「期待結果」は、少なくとも次を含む。

- 受理または拒否された操作
- 効果の処理順
- 体力、世界耐久、責任、手札、フィールドの最終値
- 発生済み境界、終端フラグ、採点
- 不正入力で状態が変わらないこと

数値は整数だけを使う。表示名、端末時刻、通信到着順、描画フレーム数は結果へ入れない。

## 2. Fixtureの実行方法

### 2.1 開始点

各Fixtureは、SETUPと初期配札が終わった直後の状態、またはその状態から切り出した正当な途中状態から開始する。山札のシャッフルそのものは試験対象にしない。

そのため、次の値を固定する。

~~~text
fixtureSetId: fixture.alpha-12.v1
rulesetId: ruleset.alpha-12.v1
worldLawId: world-law.primordial-fracture.v1
catalogHash: catalog.alpha-12.v1
rngAlgorithmVersion: fixture-no-rng.v1
shuffleAlgorithmVersion: fixture-prepared-deck.v1
randomConsumptionCount: 0
~~~

catalogHashはこの文書内でカード正本を識別するための固定名である。暗号学的なハッシュ化はP0-06で定義し、本番シャッフルの固定値は[決定的乱数正本](20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)で定義する。

### 2.2 状態の省略表記

カード実体IDは、カード種類と区別できる固有値を使う。例としてp1-rift-01は、プレイヤー1の手札にある「裂け目の礫」の1枚を表す。

手札のfiller-*は、カード種類を選択しない検証用の有効なカード実体である。指定がない限りattack.steadfast-strike.v1として扱い、山札・手札・捨て札の二重配置を起こさない。

drawPileTopは山札の一番上を表す。opaqueRemainingCountは、今回の操作で引かない残りのカードを省略した数であり、全36枚の合計を保つために使う。

Fixtureの実装では、省略カードにも実体IDを割り当てる。省略は秘密情報の公開を意味しない。

### 2.3 revisionと手番

- 外部から受理した命令1件につきrevisionを1増やす。
- Fixture専用のAUTO_ADVANCEを実行した場合も、状態が変われば1増やす。
- 内部効果1件ごとにはrevisionを増やさない。
- 拒否された命令と同じcommandIdの再送では、revisionを増やさない。
- turnSequenceは手番が変わるたびに1増やす。初期値は1とする。
- roundNumberは先攻と後攻の手番が完了した時点で次へ進む。

### 2.4 操作の記法

実際のクライアントが送る操作は、次の形で表す。

~~~text
{
  commandId,
  playerId,
  expectedRevision,
  commandType,
  payload
}
~~~

使用するcommandTypeは、PLAY_CARD、SELECT_RESPONSE、ACCEPT_DAMAGE、DISCARD_FOR_ACTION、SURRENDERとする。

AUTO_ADVANCEは、TURN_STARTなど入力を必要としない段階をテストハーネスから進めるためだけに使う。本番クライアントの命令には含めない。

### 2.5.1 保留中攻撃と応答の処理

攻撃カードのプレイヤーへのダメージは、応答選択が終わるまで保留中攻撃として保持する。防御カードの盾、緑の取引の軽減、その他の応答による修正を適用してから、実効ダメージを体力へ入れる。

一方、世界への効果はカード定義と応答定義の記載順を保つ。したがって、裂け目の礫で50境界を越えた後に緑の取引を使う場合は、世界損傷、境界発生、応答による世界再生、50境界反応の順になる。プレイヤーへの攻撃ダメージだけは、応答の軽減・盾を反映した後に確定する。

### 2.5 期待イベント

イベント名は、最終実装で文字列を変更しても意味を変えないよう、次の分類で固定する。

~~~text
COMMAND_ACCEPTED
COMMAND_REJECTED
CARD_PLAYED
CARD_DISCARDED
RESPONSE_ACCEPTED
DAMAGE_PLAYER_APPLIED
PAY_HP_APPLIED
DAMAGE_WORLD_APPLIED
RESTORE_WORLD_APPLIED
WORLD_THRESHOLD_TRIGGERED
WORLD_LAW_EFFECT_APPLIED
FIELD_SET
FIELD_CLEARED
PLAYER_DEFEATED
WORLD_COLLAPSED
JUDGMENT_COMPUTED
MATCH_FINISHED
~~~

拒否イベントには、少なくともreasonCodeと、拒否前のrevisionを含める。

## 3. 共通の期待値

全Fixtureで、次の不変条件を確認する。

1. 体力は0〜30、世界耐久は0〜100の範囲に収まる。
2. 同じカード実体は、山札、手札、捨て札、場の複数箇所へ同時に存在しない。
3. 受理操作ごとにrevisionは増える。拒否操作では増えない。
4. 発生済みの世界境界は、回復後に再発生しない。
5. 世界責任の合計は、実際に減った世界耐久・増えた世界耐久と一致する。
6. 効果キューが32件を超えて正常終了しない。
7. FINISHED後に状態が変わらない。

## 4. Fixture A〜F：通常の検証

### Fixture A：先攻と後攻の最初の補充

**目的**：先攻の最初の手番だけ補充せず、後攻は最初の手番から1枚補充することを確認する。

**開始状態**

~~~text
fixtureId: A-first-draw-correction
phase: TURN_START
revision: 100
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=30, hand=[p1-filler-01..p1-filler-07], survivedRoundCount=1
P2: hp=30, hand=[p2-filler-01..p2-filler-07], survivedRoundCount=1
world: durability=100, triggeredThresholds=[]
drawPileTop: [draw-A-01, draw-A-02]
activeField: none
terminalFlags: all false
~~~

**操作**

1. AUTO_ADVANCEでP1のTURN_STARTを処理する。
2. P1がDISCARD_FOR_ACTION(p1-filler-01)を送る。
3. AUTO_ADVANCEでP2のTURN_STARTを処理する。

**期待する処理**

- 1ではカードを引かず、P1の手札は7枚のままACTION_SELECTIONへ進む。
- 2ではP1のカード1枚を捨て、次のP2手番へ進む。
- 3でP2だけdraw-A-01を引き、P2の手札は8枚になる。
- P1の手札は6枚、P2の手札は8枚、山札の先頭はdraw-A-02になる。

**最終確認**

~~~text
phase: ACTION_SELECTION
activePlayerId: P2
revision: 103
turnSequence: 2
P1.handCount: 6
P2.handCount: 8
P1.survivedRoundCount: 1
P2.survivedRoundCount: 1
world.durability: 100
~~~

### Fixture B：75境界と星砕き

**目的**：世界損傷、75境界、次の防御へのペナルティを、応答後に確定することを確認する。

**開始状態**

~~~text
fixtureId: B-world-75
phase: ACTION_SELECTION
revision: 200
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=30, hand=[p1-star-01], worldDamageResponsibility=0, effectiveWorldRestore=0
P2: hp=30, hand=[p2-filler-01], worldDamageResponsibility=0, effectiveWorldRestore=0
world: durability=79, triggeredThresholds=[]
activeField: none
drawPileTop: []
~~~

**操作**

1. P1がPLAY_CARD(p1-star-01, RELEASE, target=P2)を送る。
2. P2がACCEPT_DAMAGEを送る。

**期待するイベント順**

~~~text
COMMAND_ACCEPTED
CARD_PLAYED
RESPONSE_ACCEPTED
DAMAGE_PLAYER_APPLIED(amount=16, target=P2)
DAMAGE_WORLD_APPLIED(requested=7, effective=7, owner=P1)
WORLD_THRESHOLD_TRIGGERED(threshold=75)
WORLD_LAW_EFFECT_APPLIED(law=75, target=P1, penalty=2)
MATCH_FINISHED=false
~~~

**最終状態**

~~~text
phase: TURN_START
activePlayerId: P2
revision: 202
P1.hp: 30
P2.hp: 14
world.durability: 72
world.triggeredThresholds: [75]
P1.worldDamageResponsibility: 7
P2.worldDamageResponsibility: 0
P1.statusEffects.nextDefensePenalty: 2
P2.statusEffects.nextDefensePenalty: none
discardPile: [p1-star-01]
~~~

75境界の対象は、主カード処理だけでなく応答と付随効果が終わった時点で決める。今回はP1だけが世界損傷責任を持つため、P1が対象になる。

### Fixture C：再生の誓約と実効世界再生

**目的**：PAY_HPが通常ダメージではなく、体力支払いと世界再生を別々に処理することを確認する。

**開始状態**

~~~text
fixtureId: C-oath-of-renewal
phase: ACTION_SELECTION
revision: 300
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=8, hand=[p1-oath-01], worldDamageResponsibility=0, effectiveWorldRestore=0
P2: hp=30, hand=[p2-filler-01], worldDamageResponsibility=0, effectiveWorldRestore=0
world: durability=45, triggeredThresholds=[]
activeField: none
~~~

**操作**

1. P1がPLAY_CARD(p1-oath-01, RELEASE)を送る。

**期待するイベント順**

~~~text
COMMAND_ACCEPTED
CARD_PLAYED
PAY_HP_APPLIED(amount=4, target=P1, minimumRemainingHp=1)
RESTORE_WORLD_APPLIED(requested=7, effective=7, owner=P1)
MATCH_FINISHED=false
~~~

**最終状態**

~~~text
phase: TURN_START
activePlayerId: P2
revision: 301
P1.hp: 4
P2.hp: 30
world.durability: 52
world.triggeredThresholds: []
P1.effectiveWorldRestore: 7
P1.worldDamageResponsibility: 0
~~~

体力8から4へ減った理由はPAY_HPであり、盾、軽減、反射の対象ではない。世界は45から52へ増えたため、50境界は発生しない。

### Fixture D：50境界、応答再生、追加ドロー

**目的**：攻撃で50境界を越えた後、応答カードによる実効世界再生を最後の再生として採用し、応答者へ1枚を与えることを確認する。

**開始状態**

~~~text
fixtureId: D-world-50-green-response
phase: ACTION_SELECTION
revision: 400
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=30, hand=[p1-rift-01], worldDamageResponsibility=0, effectiveWorldRestore=0
P2: hp=30, hand=[p2-green-01, p2-filler-01], worldDamageResponsibility=0, effectiveWorldRestore=0
world: durability=52, triggeredThresholds=[]
activeField: none
drawPileTop: [draw-D-01]
~~~

**操作**

1. P1がPLAY_CARD(p1-rift-01, RELEASE, target=P2)を送る。
2. P2がSELECT_RESPONSE(p2-green-01)を送る。

**期待するイベント順**

~~~text
COMMAND_ACCEPTED
CARD_PLAYED
RESPONSE_ACCEPTED
REDUCE_INCOMING_DAMAGE(amount=3)
DAMAGE_PLAYER_APPLIED(amount=1, target=P2)
DAMAGE_WORLD_APPLIED(requested=2, effective=2, owner=P1)
WORLD_THRESHOLD_TRIGGERED(threshold=50)
RESTORE_WORLD_APPLIED(requested=4, effective=4, owner=P2)
WORLD_LAW_EFFECT_APPLIED(law=50, target=P2, draw=1)
DRAW_CARD(target=P2, card=draw-D-01)
~~~

**最終状態**

~~~text
phase: TURN_START
activePlayerId: P2
revision: 402
P1.hp: 30
P2.hp: 29
world.durability: 54
world.triggeredThresholds: [50]
P1.worldDamageResponsibility: 2
P2.worldDamageResponsibility: 0
P1.effectiveWorldRestore: 0
P2.effectiveWorldRestore: 4
P2.hand: [p2-filler-01, draw-D-01]
discardPile: [p1-rift-01, p2-green-01]
~~~

応答カードは使用されて手札からなくなるが、50境界の追加ドローは応答処理の後に行う。したがってP2の手札枚数は、応答前の2枚から1枚減り、追加ドローで2枚へ戻る。

### Fixture E：25境界と次の世界損傷カード

**目的**：25境界を越えたカード自身は自己損傷を受けず、その後の世界損傷カードだけが使用者へ2ダメージを返すことを確認する。

**開始状態**

~~~text
fixtureId: E-world-25-self-damage
phase: ACTION_SELECTION
revision: 500
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=30, hand=[p1-rift-01], worldDamageResponsibility=0, effectiveWorldRestore=0
P2: hp=30, hand=[p2-rift-01], worldDamageResponsibility=0, effectiveWorldRestore=0
world: durability=27, triggeredThresholds=[]
activeField: none
~~~

**操作**

1. P1がPLAY_CARD(p1-rift-01, RELEASE, target=P2)を送る。
2. P2がACCEPT_DAMAGEを送る。
3. P2がPLAY_CARD(p2-rift-01, RELEASE, target=P1)を送る。
4. P1がACCEPT_DAMAGEを送る。

**期待する結果**

- 1〜2で世界は27から25へ下がり、25境界が発生する。
- 1のP1には、脆い世界による自己損傷を加えない。
- 3〜4で世界は25から23へ下がる。
- 3のP2へ通常のDAMAGE_PLAYER(amount=2)を追加し、P2の体力は24になる。
- P1は最初の攻撃で4ダメージを受け、体力は26になる。
- P2は2枚の世界損傷カードを使ったので、世界損傷責任は合計4になる。

**最終状態**

~~~text
phase: TURN_START
activePlayerId: P1
revision: 504
P1.hp: 26
P2.hp: 24
world.durability: 23
world.triggeredThresholds: [25]
P1.worldDamageResponsibility: 2
P2.worldDamageResponsibility: 2
P1.statusEffects.fragileWorld: active
P2.statusEffects.fragileWorld: active
~~~

### Fixture F：通常撃破と神の評価

**目的**：世界を傷つけずに相手を倒した場合、戦闘勝者と神の選定者が一致し、初期採点式を計算できることを確認する。

**開始状態**

~~~text
fixtureId: F-normal-defeat-judgment
phase: ACTION_SELECTION
revision: 600
roundNumber: 1
turnSequence: 1
activePlayerId: P1
P1: hp=30, hand=[p1-steadfast-01], worldDamageResponsibility=0, effectiveWorldRestore=0, survivedRoundCount=1
P2: hp=6, hand=[p2-filler-01], worldDamageResponsibility=0, effectiveWorldRestore=0, survivedRoundCount=1
world: durability=100, triggeredThresholds=[]
activeField: none
~~~

**操作**

1. P1がPLAY_CARD(p1-steadfast-01, RELEASE, target=P2)を送る。
2. P2がACCEPT_DAMAGEを送る。

**期待するイベント順**

~~~text
COMMAND_ACCEPTED
CARD_PLAYED
RESPONSE_ACCEPTED
DAMAGE_PLAYER_APPLIED(amount=6, target=P2)
PLAYER_DEFEATED(playerId=P2)
JUDGMENT_COMPUTED
MATCH_FINISHED
~~~

**最終状態と採点**

~~~text
worldCollapsed: false
defeatedPlayerIds: [P2]
maxRoundsReached: false
battleWinnerId: P1
P1.score: 72  # 生存評価2 + 終了時体力30 + 生存ボーナス40
P2.score: 2   # 生存評価2のみ
divineSelectionWinnerId: P1
endKind: NORMAL
~~~

## 5. Fixture X01〜X14：敵対的検証

### X01：境界値ちょうどの判定

**目的**：変更前が境界より大きく、変更後が境界以下なら発生し、変更後が境界より上なら発生しないことを確認する。

**入力**

~~~text
phase: ACTION_SELECTION
activePlayerId: P1
world.durability: 77
world.triggeredThresholds: []
P1.hand: [p1-rift-01]
~~~

P1が裂け目の礫を解放する。世界は77から75へ下がる。

**期待結果**

~~~text
world.durability: 75
world.triggeredThresholds: [75]
events: DAMAGE_WORLD_APPLIED(effective=2), WORLD_THRESHOLD_TRIGGERED(75)
~~~

世界75から76へ戻っただけでは発生済み状態を変更しない。変更前が75のままなら、75境界を再発生させない。

### X02：回復後の境界再通過

**目的**：境界を発生済みにした後、回復して再び下がっても同じ境界を追加しないことを確認する。

**操作**

1. 世界77でP1が裂け目の礫を解放する。世界は75になる。
2. P2が緑の取引を応答し、世界を4再生する。世界は79になる。
3. P2が裂け目の礫を解放し、P1はACCEPT_DAMAGEを選ぶ。世界は77になる。
4. P1が裂け目の礫を解放し、P2はACCEPT_DAMAGEを選ぶ。世界は75になる。

**期待結果**

~~~text
world.durability: 75
world.triggeredThresholds: [75]
count(WORLD_THRESHOLD_TRIGGERED(threshold=75)): 1
P2.effectiveWorldRestore: 4
~~~

50と25も同じ規則で、回復後に再発生しない。

### X03：一つの効果キューで複数境界を越える

**目的**：世界80から20へ一度に下がる場合、75、50、25を一度ずつ、上から順に処理することを確認する。

これは12種類のカードだけでは一枚で60損傷を作れないため、カード命令の受理試験ではなく、ルールエンジンの効果キュー試験として実行する。DAMAGE_WORLDを直接クライアントから受け付ける意味ではない。

**入力**

~~~text
fixtureType: EFFECT_QUEUE
world.durability: 80
world.triggeredThresholds: []
effectQueue: [
  { type: DAMAGE_WORLD, requested: 60, ownerId: P1, source: fixture-x03 }
]
~~~

**期待結果**

~~~text
world.durability: 20
world.triggeredThresholds: [75, 50, 25]
eventOrder: [
  DAMAGE_WORLD_APPLIED,
  WORLD_LAW_EFFECT_APPLIED(75),
  WORLD_LAW_EFFECT_APPLIED(50),
  WORLD_LAW_EFFECT_APPLIED(25)
]
P1.worldDamageResponsibility: 60
P1.statusEffects.nextDefensePenalty: 2
P1.statusEffects.fragileWorld: active after the 25 reaction
worldCollapsed: false
~~~

25境界の自己損傷は、この同じDAMAGE_WORLDへ追加しない。25の反応が終わった後の次の世界損傷カードから有効にする。

### X04：世界損傷の上限と世界崩壊

**目的**：世界耐久6へ7損傷を与えても、実効損傷は6で止まり、世界が負数にならないことを確認する。

**入力と操作**

~~~text
world.durability: 6
world.triggeredThresholds: []
P1.hand: [p1-star-01]
P1: PLAY_CARD(p1-star-01, RELEASE, target=P2)
P2: ACCEPT_DAMAGE
~~~

**期待結果**

~~~text
world.durability: 0
P1.worldDamageResponsibility: 6
P1.worldCollapsePenalty: 25
worldCollapsed: true
world.durability < 0: false
defeatedPlayerIds: []
~~~

75、50、25は同じ解決単位で発生する。25境界の自己損傷は、世界0へ到達させた星砕き自身へ追加しない。

### X05：満タン世界への再生

**目的**：再生要求があっても世界が満タンなら、実効再生、再生責任、50境界の対象を発生させないことを確認する。

**入力と操作**

~~~text
world.durability: 100
world.triggeredThresholds: []
P1.hand: [p1-steadfast-01]
P2.hand: [p2-green-01]
P1: PLAY_CARD(p1-steadfast-01, RELEASE, target=P2)
P2: SELECT_RESPONSE(p2-green-01)
~~~

**期待結果**

~~~text
P2.hp: 27
world.durability: 100
P2.effectiveWorldRestore: 0
world.triggeredThresholds: []
count(RESTORE_WORLD_APPLIED(effective>0)): 0
~~~

緑の取引は使用されて捨て札へ移るが、実際に世界が増えていないため、P2を再生者として記録しない。

### X06：75境界の責任同率

**目的**：75境界の実行時点で世界損傷責任が同率なら、同率の全員へペナルティ1を付けることを確認する。

**入力と操作**

~~~text
world.durability: 80
P1.worldDamageResponsibility: 0
P2.worldDamageResponsibility: 3
P1.hand: [p1-star-01]
P2.hand: [p2-ashen-01]
P1: PLAY_CARD(p1-star-01, RELEASE, target=P2)
P2: SELECT_RESPONSE(p2-ashen-01)
~~~

星砕きの世界損傷7と、灰燼の城壁の世界損傷4を加える。P1は7、P2は3+4で7となり、最終世界は69になる。

**期待結果**

~~~text
P1.worldDamageResponsibility: 7
P2.worldDamageResponsibility: 7
world.durability: 69
world.triggeredThresholds: [75]
P1.statusEffects.nextDefensePenalty: 1
P2.statusEffects.nextDefensePenalty: 1
~~~

### X07：75境界ペナルティの保留と消費

**目的**：対象者が防御せずにダメージを受けた場合はペナルティを残し、次の防御カードへ適用した時点で消費することを確認する。

**操作**

1. 世界79でP1が星砕きを解放し、P2はACCEPT_DAMAGEを選ぶ。
2. 次のP2の攻撃へ、P1が守りの帳を応答する。

**期待結果**

~~~text
after_step_1:
  P1.statusEffects.nextDefensePenalty: 2
after_step_2:
  guardianVeilBaseDefense: 7
  appliedDefense: 5
  P1.statusEffects.nextDefensePenalty: none
  P1.hp: 29
~~~

ペナルティは攻撃側のダメージ、PAY_HP、世界再生へ適用しない。

### X08：50境界の追加ドローと山札切れ

**目的**：50境界の対象が決まっても、山札が空ならカードを作らず、境界反応の発生済み状態だけを消費することを確認する。

**入力と操作**

~~~text
world.durability: 52
drawPileTop: []
P2.hand: [p2-green-01]
P1: PLAY_CARD(p1-rift-01, RELEASE, target=P2)
P2: SELECT_RESPONSE(p2-green-01)
~~~

**期待結果**

~~~text
world.durability: 54
world.triggeredThresholds: [50]
P2.effectiveWorldRestore: 4
P2.handCount: 0  # 応答カードを使い、山札は空
drawAttemptedByWorldLaw50: true
drawnByWorldLaw50: 0
~~~

50境界の反応は再試行しない。後で山札が補充されても、同じ50境界から追加カードは発生しない。

### X09：25境界で実効損傷が0の場合

**目的**：25境界が有効でも、フィールド軽減後の実効世界損傷が0なら自己損傷を発生させないことを確認する。

**入力と操作**

~~~text
world.durability: 25
world.triggeredThresholds: [25]
worldLaw.fragileWorld: active
activeField: field.root-sanctuary.v1, expiresAfterTurnSequence=4
P1.hand: [p1-rift-01]
P2.hp: 30
P1: PLAY_CARD(p1-rift-01, RELEASE, target=P2)
P2: ACCEPT_DAMAGE
~~~

**期待結果**

~~~text
rootSanctuaryReduction: 2
requestedWorldDamage: 2
effectiveWorldDamage: 0
world.durability: 25
P1.worldDamageResponsibility: unchanged
P1.selfDamageFromFragileWorld: 0
P2.hp: 26
~~~

世界を傷つけていないため、脆い世界の自己損傷も起こらない。

### X10：25境界の自己損傷へ通常の盾を適用

**目的**：脆い世界の自己損傷が特別扱いされず、通常のDAMAGE_PLAYERとして盾を消費することを確認する。

**入力と操作**

~~~text
world.durability: 25
world.triggeredThresholds: [25]
worldLaw.fragileWorld: active
P1.hp: 30
P2.hp: 30
P1.statusEffects.shield: 1
P1.hand: [p1-rift-01]
P1: PLAY_CARD(p1-rift-01, RELEASE, target=P2)
P2: ACCEPT_DAMAGE
~~~

**期待結果**

~~~text
world.durability: 23
P1.worldDamageResponsibility: 2
fragileWorldSelfDamageRequested: 2
P1.statusEffects.shield: 0
P1.hp: 29
~~~

自己損傷の2は、盾1を適用した後に体力へ1だけ入る。PAY_HPではないため、盾を無視してはいけない。

### X11：フィールドの上書きと旧フィールドの終了

**目的**：フィールドは同時に1枚だけ有効で、新しいフィールドを置くと古いフィールドを直ちに終わらせ、旧フィールドの終了時効果を発生させないことを確認する。

**入力と操作**

~~~text
phase: ACTION_SELECTION
activePlayerId: P2
turnSequence: 2
activeField: field.frenzied-fracture.v1, ownerId=P1, expiresAfterTurnSequence=5
P2.hand: [p2-root-01]
P2: PLAY_CARD(p2-root-01, RELEASE)
~~~

**期待結果**

~~~text
events: [FIELD_CLEARED(old=frenzied), FIELD_SET(new=root)]
activeField.id: field.root-sanctuary.v1
activeField.ownerId: P2
activeField.expiresAfterTurnSequence: 5
count(oldFieldExpiryEffect): 0
world.durability: unchanged
~~~

### X12：無色の宣告は消したフィールドの軽減を受けない

**目的**：無色の宣告がフィールドを消してから世界へ損傷を与え、消した根守りの結界の軽減を使わないことを確認する。

**入力と操作**

~~~text
world.durability: 80
activeField: field.root-sanctuary.v1, ownerId=P2, expiresAfterTurnSequence=5
P1.hand: [p1-nullification-01]
P1: PLAY_CARD(p1-nullification-01, RELEASE)
~~~

**期待結果**

~~~text
eventOrder: [FIELD_CLEARED, DAMAGE_WORLD_APPLIED(requested=2, effective=2)]
world.durability: 78
P1.worldDamageResponsibility: 2
activeField: none
rootSanctuaryReductionUsed: false
~~~

### X13：重複命令と古いrevision

**目的**：同じcommandIdを再送しても二重実行せず、古いexpectedRevisionの新しい命令を拒否することを確認する。

**開始状態**

~~~text
phase: ACTION_SELECTION
revision: 1300
activePlayerId: P1
P1.hand: [p1-steadfast-01]
world.durability: 100
~~~

**操作**

1. c-x13-01、expectedRevision=1300でP1が堅実な一撃を使う。
2. P2がc-x13-02、expectedRevision=1301でACCEPT_DAMAGEを送る。
3. 同じc-x13-02を、同じ内容とexpectedRevision=1301で再送する。
4. c-x13-03を、expectedRevision=1301のまま送る。

**期待結果**

~~~text
step_1: COMMAND_ACCEPTED, revision=1301
step_2: COMMAND_ACCEPTED, revision=1302, damageAppliedCount=1
step_3: originalAcceptedResultReturned, revision=1302, damageAppliedCount=1
step_4: COMMAND_REJECTED(reasonCode=STALE_REVISION), revision=1302
~~~

同じカード実体が二度捨てられたり、P2の体力が二度減ったりしてはいけない。

### X14：不正な送信者、段階、カード条件

**目的**：クライアントの表示状態ではなく、ルール側で不正な命令を拒否し、状態を変更しないことを確認する。

次の各小ケースは、同じ正当な開始状態を複製して独立に実行する。

| 小ケース | 入力 | 期待する拒否理由 | 状態変更 |
|---|---|---|---|
| X14-a | 非手番P2がPLAY_CARD | NOT_ACTIVE_PLAYER | なし |
| X14-b | ACTION_SELECTIONでP1がSELECT_RESPONSE | INVALID_PHASE | なし |
| X14-c | P1が手札にないcardInstanceIdを使用 | CARD_NOT_IN_HAND | なし |
| X14-d | 体力4で再生の誓約を解放 | CONDITION_NOT_MET | なし |
| X14-e | 世界100で再生の誓約を解放 | CONDITION_NOT_MET | なし |
| X14-f | フィールドなしで無色の宣告を解放 | CONDITION_NOT_MET | なし |
| X14-g | 相手のカード実体でDISCARD_FOR_ACTION | CARD_NOT_IN_HAND | なし |
| X14-h | 応答者でない攻撃側がSELECT_RESPONSE | NOT_RESPONDING_PLAYER | なし |

各拒否では、revision、手札、山札、捨て札、体力、世界耐久、効果キューを開始値から変えない。拒否された命令は、リプレイの受理操作列へ含めない。

## 6. 期待結果の採点確認

Fixture F以外の途中状態では、画面に参考値を表示しても勝敗を確定しない。正常終了した場合だけ、次の式で最終値を計算する。

~~~text
生存評価 = survivedRoundCount × 2 + 終了時体力 + 生存ボーナス
世界評価 = effectiveWorldRestore × 2 - worldDamageResponsibility × 3 - 破界責任
神の評価 = 生存評価 + 世界評価
~~~

降参、切断敗北、サーバー中止、不正試合停止では、正式な神の選定者を設定しない。

## 7. P0-03の完了判定

- [x] Fixture A〜Fを定義した。
- [x] Fixture Aで先攻・後攻の最初の補充を定義した。
- [x] Fixture Bで75境界と次の防御ペナルティを定義した。
- [x] Fixture CでPAY_HPと実効世界再生を定義した。
- [x] Fixture Dで50境界、応答再生、追加ドローを定義した。
- [x] Fixture Eで25境界と自己損傷の開始時点を定義した。
- [x] Fixture Fで通常撃破と神の評価を定義した。
- [x] 敵対的Fixture X01〜X14を定義した。
- [x] 境界値、再発生、世界0、同率責任、実効値、手札・山札切れを確認した。
- [x] フィールド上書き、フィールド消去順、盾、revision、重複命令、不正入力を確認した。
- [x] 12種類のカードだけで作れない複数境界一括処理を、効果キュー単体試験として分離した。

P0-03は完了とする。共通効果命令の正式な入力型と出力型はP0-04の正本で固定し、決定的乱数と初期山札の固定値はP0-05の正本で固定した。次はP0-06「ゴールデン試合3件と最終状態ハッシュ」へ進む。P0-06が完了するまで、画面実装と通信実装は開始しない。
