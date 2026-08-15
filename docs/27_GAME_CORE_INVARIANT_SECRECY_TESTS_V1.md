# エラバレタン：P2-03 game-core 不変条件・秘密情報試験 V1

- 文書状態：P2-03 実装・検証記録
- 更新日：2026-08-16
- 対象rulesetId：`ruleset.alpha-12.v1`
- 対象engineVersion：`game-core.alpha-12.v1`
- 試験ファイル：`tests/game-core/p2-03-invariant-secrecy.test.mjs`

## 1. 目的

P2-02までで通常操作と敵対的な入力を確認した。P2-03では、状態の保存規則と公開情報の境界を、実装の内部状態を直接確認する試験として固定する。

## 2. 不変条件試験

次の規則を11件の契約試験で確認する。

- カード実体が常に一つの物理zoneにあり、総数が変わらない
- 体力と世界耐久が範囲内に収まる
- 不正な重複zone、逆順の境界、応答段階の不足を拒否する
- 効果キューは32件まで処理し、33件目は`EFFECT_QUEUE_LIMIT`として`INVALID_MATCH`にする
- 初期12種類の全カード・全modeが合法な効果キュー上限内で処理される
- `revealedCards`へ手札カードを混入させず、応答待ちのpendingAttack整合性を要求する
- `FINISHED`後の新しいcommandは状態を変更せず、受理済みcommandの再送は同じ結果を返す

受理遷移の後には、`assertGameState`、カード台帳、効果キュー、体力、世界耐久を確認する。

## 3. 公開情報と秘密情報

次の差分試験を行う。

- 相手の手札、山札順、seed、乱数消費数、command履歴、効果キューが公開状態へ含まれない
- 公開状態が同じで、相手手札の順序・防御カードの有無・山札順・seed・乱数消費数・履歴だけが異なる場合、公開状態が一致する
- 応答待ちで、相手が持つ防御カードの実体を攻撃側へ知らせない
- 同じ公開状態からのpreview結果が、秘密情報の差分で変わらない
- 山札から実際にカードを引くpreviewが`HIDDEN_DRAW_IDENTITY`を返し、山札順に依存しない
- 正常終了後のsummaryが、秘密情報の差分で変わらない
- previewが元のstate、状態hash、revisionを変更しない

## 4. P2-03の完了条件との対応

- A〜F、X01〜X14：既存のP2-01/P2-02試験で確認
- 同じseed・操作列の状態hash：既存のP1-04試験で確認
- previewと正式処理の確定部分：既存のP1-05試験とP2-03の純粋性試験で確認
- 公開状態同一時の秘密差分：P2-03で確認
- 効果キュー上限：P2-03で確認
- 通常操作から`INVALID_MATCH`へ遷移しないこと：command経路と上限超過の扱いを分離して確認

## 5. 検証結果

```text
npm run typecheck                         passed
npm test -- --test tests/game-core/*.test.mjs tests/content/*.test.mjs
96 tests passed
```

次はP3-01「同一端末の戦闘画面の縦切り版」へ進む。P2-03完了前に24種類へ増やさない方針は維持する。
