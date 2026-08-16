# 選ばれたん：P4-02 シミュレーション指標 V1

- 文書状態：現行・P4-02実装契約
- 対象：ruleset alpha-12のCPU対CPU反復試験
- 上位文書：[実装実行計画 V1](15_IMPLEMENTATION_EXECUTION_PLAN_V1.md)
- 前工程：[CPU合法手生成 V1](32_CPU_LEGAL_ACTIONS_V1.md)

## 1. 目的

P4-02は、固定済みのruleset・カード定義・世界律を変更せず、同じseedからCPU対CPUの試合を反復し、P4.2で指定された観測値を再現可能な記録へまとめる。

この工程ではカード威力、条件、複製枚数、採点係数を調整しない。偏りが見つかった場合は、P4-03の別変更として扱う。

## 2. API

```ts
runAlpha12Simulation({
  seeds: readonly string[],
  matchIdPrefix?: string,
  maxStepsPerMatch?: number,
})
```

返却値は次を含む。

- `simulationVersion`
- `rulesetId`
- `cpuPolicyId`
- `matches`: 試合ごとの記録
- `metrics`: 試合記録からの集計値

標準方針IDは`public-greedy-v1`である。seedは呼び出し側が与え、各試合のIDは`<matchIdPrefix>.<4桁連番>`で決定する。標準の最大ステップ数は4096で、超過・未受理command・終了種別の欠落は測定値へ混ぜずエラーにする。

## 3. CPUの公開情報境界

各手番で次の順に処理する。

```text
authoritative GameState
  ↓ projectPublicState(本人)
本人向け PublicGameState
  ↓ enumerateAlpha12CpuActions
合法候補
  ↓ public-greedy-v1
1候補を選択
  ↓ materialize command
既存の alpha-12 executor
```

方針が参照できるのは、本人向け`PublicGameState`、公開カード定義、合法候補だけである。相手手札、山札順、seed、未使用乱数、command履歴、効果キュー、状態ハッシュを方針へ渡さない。

`public-greedy-v1`は、候補を次の公開値で比較する小さな決定的評価である。

- 降参は常に最後
- 応答カードは受けるより優先する
- 解放は通常優先するが、世界耐久が75以下では抑制を強めに評価する
- 世界損傷カードは世界耐久50以下、25以下の順に減点する
- 世界再生カードは世界耐久が低いほど加点する
- 自分の公開HPが低い場合は再生の誓約を加点する
- 同点はP4-01の合法候補順を維持する

評価係数や優先順位を変更した場合は、新しいCPU方針IDを付ける。

## 4. 試合ループ

- `TURN_START`では`resolveTurnStart`を呼ぶ
- 手札超過中は`DISCARD_OVERFLOW`を候補から選ぶ
- `TURN_END`では`finalizeTerminalState`を先に確認し、未終端なら`advanceToNextTurnStart`で次の手番へ進める
- `ACTION_SELECTION`ではactive playerの本人向け公開状態を使う
- `RESPONSE_SELECTION`ではresponding playerの本人向け公開状態を使う
- カード解決後にexecutorが次の`TURN_START`へ進めた場合、シミュレーション側で二重に進めない
- `TIMEOUT_DEFAULT_ACTION`は使用しない
- 終端後は`hashGameState`と`summarizeMatch`で記録を検証する

P4-02の反復で、応答を持たない直接ダメージカードが`AFTER_RESPONSE_MODIFIERS`として停止する既存テンプレート不整合を検出した。`intervention.judgment-of-scars.v1`だけは応答待ちを生成しないため、直接ダメージの実行時点を`IMMEDIATE`へ訂正した。これは数値・条件・採点の変更ではない。

## 5. 試合単位の記録

### 5.1 再現情報

- `matchIndex`
- `matchId`
- `seed`
- `rulesetId`
- `cpuPolicyId`
- `endKind`
- `finalStateHash`
- `firstPlayerId`

### 5.2 ラウンドと世界境界

- `finalRoundNumber`: 終端`GameState.roundNumber`そのもの
- `rounds`: 完了したラウンド数。`min(max(finalRoundNumber - 1, 0), maxRounds)`
- `thresholdRounds.75 / 50 / 25`: `world.triggeredThresholds`へ初めて追加された時点の`roundNumber`。未到達は`null`
- `worldCollapsed`: `terminalFlags.worldCollapsed`
- `maxRoundsReached`: `terminalFlags.maxRoundsReached`

最大ラウンドの終端では、内部の`finalRoundNumber`が`maxRounds + 1`になり得るため、表示・集計用の`rounds`と分けて保持する。

### 5.3 行動・カード

- `playedCardCount`: `PLAY_CARD`の受理数
- `cardUseCount`: `PLAY_CARD`と`SELECT_RESPONSE`の受理数
- `releaseCount` / `restrainCount`: `PLAY_CARD`のmode別受理数
- `cardUsage`: カード定義IDごとの使用数。率の分母は`cardUseCount`
- `discardForActionCount`: `DISCARD_FOR_ACTION`の受理数
- `actionDecisionCount`: `PLAY_CARD + DISCARD_FOR_ACTION`。`SURRENDER`、`DISCARD_OVERFLOW`、応答は含めない

### 5.4 審定と誓約

- `battleWinnerId` / `divineSelectionWinnerId`: 終端状態の値をそのまま記録
- `firstPlayerDivineSelectionRate`: 通常終了かつ選定者が存在する試合のうち、選定者が先攻だった割合
- `battleDivineAgreementRate`: 通常終了かつ戦闘勝者・選定者の両方が存在する試合のうち、IDが一致した割合
- `oathOfRenewalUseCount`: 誓約を使用した`(matchId, playerId)`の組数
- `oathOfRenewalSurvivalCount`: その組のうち、終端HPが正だった組数
- `oathOfRenewalUseRate`: 1回以上誓約を使用した試合数 / 全試合数
- `oathOfRenewalSurvivalRate`: `oathOfRenewalSurvivalCount / oathOfRenewalUseCount`

## 6. 集計率と0件の扱い

世界崩壊率、最大ラウンド率、解放率、抑制率、カード使用率、先攻選定率、戦闘勝者・選定者一致率、誓約使用率、誓約使用後生存率、`DISCARD_FOR_ACTION`率を集計する。

分母が0の率は`0`ではなく`null`とする。これにより「発生しなかった」のか「比較可能な試行がなかった」のかを区別できる。

同時に世界崩壊と最大ラウンドへ到達した場合は、それぞれのカウントへ1件ずつ加える。終端種別は終端状態の`endKind`をそのまま数える。

## 7. P4-03との境界

この実装は次を変更しない。

- カード威力、カード条件、カード複製枚数
- HP、世界耐久、閾値、最大ラウンド
- 世界律の効果
- judgment・terminal処理
- CPUへ渡す情報境界
- オンライン通信、保存、UI

P4-02の成果物は、seedごとの最終状態ハッシュと指標である。数値調整やカード追加は、この記録を根拠に別のP4-03変更として判断する。
