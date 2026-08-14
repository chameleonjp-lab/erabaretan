# エラバレタン：game-core state / command基盤 V1

- 文書状態：P1-01 正本・基盤実装
- 更新日：2026-08-14
- 対象rulesetId：`ruleset.alpha-12.v1`
- 対象engineVersion：`game-core.alpha-12.v1`
- 上位文書：[実装実行計画 V1](15_IMPLEMENTATION_EXECUTION_PLAN_V1.md)、[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)
- P0正本：[初期12種類カード仕様](16_INITIAL_12_CARD_SPEC_V1.md)、[ruleset仕様](17_RULESET_ALPHA_12_V1.md)、[共通効果命令](19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)、[決定的乱数](20_DETERMINISTIC_RNG_AND_FIXED_VECTORS_V1.md)、[ゴールデン試合](21_GOLDEN_MATCHES_AND_STATE_HASHES_V1.md)

## 1. この文書の役割

P1-01で、画面、通信、保存先、時刻、乱数へ依存しない`GameState`と、外部から受け取るcommandの型・検証・冪等受理を固定する。

この段階では、カードの効果計算、世界境界、採点、リプレイハッシュ、公開状態への投影を実装しない。これらはP1-02〜P1-05で、P1-01のstateとcommand境界を使って追加する。

## 2. 実装境界

```text
packages/game-core/src/
├─ state/
│  ├─ types.ts              GameState、card zone、pending action、終端フラグ
│  ├─ rules.ts              alpha-12のrulesetスナップショット
│  ├─ create-initial-state.ts  準備済み試合状態の生成
│  └─ invariants.ts         状態不変条件とcard zone整合性
├─ commands/
│  ├─ types.ts              7種類の外部command型
│  └─ validate.ts           JSON入力の形、phase、revision、権限、手札の検証
├─ reduce-command.ts        純粋なcommand受理と基礎状態遷移
└─ index.ts                 公開API
```

実装は`Math.random()`、`Date.now()`、DOM、Canvas、WebSocket、SQLite、Cloudflare API、外部APIを呼ばない。

## 3. GameStateの固定項目

`GameState`は少なくとも次を持つ。

- ruleset・catalog・engine・乱数・シャッフル・seedの版情報
- `matchId`、`revision`、`phase`、`roundNumber`、`turnSequence`
- 手番・応答者、両プレイヤーの体力、手札、世界責任、再生責任、生存ラウンド数、状態効果
- 山札、手札、捨て札、公開カード、解決中カードとカード実体のzone
- 世界耐久、発生済み境界、世界律、フィールド、保留中action、効果キュー
- 世界崩壊、撃破、最大ラウンド、終了種別、戦闘勝者、神の選定者
- 受理済みcommandの履歴と`randomConsumptionCount`

`players[playerId].hand`と`cardZones.hands[playerId]`は同じ順序で保持し、不変条件検査で一致を要求する。カード実体は常にちょうど一つのzoneに存在する。

## 4. 外部command

ルールエンジンが受け取るcommandは、次の共通外枠を持つ。

```json
{
  "commandId": "cmd-0001",
  "playerId": "P1",
  "expectedRevision": 0,
  "commandType": "PLAY_CARD",
  "payload": {}
}
```

P1-01で型を固定するcommandは次の7種類である。

| commandType | 受理するphase | payload |
|---|---|---|
| `PLAY_CARD` | `ACTION_SELECTION` | cardInstanceId、playMode、任意のtargetPlayerId |
| `DISCARD_FOR_ACTION` | `ACTION_SELECTION` | cardInstanceId |
| `DISCARD_OVERFLOW` | `TURN_START` | cardInstanceId |
| `SELECT_RESPONSE` | `RESPONSE_SELECTION` | cardInstanceId、`responseMode=RESPONSE` |
| `ACCEPT_DAMAGE` | `RESPONSE_SELECTION` | `{}` |
| `SURRENDER` | `ACTION_SELECTION` / `RESPONSE_SELECTION` | `{}` |
| `TIMEOUT_DEFAULT_ACTION` | `ACTION_SELECTION` | `{}` |

クライアントはダメージ、再生、盾、採点、世界責任をpayloadへ入れない。カード定義から作る効果は後続のeffect resolverが決める。

## 5. 受理と拒否

- `expectedRevision`が現在の`revision`と一致しないcommandは`STALE_REVISION`で拒否する。
- 受理commandは`revision`を一つだけ増やす。拒否commandは状態を変更しない。
- 同じ`commandId`・同じ内容の再送は、最初の受理結果を返し、状態・revision・カードzoneを二重に変更しない。
- 同じ`commandId`・異なる内容の再送は`COMMAND_ID_REUSE`で拒否する。
- `RESOLUTION`中の外部commandはすべて拒否する。特に`SURRENDER`で解決を割り込ませない。
- `FINISHED`後の外部commandは拒否する。
- P1-01の拒否理由は安定したreason codeで返し、表示文と分離する。

## 6. P1-01の基礎状態遷移

P1-01は効果を解決せず、後続処理の境界だけを作る。

```text
PLAY_CARD
  手札 → 解決中
  ACTION_SELECTION → RESOLUTION

SELECT_RESPONSE / ACCEPT_DAMAGE
  RESPONSE_SELECTION → RESOLUTION

DISCARD_FOR_ACTION
  手札 → 捨て札
  ACTION_SELECTION → TURN_END

DISCARD_OVERFLOW
  手札 → 捨て札
  まだ上限超過なら TURN_START、解消なら ACTION_SELECTION

TIMEOUT_DEFAULT_ACTION
  手札があれば最も新しく引いたカードを捨てる
  ACTION_SELECTION → TURN_END

SURRENDER
  phase → FINISHED、endKind=SURRENDER
```

`PLAY_CARD`後に応答が必要か、効果キューをどう作るかはカード正本とP1-02の責務である。P1-01では`pendingAction`へカード実体、定義、使用者、使用方法、対象を保存する。

## 7. 検証

`tests/game-core/state-command.test.mjs`で、次をNode標準テストランナーにより固定する。

- 初期stateとplayer hand / card zoneの整合
- `PLAY_CARD`の解決段階への遷移
- 古いrevisionの拒否と状態不変
- 同一commandの再送と異内容再送
- `RESOLUTION`中の割り込み拒否
- 応答受理後の解決段階への遷移
- 時間切れの決定的な最新カード破棄

実行コマンド：

```text
node --experimental-strip-types --test tests/game-core/state-command.test.mjs
```

P1-01の完了条件を満たしたためP1-02「effects / PAY_HP」へ進み、効果命令と`PAY_HP`の実装を完了した。詳細は[P1-02実装記録](23_GAME_CORE_EFFECTS_PAY_HP_V1.md)を参照する。
