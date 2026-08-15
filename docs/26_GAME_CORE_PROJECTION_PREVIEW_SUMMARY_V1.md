# エラバレタン：P1-05 公開状態投影・preview・summary V1

- 文書状態：P1-05 実装契約
- 更新日：2026-08-15
- 対象rulesetId：`ruleset.alpha-12.v1`
- 関連実装：`packages/game-core/src/public-state.ts`、`preview.ts`、`summary.ts`
- 関連content：`packages/content/src/setup/alpha-12-preview.ts`

## 1. 目的と境界

P1-05は、既存の決定性・状態ハッシュ・本番command処理を変更せず、画面や通信層が利用できる三つの純粋な境界を追加する。

- 公開状態投影：閲覧者ごとに秘密情報を除いた状態を返す
- command preview：本番相当のexecutorで確定差分だけを返す
- match summary：FINISHED状態から戦闘結果と神の選定結果を返す

`GameState`をそのまま返さない。`seed`、山札順、未使用乱数、command履歴、効果キュー、相手の手札内容は、いずれの公開APIにも含めない。

P1-05では`state-hash.alpha-12.v1`を維持し、GameStateへ新しいフィールドを追加しない。通信、保存、DOM、Canvas、時刻、乱数生成を実装範囲に含めない。

## 2. 公開状態投影

`projectPublicState(state, viewer)`は、`StateViewer`に応じた`PublicStateResult`を返す。

- `PLAYER`：指定したプレイヤーの手札だけ`cardInstanceId`と`cardDefinitionId`を返す
- `SPECTATOR`：全プレイヤーの手札内容を隠す
- 全閲覧者：各手札の枚数、山札の枚数、公開済みカード、体力、世界耐久、公開可能な進行状態を返す
- `pendingInteraction`は攻撃者、対象、公開攻撃カード、基礎ダメージまでとし、防御カードの有無・枚数を返さない
- `ruleset`の生オブジェクト、`pendingAction`、`effectQueue`、`commandHistory`、`drawOrder`、seedを返さない

公開カードの参照はカード実体のIDとカード定義IDだけであり、カード定義の秘密情報や内部状態を混ぜない。未知の閲覧者または不整合なカード参照は安全側のエラーにする。

## 3. command preview

`PreviewCommandIntent`は`commandId`と`expectedRevision`を持たない。preview側が内部用の一時的なcommand envelopeを生成し、実行後に破棄する。

previewは簡易なダメージ式を持たず、contentが渡す本番相当executorを使う。元の状態、履歴、revision、乱数消費数を変更しない。乱数消費が発生する実行は、カードの正体を推測可能な結果を返さず`UNAVAILABLE / RANDOM_DEPENDENT`にする。

公開される結果は全状態やeventではなく、次の安全な差分だけである。

- プレイヤーごとの体力差分
- プレイヤーごとの手札枚数差分
- 世界耐久差分
- 新たに越えた世界境界
- 処理後phase
- 試合終了見込み

攻撃が応答待ちで止まる場合は`PARTIAL / OPPONENT_RESPONSE`とし、相手の防御カードの有無・枚数・種類を返さない。山札や効果でカードの正体が確定しない場合は`HIDDEN_DRAW_IDENTITY`を付け、カード名を返さない。

閲覧者不一致、手札の存在確認、手番、phase、対象、条件、終了済み、時間切れ既定行動の失敗は、内部の詳細メッセージを外へ出さず、公開拒否コードへ正規化する。特に不存在カード・相手のカード・手札外カードは同じ`CARD_UNAVAILABLE`とする。

## 4. match summary

`summarizeMatch(state)`は`FINISHED`の最終状態だけを入力とする。event列だけでは採点の責任内訳を再現できないため、APIは最終GameStateを正本とする。

正常終了では`calculateJudgmentBreakdown`で採点を再計算し、保存済み`judgment`と一致することを確認する。不足・不整合はそれぞれ`JUDGMENT_MISSING`、`JUDGMENT_MISMATCH`として扱う。

summaryは次を含む。

- 終了種別と、同時に成立した通常終了理由（撃破、世界崩壊、最大ラウンド）
- 戦闘結果（勝者、引き分け、無効）
- 神の選定結果（選定、同点、対象外）
- scoreの授与状態
- プレイヤーごとのscore、survivalEvaluation、worldEvaluation
- 世界耐久、崩壊、崩壊責任者
- 世界損傷責任、実効世界再生、崩壊を起こしたか

降参・切断没収では戦闘勝者だけを返し、scoreと神の選定を授与しない。server abort・invalid matchは戦闘結果を`VOID`とする。seed、山札順、手札内容、hash、command履歴はsummaryに含めない。

## 5. 検証契約

- 既存のP1-04 golden fixture、状態ハッシュ、受理command列が変わらない
- own/opponent/spectatorの手札境界と公開zoneを検査する
- 秘密情報だけを変えた状態で公開投影とpreviewの公開結果が変わらないことを検査する
- previewを繰り返しても元stateのrevision、履歴、乱数消費数、hashが変わらない
- previewの確定差分が正式executorの結果と一致する
- 攻撃previewが相手の防御情報を漏らさない
- summaryの正常終了と非正常終了を検査する

P1-05完了後は、P2-01でFixture A〜Fの契約試験を拡張し、P2-02/P2-03で敵対的・不変条件・秘密情報試験を追加する。