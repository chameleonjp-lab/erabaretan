# 選ばれたん：P4-01 CPU合法手生成 V1

- 文書状態：現行・P4-01実装契約
- 更新日：2026-08-16
- 対象：ruleset alpha-12のCPU候補手列挙
- 上位文書：[実装実行計画 V1](15_IMPLEMENTATION_EXECUTION_PLAN_V1.md)

## 1. 目的

P4-01では、高性能な意思決定や自動対戦の統計を作らない。

まず、CPUが本人に公開された情報だけを使い、現在のphaseで受理される候補を決定的に列挙できることを固定する。

```text
公開状態
  ↓
合法な選択肢の列挙
  ↓
commandId・revisionを付けたcommand化
  ↓
既存のproduction executorへ渡す
```

## 2. API境界

正本の列挙APIは次の通り。

```ts
enumerateAlpha12CpuActions(
  view: PublicGameState,
  playerId: PlayerId,
): readonly CpuActionIntent[]
```

`PublicGameState`は、その`playerId`自身の手札が公開されたプレイヤー向け投影でなければならない。手札が`null`の投影からは候補を返さない。

command化は列挙と分離する。

```ts
materializeAlpha12CpuCommand(
  action: CpuActionIntent,
  expectedRevision: number,
  commandId: string,
): Command
```

ローカル実行向けには、authoritativeな`GameState`を公開投影へ変換してから上の2段階を呼ぶ`generateAlpha12CpuLegalCommands`を用意する。合法手の判断自体は`GameState`の秘密領域を読まない。

## 3. CPUが使ってよい情報

### 3.1 使ってよいもの

- 自分の`PublicHand.cards`
- 自分のカード定義と公開されたカード定義
- phase、active player、responding player
- 自分と相手のHP
- 相手の公開された世界損傷責任
- 世界耐久、世界境界、公開フィールド
- 応答待ちの公開情報
- 公開ruleset値の手札上限

### 3.2 使ってはいけないもの

- 相手の手札のカード名、順序、存在
- 山札の順序、未公開カードの内容
- seed、未使用乱数、乱数消費数
- command履歴、効果キュー内部、状態ハッシュ用の秘密情報
- 相手の防御カードを推測した結果を合法性判定へ混ぜること

previewの`READY`かどうかは合法性の正本にしない。実ドローを伴うカードは秘密の山札内容によってpreviewが`UNAVAILABLE`になり得るが、カード条件を満たす限り合法候補として列挙する。

## 4. phase別の列挙範囲

| phase | 列挙する候補 |
|---|---|
| `ACTION_SELECTION` | 自分の各手札の合法な`RELEASE` / `RESTRAIN`、必要な相手対象、`careful-redraw`の各捨て札候補、各手札の`DISCARD_FOR_ACTION`、`SURRENDER` |
| `RESPONSE_SELECTION` | 合法な各`SELECT_RESPONSE`、`ACCEPT_DAMAGE`、`SURRENDER` |
| `TURN_START` | 手札上限を超えている場合の各`DISCARD_OVERFLOW` |
| その他 | 空配列 |

`TIMEOUT_DEFAULT_ACTION`は期限管理側が使うシステム操作であり、CPUの選択肢には含めない。`SURRENDER`はルール上の合法なプレイヤーcommandなので候補集合へ含めるが、通常方針で選ぶかはP4-02の評価・方針側で決める。

カード条件は初期12種類の共通validatorと同じ契約を、公開状態用の入力へ適用する。条件をCPU専用に再定義しない。

## 5. 決定性

列挙順は次の比較順で固定する。

1. command種別順位
2. `cardInstanceId`のUTF-8バイト順
3. mode
4. target player
5. 補助的な捨て札カード

command化時の`expectedRevision`は列挙元の公開状態revisionと一致させる。ローカル補助APIのcommandIdは次の形式とする。

```text
cpu.<playerId>.r<revision>.a<4桁ordinal>
```

同じ公開状態から再列挙した場合、選択内容、順序、revision、commandIdが一致する。

## 6. 完了条件

- 全候補がproduction command validatorで受理される
- 全候補をproduction executorへ渡せる
- 応答、手札超過、`careful-redraw`の全補助選択を列挙できる
- 非入力phaseで候補を返さない
- 同じ公開状態で候補順が変わらない
- 相手手札、山札、seed、乱数、履歴だけを変えても候補列が変わらない
- P4-02の評価関数、試合ループ、seed反復、統計収集、バランス調整を含めない

