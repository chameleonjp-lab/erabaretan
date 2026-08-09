# 選ばれたん：技術設計・実装計画 V3

- 文書状態：現行技術計画
- 対象：12種類のルール確認から、合言葉オンライン対戦と限定公開まで
- 更新日：2026-08-09
- 優先関係：技術内容がV2実装計画と食い違う場合は本書を採用する

## 1. この文書の目的

本書は、「選ばれたん」を安全に拡張できる形で実装するために、ゲームルール、カード効果、乱数、通信、保存、再接続、更新、試験、公開の技術判断を固定する。

目標は、次を同時に満たすことである。

- 同じ初期条件と操作から、必ず同じ結果が出る
- カード追加で処理順が崩れない
- 相手の手札と山札順が漏れない
- 二重送信、遅延、再読み込みで行動が重複しない
- iPhoneのバックグラウンド復帰後に再接続できる
- 配信更新後も、進行中試合が開始時のルールで続く
- 問題が起きた試合を再現できる
- 利用者が少ない間は、低い運用量で動かせる

---

## 2. 固定する技術判断

| 項目 | 判断 |
|---|---|
| 最初の実装 | 通信なしの12種類対戦 |
| 言語 | TypeScript。`strict`を有効にする |
| パッケージ管理 | npm workspaces。別の管理方式を混在させない |
| Node.js | 実装開始時点のLTSを固定する。2026-08-09時点の第一候補はNode.js 24 LTS |
| 画面 | HTMLとCSSを中心にし、Canvasは背景演出へ限定 |
| ルール処理 | 画面、時刻、通信、Cloudflareへ依存しない純粋な処理 |
| カード効果 | 型で制限した共通命令の組み合わせ |
| 乱数 | Web Cryptoで種を作り、版固定した決定的乱数生成器で消費 |
| オンライン | 対戦管理側が正しい状態を決める |
| 配信 | Workers Static AssetsとWorkerを一体で配信 |
| 部屋管理 | 1対戦部屋につき1Durable Object |
| 保存 | SQLite-backed Durable Object storage |
| 通信 | Hibernation WebSocket API |
| 実行時の正しい状態 | 保存済みスナップショット |
| 再現 | 乱数種、受理操作、ルール一式、最終状態ハッシュ |
| 初期版の反応 | 攻撃に対する任意回答は最大1回。反射への再反射は不可 |
| P2P | 正式版では不採用。後続の研究対象 |

---

## 3. 段階別の全体構成

### 3.1 面白さ確認段階

```text
ブラウザ
  ├─ 画面
  ├─ game-core
  ├─ カード定義
  ├─ CPU
  └─ リプレイ記録
```

サーバー、アカウント、WebSocketを使用しない。

### 3.2 オンライン段階

```text
同一オリジンのCloudflare Worker
  ├─ Workers Static Assets
  │    └─ HTML / CSS / JavaScript / 画像 / 音
  ├─ HTTP入口
  │    ├─ ルーム作成
  │    ├─ 入室前検証
  │    └─ 保守状態の案内
  └─ WebSocket入口
       └─ 対象のDurable Objectへ接続

Durable Object：1部屋につき1個
  ├─ 正しい試合状態
  ├─ 山札と秘密手札
  ├─ 受理済み操作
  ├─ 公開・秘密イベント
  ├─ 次の期限
  ├─ 再接続情報
  └─ 終了後の削除期限
```

画面と通信入口を同じ配信単位にし、画面だけ古い、通信だけ新しいという組み合わせを減らす。

---

## 4. リポジトリ構成

最初から大規模な管理ツールを導入しない。

npm workspacesだけで、次の境界を作る。

```text
erabaretan/
├─ README.md
├─ docs/
├─ apps/
│  ├─ web/
│  │  ├─ index.html
│  │  ├─ src/
│  │  │  ├─ screens/
│  │  │  ├─ components/
│  │  │  ├─ presentation/
│  │  │  ├─ audio/
│  │  │  ├─ storage/
│  │  │  └─ network/
│  │  └─ public/
│  └─ worker/
│     └─ src/
│        ├─ index.ts
│        ├─ game-room.ts
│        ├─ auth/
│        ├─ persistence/
│        └─ observability/
├─ packages/
│  ├─ game-core/
│  │  └─ src/
│  │     ├─ state/
│  │     ├─ commands/
│  │     ├─ effects/
│  │     ├─ scoring/
│  │     ├─ rng/
│  │     ├─ replay/
│  │     └─ projection/
│  ├─ content/
│  │  └─ src/
│  │     ├─ cards/
│  │     ├─ world-laws/
│  │     └─ rulesets/
│  └─ protocol/
│     └─ src/
│        ├─ commands/
│        ├─ messages/
│        └─ schemas/
├─ tests/
│  ├─ golden-replays/
│  ├─ simulation/
│  ├─ worker/
│  ├─ security/
│  └─ e2e/
├─ package.json
├─ package-lock.json
├─ tsconfig.json
└─ wrangler.jsonc
```

`shared`のように責任が曖昧な置き場は作らない。

初期12種類の段階では`apps/worker`を空だけ作らない。オンライン工程へ入るときに追加する。

---

## 5. game-coreの責任

### 5.1 入出力

ルール処理の中心は、概念上次の形にする。

```text
reduce(
  currentState,
  validatedCommand,
  deterministicRandomSource
)

↓

nextState
publicEvents
privateEvents
randomConsumption
```

実際の関数分割は実装時に決めるが、次を守る。

- 入力を受け取って結果を返す
- DOMを触らない
- WebSocketを触らない
- SQLiteを触らない
- `Date.now()`を呼ばない
- `Math.random()`を呼ばない
- グローバルな変更可能状態を持たない
- ルール中に外部APIを呼ばない

### 5.2 数値

体力、世界耐久、得点、ラウンド、カード枚数は整数で扱う。

最初の版では小数を使わない。

割合効果が必要な場合も、丸め方を効果定義に明記する。

例：

```text
切り捨て
切り上げ
四捨五入
```

暗黙のJavaScript小数計算へ任せない。

### 5.3 識別子

カードの種類と、山札内の一枚を区別する。

```text
cardDefinitionId
cardInstanceId
```

同じ「鉄の聖剣」が山札に3枚あっても、各実体は別IDを持つ。

これにより、同じカード実体が複数の場所へ存在する不具合を検出できる。

### 5.4 状態の版

試合状態は、受理操作ごとに`revision`を1増やす。

クライアントは、最後に確認した`expectedRevision`を操作へ付ける。

古い状態から送られた危険な操作は自動で再実行せず、拒否して最新状態を返す。

---

## 6. 正式な状態遷移

初期版の主状態を次へ固定する。

```text
SETUP
↓
TURN_START
↓
ACTION_SELECTION
├─ 攻撃・介入 → RESPONSE_SELECTION
└─ 応答不要   → RESOLUTION
↓
RESPONSE_SELECTION
↓
RESOLUTION
↓
TURN_END
├─ 次手番 → TURN_START
└─ 終了   → JUDGMENT
↓
JUDGMENT
↓
FINISHED
```

オンライン上の待機状態を別に持つ。

```text
ROOM_WAITING
READY_CHECK
MATCH_RUNNING
RECONNECT_GRACE
MATCH_FINISHED
ROOM_EXPIRED
```

### 6.1 各状態の責任

**TURN_START**

1. 期限を設定
2. 継続効果を処理
3. カードを1枚引く
4. 手札上限を処理
5. 終了条件を確認
6. ACTION_SELECTIONへ進む

**ACTION_SELECTION**

- 手番プレイヤーだけが操作できる
- カード使用、抑制、捨てる、降参を受け付ける

**RESPONSE_SELECTION**

- 防御側だけが操作できる
- 防御、反応、受ける、降参を受け付ける
- 任意回答は最大1回

**RESOLUTION**

- プレイヤー操作を受け付けない
- 効果キューを最後まで処理する
- 終了判定は解決の途中で打ち切らず、解決単位の最後に行う

### 6.2 最初の版で入れないもの

- 反応へさらに反応する仕組み
- 任意のタイミングで割り込むカード
- 複数対象を一枚ずつ選び直す長い処理
- プレイヤー二人が同時に秘密選択する処理
- 無制限の効果連鎖

必要になった場合は、ルールエンジンの版を上げて追加する。

---

## 7. カード効果の表現

### 7.1 共通効果命令

カードは、小さな効果命令の配列として定義する。

初期候補：

```text
DAMAGE_PLAYER
HEAL_PLAYER
ADD_SHIELD
REDUCE_INCOMING_DAMAGE
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

各命令は、必要な値と対象を型で持つ。

### 7.2 実行順

カード定義内の効果命令は、上から順に実行する。

ただし、世界境界反応と試合終了判定は、カード解決単位の最後にまとめる。

初期版では、一枚のカードが世界損傷と世界再生を同時に行う定義を禁止する。

世界への影響は、再生、中立、損傷のいずれか一つにする。

### 7.3 効果キュー

自動効果はキューへ積み、先に入ったものから処理する。

```text
primary card effects
↓
field side effects
↓
queued world threshold reactions
↓
terminal check
```

自動効果の最大処理数を一解決あたり32件へ制限する。

超えた場合は、静かに続行せず、試合を`INVALID_MATCH`として停止し、記録を残す。

32は安全上の初期上限であり、試遊後に変更できる。

### 7.4 専用処理

共通命令で表せないカードは、名前付きの専用処理へ登録できる。

ただし、次を必須とする。

- 専用処理ID
- 入出力型
- 決定的であること
- 外部I/Oなし
- 単体試験
- ゴールデンリプレイ
- 他のカードから自由に呼び出せないこと

---

## 8. 世界境界と終了処理

### 8.1 複数境界を越えた場合

世界耐久が80から20へ下がった場合、75、50、25をすべて越える。

初期版では、次の順で一度ずつ処理する。

```text
75の反応
↓
50の反応
↓
25の反応
```

同じ境界は、世界が回復して再び下がっても再発しない。

### 8.2 境界反応でさらに境界を越える場合

反応が追加の世界損傷を起こした場合も、新しく越えた境界をキューへ追加する。

すでに発生済みの境界は追加しない。

### 8.3 終了判定

カード解決中に体力0または世界0になっても、処理をその場で止めない。

現在の解決単位と、そこから発生した必須反応を最後まで処理する。

その後、次の順で終了理由を決める。

1. ルール処理異常
2. サーバー中止
3. 正常な世界0
4. 片方または両方の体力0
5. 最大ラウンド
6. 継続

同時死亡、世界0と死亡の同時発生、反射死亡の詳細は`08_RULE_ENGINE_CONTRACT.md`へ固定する。

---

## 9. 乱数と山札

### 9.1 乱数の役割分離

**予測しにくい種を作る**

- Web Crypto API

**同じ種から同じ結果を作る**

- 版を固定した決定的乱数生成器

### 9.2 保存する情報

```text
seed
rngAlgorithmVersion
shuffleAlgorithmVersion
randomConsumptionCount
rulesetId
catalogHash
```

乱数生成器には、固定した入力と出力の試験値を持つ。

ブラウザ、Node.js、Workers実行環境で同じ試験値になることを確認する。

### 9.3 シャッフル

Fisher–Yates方式を使う。

範囲内乱数を作るときは、単純な剰余だけで偏りを作らない実装を使う。

山札作成後、各カード実体へ`cardInstanceId`を割り当てる。

### 9.4 山札の証明

開始時の証明値は、概念上次を含める。

```text
rulesetId
matchId
orderedCardInstanceIds
secretSalt
```

終了後に検証情報を公開できる。

ただし、これは試合開始前の山札選びまで公平だったことを証明しない。

初期版では、途中変更の検知補助として扱う。

---

## 10. ルールと配信の版管理

### 10.1 保存する版

| 版 | 役割 |
|---|---|
| protocolVersion | 通信形式 |
| engineVersion | ルール処理実装 |
| rulesetId | 採点、手番、終了条件を含むルール一式 |
| catalogHash | カードと世界律の内容 |
| eventVersion | 保存イベント形式 |
| snapshotVersion | 保存状態形式 |
| clientBuildId | 配信された画面とクライアントコード |
| rngAlgorithmVersion | 乱数生成器 |

### 10.2 試合開始時の固定

試合開始時に、`rulesetId`と`catalogHash`を固定する。

進行中に新しいカード数値を適用しない。

### 10.3 更新後の互換

配信物は、少なくとも現在版と直前版のルール処理を含める。

```text
ruleset registry
  ├─ ruleset-2026-08-a
  └─ ruleset-2026-08-b
```

新規試合は最新だけを使う。

進行中試合は開始時の版を使う。

直前版の削除は、通常の機能更新と分け、進行中試合が存在し得る期間を過ぎてから行う。

### 10.4 クライアント互換

WebSocket接続時に、次を交換する。

```text
protocolVersion
clientBuildId
supportedRulesetIds
```

互換性がない場合は対戦へ入れず、画面更新を案内する。

初期版ではService Workerを使用せず、古いクライアントが強く残る要因を減らす。

---

## 11. Workerの責任

Durable Objectへ送る前に、Workerで次を確認する。

- HTTPメソッド
- WebSocket Upgrade
- Origin
- URL形式
- ルームコード形式
- メッセージの最大長
- 保守中か
- 明らかな頻度超過

無効な要求を毎回Durable Objectまで到達させない。

Workerは次を担当する。

- 静的ファイル配信
- セキュリティヘッダー
- ルーム作成
- WebSocket入口
- ルームへの経路決定
- 新規ルーム停止
- 最低対応クライアント版の確認

試合ルールはWorkerへ分散させず、game-coreとDurable Objectに集約する。

---

## 12. ルームIDと接続資格

### 12.1 部屋コード

手入力用の部屋コードは、Crockford Base32など、読み間違いの少ない英数字10文字を候補とする。

- 0とOなどを除く
- 大文字小文字を区別しない
- 予測しにくい乱数で作る
- 作成済みなら再生成する

6桁数字だけにはしない。

### 12.2 再接続トークン

- 128ビット以上
- URLへ入れない
- IndexedDBへ保存
- サーバーにはハッシュを保存
- 復帰成功後に更新
- 試合終了時に削除
- ログへ出さない

### 12.3 一人一接続

同じプレイヤーとして新しい接続が認証された場合、`connectionGeneration`を増やす。

古い接続から届いた操作は拒否する。

これにより、再読み込み前のWebSocketと新しいWebSocketが同時に操作する問題を防ぐ。

---

## 13. Durable Objectの保存設計

### 13.1 基本原則

1対戦部屋を一つの調整単位にする。

重要状態をメモリだけに置かない。

Hibernationや予期しない終了から復元できるよう、受理操作ごとに保存する。

### 13.2 SQLite表の初期案

```text
room_meta
players
match_snapshot
accepted_commands
match_events
deadlines
schema_meta
```

**room_meta**

- roomId
- roomState
- createdAt
- expiresAt
- rulesetId
- catalogHash
- snapshotVersion

**players**

- playerId
- seat
- displayName
- resumeTokenHash
- connectionGeneration
- joinedAt

**match_snapshot**

- revision
- serializedState
- stateHash
- updatedAt

**accepted_commands**

- commandId
- playerId
- expectedRevision
- acceptedRevision
- commandType
- serializedPayload
- receivedAt

**match_events**

- eventId
- sequence
- visibility
- eventType
- serializedPayload
- logicalRound
- logicalTurn
- recordedAt

**deadlines**

- deadlineId
- deadlineType
- deadlineAt
- resolvedAt

**schema_meta**

- schemaVersion

Durable ObjectsのSQLiteでは`PRAGMA user_version`を前提にしない。

### 13.3 一操作の保存手順

```text
1. 接続資格を確認
2. メッセージ形式を確認
3. commandIdの重複を確認
4. expectedRevisionを確認
5. 現在状態を読み込む
6. game-coreで新状態とイベントを計算
7. スナップショット、操作、イベント、期限を同じ保存単位で書く
8. 保存完了後に各閲覧者用の通知を送る
```

同じ保存処理の途中で、外部`fetch`、R2、外部データベースを呼ばない。

### 13.4 イベント記録の位置付け

初期版では、完全なイベントソーシングを採用しない。

- スナップショット：実行時の正しい状態
- 受理操作：リプレイと監査
- イベント：画面表示、差分配信、調査

リプレイでは、受理操作から状態を再計算し、保存済み最終状態ハッシュと一致するか確認する。

### 13.5 Hibernation

WebSocket attachmentへ保存するのは、小さな接続情報だけにする。

```text
playerId
sessionId
connectionGeneration
lastAcknowledgedSequence
```

試合状態はSQLiteへ置く。

constructorでは、スキーマ確認など必要最小限だけを行う。

### 13.6 削除

ルームには`expiresAt`を持たせる。

- 未成立ルーム：短時間
- 終了済み通常対戦：検証中は7日を初期候補
- 不成立試合：調査に必要な最小期間

削除Alarmでは状態を再確認し、保存期間を過ぎた部屋だけ`deleteAll()`相当で消す。

---

## 14. Cloudflare設定

### 14.1 静的配信

新規構成ではWorkers Static Assetsを使う。

静的ファイルが存在する要求は、不要にWorkerコードを動かさず配信する。

APIとWebSocket経路だけWorkerを先に動かす。

### 14.2 Durable Objectクラス

新規名前空間はSQLite-backedとして作る。

2026年時点の第一候補はWranglerの`exports`によるクラス宣言である。

導入時のWranglerが対応していない場合は、`new_sqlite_classes`を使う。

一つのプロジェクトで`exports`方式と旧migrations方式を混在させない。

### 14.3 型

`Env`を手書きしない。

`wrangler types`で、実際の設定に対応する型を生成する。

bindingを追加、削除、改名したら再生成する。

### 14.4 互換日

新規プロジェクトでは、作成日付近の`compatibility_date`を使う。

更新は自動で無制限に進めず、試験後に変更する。

`nodejs_compat`を設定へ明示する。

ただし、game-core自体はNode.js専用APIへ依存させない。

---

## 15. 通信形式

### 15.1 最初の形式

最初はJSONを使用する。

カードゲームの通信量では、早期のバイナリ化より、調査しやすさを優先する。

一メッセージの最大サイズを16KB以下へ制限する。

### 15.2 接続時

```text
CLIENT_HELLO
↓
SERVER_HELLO
↓
AUTHENTICATE_OR_RESUME
↓
STATE_SNAPSHOT
```

`CLIENT_HELLO`には、少なくとも次を含める。

- protocolVersion
- clientBuildId
- supportedRulesetIds

### 15.3 クライアント命令

```text
commandId
expectedRevision
commandType
payload
```

クライアントは結果値を送らない。

送るのは意図だけである。

例：

```text
カード実体ID
使用方法
対象
防御の選択
```

### 15.4 サーバー通知

すべての通知に次を含める。

```text
protocolVersion
matchId
revision
sequence
messageType
payload
```

通知欠落や順番飛びを検出した場合は、差分を推測して続けず、スナップショットを再取得する。

### 15.5 二重操作

画面側は、一つの危険な操作を送信したら、受理または拒否が返るまで同じ操作を再送しない。

通信再送が必要な場合も、同じ`commandId`を使う。

対戦管理側は、同じ`commandId`を二度実行しない。

---

## 16. 公開状態と秘密状態

完全状態から、閲覧者ごとの状態を作る。

```text
projectState(fullState, viewerId)
```

### 16.1 全員へ見せる

- 両者の体力
- 両者の手札枚数
- 世界耐久
- 個人別世界損傷と再生
- 現在のフィールド
- 発生済み世界境界
- 手番、ラウンド、期限
- 公開済みカード
- 暫定評価の公開部分

### 16.2 本人だけへ見せる

- 自分の手札内容
- 自分だけが選べる応答候補
- 未公開の選択
- 再接続状態

### 16.3 誰にも送らない

- 未配布の山札順
- 相手の秘密手札
- 乱数生成器の未使用状態
- 再接続トークンのハッシュ
- 山札証明のSalt

公開・秘密投影は、カードごとの試験だけでなく、全状態を対象にした不変条件試験を持つ。

---

## 17. 制限時間、切断、復帰

### 17.1 期限

対戦管理側が`deadlineAt`を保存する。

クライアントは、受け取った締切時刻から表示だけを行う。

端末の時計を勝敗判定に使わない。

### 17.2 Alarm

一つのDurable Objectで、最も近い期限を一つAlarmへ設定する。

Alarmは正確な描画タイマーとして扱わない。

Alarmまたは次の要求を受け取ったとき、次を行う。

1. 保存済み締切を読む
2. 期限を超えたか確認
3. 期限IDが未処理か確認
4. 既定行動を一度だけ実行
5. 次の期限を設定

### 17.3 iPhoneバックグラウンド

iOSでは、画面を離れたときにWebSocketが維持されると仮定しない。

- `visibilitychange`で復帰処理を開始
- WebSocket closeで指数的に再接続
- 再接続中は危険操作を送らない
- 最新スナップショットを取得
- 表示演出を現在状態へ追い付かせる

### 17.4 猶予

60秒は初期検証値とする。

時計を完全に停止する方式は採用しない。

切断中も、すでに始まった手番期限は進む。

ただし、接続自体が切れた直後に即敗北とはせず、次の扱いを検証する。

- 現在手番の安全な既定行動
- その後の再接続猶予
- 連続して戻らない場合の切断敗北

詳細はルール契約で固定する。

---

## 18. 終了種別

```text
NORMAL
SURRENDER
DISCONNECT_FORFEIT
SERVER_ABORT
INVALID_MATCH
```

### 18.1 NORMAL

通常の神評価、勝率、カード統計へ含める。

### 18.2 SURRENDER

相手を対戦上の勝者とする。

神評価の内訳は参考表示できるが、通常の選定率やカード勝率へ含めない。

### 18.3 DISCONNECT_FORFEIT

切断した側を敗北扱いにする。

通信品質指標へ含めるが、通常のゲームバランス統計へ含めない。

### 18.4 SERVER_ABORT

両者の勝敗を確定しない。

障害として記録する。

### 18.5 INVALID_MATCH

ルール上限超過、保存不整合、未処理例外など。

勝敗を確定せず、不具合調査対象にする。

---

## 19. CPUと自動対戦

### 19.1 CPUの入力

人間向けCPUは、本人用の投影状態だけを見る。

相手の手札、山札順、未公開乱数を見せない。

### 19.2 難易度

難易度は次で変える。

- 候補手の評価精度
- 先読み手数
- 判断に使う時間
- 世界律の考慮

秘密情報による不正な強さは使わない。

### 19.3 自動対戦

自動対戦では、次を必ず記録する。

- seed
- rulesetId
- CPU方針ID
- 受理操作列
- 終了種別
- 最終状態ハッシュ

問題試合を、そのままゴールデンリプレイへ追加できるようにする。

---

## 20. 試験戦略

### 20.1 game-core単体試験

- 全状態遷移
- 全効果命令
- 全カード使用方法
- 世界境界
- 採点
- 同時終了
- 山札切れ
- 手札上限
- 決定的乱数

### 20.2 不変条件試験

- カード総数が保存される
- 同じカード実体が複数場所へ存在しない
- 世界境界が二度発生しない
- 終了後に状態が変わらない
- 公開状態へ秘密情報が混ざらない
- 受理済み操作の再送で状態が変わらない
- 整数範囲を外れない
- 効果キュー上限を超えない

### 20.3 ゴールデンリプレイ

代表的な試合を固定ファイルへ保存する。

- 通常撃破
- 世界0
- 同時死亡
- 世界境界3段階同時通過
- 防御
- 反射
- フィールド上書き
- 最大ラウンド
- 降参
- 切断敗北

ルール変更時に差分を確認する。

意図しない差分がある場合はマージしない。

### 20.4 Workers実行環境

通常のVitestだけで終わらせない。

`@cloudflare/vitest-pool-workers`を使い、Workers実行環境で次を確認する。

- Durable Object binding
- SQLite保存
- Alarm
- Hibernation復帰
- オブジェクト退避後の復元
- WebSocket attachment
- 重複命令

Durable Objectを意図的に退避させ、メモリ状態が消えたあとも復元できるか試験する。

### 20.5 結合試験

Cloudflareの統合試験手段を使い、静的画面、Worker、Durable Objectを一体で確認する。

### 20.6 ブラウザ試験

Playwrightで二つのブラウザ文脈を開き、次を自動化する。

- 作成と入室
- 一試合完了
- 二重タップ
- 遅延
- 再読み込み
- WebSocket切断
- 片方だけ復帰
- 古いクライアント版の拒否

PlaywrightのWebKitは、実機iPhone Safariと同一ではない。

最終確認は実機で行う。

### 20.7 入力の異常試験

- 未知の命令
- 大きすぎるJSON
- 欠けた必須項目
- 不正なカード実体ID
- 相手の手札を指定
- 古いrevision
- 同じcommandId
- 頻度超過
- FINISHED後の操作

---

## 21. CIと環境

### 21.1 固定するもの

- Node.js LTSのメジャー版
- npm
- package-lock.json
- TypeScript設定
- Wrangler版
- compatibility_date

依存関係を無指定の最新版で毎回取得しない。

### 21.2 Pull Requestで実行するもの

1. `npm ci`
2. `wrangler types`後の差分確認
3. TypeScript型検査
4. 静的検査
5. game-core単体試験
6. 決定的乱数の試験値
7. ゴールデンリプレイ
8. 不変条件試験
9. Workers Vitest試験
10. ビルド
11. 主要なブラウザ試験
12. バンドル容量確認

オンライン着手前のPRでは、存在しないWorker試験を無理に実行しない。

### 21.3 環境分離

```text
local
preview
production
```

次を環境ごとに分ける。

- Worker名
- Durable Object名前空間
- 設定値
- 秘密情報
- 計測先
- 許可Origin

Pull Requestから本番名前空間へ接続させない。

### 21.4 配信

画面、Worker、カード定義、対応rulesetを同じ配信単位にする。

新規ルーム作成を止める保守設定を持つ。

進行中試合を可能な限り完了させたあとに、大きな破壊的更新を行う。

### 21.5 ロールバック

保存形式は、まず後方互換な追加を行う。

削除や意味変更は別配信に分ける。

コードを戻しても保存形式が読める状態を保つ。

---

## 22. セキュリティ

### 22.1 ブラウザ

- 厳しいContent Security Policy
- `Referrer-Policy: no-referrer`
- 外部スクリプトを初期版で入れない
- 表示名をHTMLとして挿入しない
- `innerHTML`の使用を避ける
- 再接続トークンをログやURLへ出さない

### 22.2 WebSocket

- Origin検証
- 16KB以下のメッセージ
- 一接続あたりの送信頻度制限
- 未認証状態の操作拒否
- 接続資格とplayerIdの対応確認
- 一人一接続世代

### 22.3 ルーム作成の悪用

- 作成頻度を制限
- 未成立ルームを短時間で削除
- 無効な作成要求をDurable Objectへ送らない
- 公開マッチング段階ではTurnstile等を再検討

### 22.4 ログ

記録する：

- traceId
- buildId
- rulesetId
- matchIdの調査用表現
- commandType
- errorCode
- revision

記録しない：

- 秘密手札
- 山札順
- resumeToken
- Salt
- 必要のない端末識別情報

---

## 23. 観測と障害対応

本番へ出す前に、Workers LogsとTracesを有効にする。

構造化JSONで記録し、量はsamplingで調整する。

最低限の指標：

- ルーム作成成功率
- 入室成功率
- 対戦開始率
- 正常終了率
- 切断率
- 復帰成功率
- command拒否理由
- 平均メッセージ数
- 平均保存量
- SERVER_ABORT
- INVALID_MATCH

障害時に、次を独立して操作できるようにする。

- 新規ルーム作成停止
- オンライン入口停止
- 静的CPU戦の継続
- 最低クライアント版の引き上げ
- 問題rulesetでの新規開始停止

---

## 24. iPhone向け実装条件

### 24.1 画面

- `100dvh`など動的表示領域を考慮
- safe areaを考慮
- 入力文字を16px未満にしない
- 主要ボタンを十分な大きさにする
- 手札の横スクロールとページ全体の横スクロールを分ける
- 危険カードはタップ、確認、決定の順にする

### 24.2 描画

カードゲームで常時60回描画し続けない。

- 演出中だけ`requestAnimationFrame`
- 非表示中は演出を止める
- 背景効果の粒子数に上限
- DOMノードを増やし続けない
- 音声を必要時に解放

### 24.3 初期性能予算

仮の確認値：

- 初回JavaScript：圧縮後250KB以内を目標
- 初回必須転送量：1.5MB以内を目標
- 一枚の画像：必要以上の高解像度にしない
- 対戦中の長時間処理：一回16msを大きく超える処理を継続させない
- 自動対戦は画面の主スレッドで大量実行しない

数値は完成値ではなく、肥大化を早く検知するための予算とする。

---

## 25. 実装工程の修正版

### 工程0：仕様契約

成果物：

- `08_RULE_ENGINE_CONTRACT.md`
- 状態遷移
- 効果命令一覧
- 乱数仕様
- 12種類のカード表
- 最初の世界律
- ゴールデン試合3件

完了条件：手計算と簡単な試験データで、同じ結果を再現できる。

### 工程1：12種類の純粋ルール基盤

成果物：

- game-core
- 決定的乱数
- 12種類
- 同一端末対戦
- リプレイ
- 単体試験

完了条件：同じseedと操作列で、ブラウザとNode.jsが同じ最終状態ハッシュになる。

### 工程2：24種類と自動検証

成果物：

- 24種類
- CPU
- 自動対戦
- 不変条件
- ゴールデンリプレイ
- iPhone基本画面

完了条件：無限循環、秘密情報混入、処理順不一致がなく、面白さの品質門を通る。

### 工程3：36種類の完成品質確認

成果物：

- 36種類
- 世界律3種類
- 初回導入
- 演出と音
- 再戦
- 結果説明

完了条件：商品計画V2のオンライン着手条件を満たす。

### 工程4：オンライン基盤

成果物：

- Workers Static Assets
- Worker
- Durable Object
- WebSocket
- 秘密状態投影
- 保存
- 重複防止
- 期限

完了条件：二端末で一試合が完了し、相手の秘密状態を取得できない。

### 工程5：復帰、更新、障害

成果物：

- 再接続
- connectionGeneration
- Alarm
- 終了種別
- 版固定
- 現在版と直前版の同時実行
- 保守停止
- 観測

完了条件：退避、再読み込み、配信更新、重複送信を含む試験を通る。

### 工程6：48種類の限定公開

成果物：

- 48種類
- 世界律4種類
- 費用計測
- 端末確認
- 不具合導線
- 保存期間

完了条件：正常終了、復帰、理解、再戦、使用量の基準を満たす。

---

## 26. 技術品質門

| 品質門 | 条件 |
|---|---|
| 決定性 | 同じ入力でブラウザ、Node.js、Workersが同じ結果 |
| ルール | 未定義の状態遷移がない |
| 効果 | 共通命令または承認済み専用処理だけを使う |
| 乱数 | 種、アルゴリズム版、消費順を再現できる |
| 秘密 | 完全状態をクライアントへ送らない |
| 保存 | 一操作の状態、操作、イベントを一体で保存 |
| 重複 | 同じcommandIdで状態が二度変わらない |
| 復帰 | Durable Object退避後も正しい状態へ戻る |
| 更新 | 進行中試合が開始時rulesetで終わる |
| 障害 | SERVER_ABORTを通常勝敗へ混ぜない |
| iPhone | 実機で一試合を完了できる |
| 運用 | 1試合の通信、保存、実行量を測定済み |

---

## 27. 直近の作業

コードより先に、次を一つの仕様作業として完成させる。

1. 初期12種類のカード定義
2. 正式な状態遷移
3. 効果命令一覧
4. 乱数仕様と試験値
5. 最初の世界律
6. 同時死亡、世界0、最大ラウンドの例
7. ゴールデン試合3件

この内容を`08_RULE_ENGINE_CONTRACT.md`へ合わせ、矛盾がなくなってからgame-coreを実装する。

---

## 28. 参照した公式資料

確認日：2026-08-09

- Cloudflare Workers Static Assets
  - https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers Best Practices
  - https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Durable Objects Rules
  - https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Durable Objects WebSockets
  - https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Objects Testing
  - https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
- Workers Vitest integration
  - https://developers.cloudflare.com/workers/testing/vitest-integration/
- Durable Object class exports
  - https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Node.js releases
  - https://nodejs.org/ja/about/previous-releases/
