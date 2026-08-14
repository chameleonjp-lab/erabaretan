# エラバレタン：決定的乱数生成器と固定試験値 V1

- 文書状態：P0-05 正本・実装前検証値
- 更新日：2026-08-14
- 対象rulesetId：`ruleset.alpha-12.v1`
- 対象catalogHash：初期12種類カードカタログのハッシュを実装時に設定する
- 関連文書：[ルールエンジン契約](08_RULE_ENGINE_CONTRACT.md)、[初期12種類カード仕様](16_INITIAL_12_CARD_SPEC_V1.md)、[ruleset仕様](17_RULESET_ALPHA_12_V1.md)、[Fixture仕様](18_FIXTURES_ALPHA_12_V1.md)、[共通効果命令の正式型](19_COMMON_EFFECT_COMMANDS_ALPHA_12_V1.md)

## 1. この文書の役割

この文書は、同じ試合の入力を同じ順序で処理したとき、山札、先攻、リプレイの結果が毎回一致するための乱数規則を固定する。

ここでいう決定性とは、同じ次の値から同じ出力が得られることである。

```text
rulesetId
catalogHash
rngAlgorithmVersion
shuffleAlgorithmVersion
seed
初期プレイヤー順
受理された命令列
```

演出の揺れ、画面の粒子、ボタンの反応速度は、試合結果用の乱数へ影響させない。

この段階では乱数機能のコードを作らない。アルゴリズム、入力、消費順、固定試験値を先に確定し、P1-04で実装する。

## 2. P0-05で固定する範囲

### 2.1 固定するもの

- 乱数の種の形式と作成方法
- 乱数生成器のアルゴリズムと版番号
- 整数乱数の作り方
- 山札の初期順序
- 山札シャッフルの順序
- 初期手札の配り方
- 先攻決定の位置と値の対応
- 乱数を使う処理と使わない処理
- 乱数消費数の記録方法
- 小さな検算、拒否抽選、初期12種類の固定試験値

### 2.2 この文書で固定しないもの

- 画面の演出用乱数
- CPUがどのカードを選ぶか
- ランダム対象カードの追加
- 乱数を使う新カードの内容
- 長期公開リプレイの保存形式
- P0-06で作るゴールデン試合の最終状態ハッシュ

## 3. 版番号と保存項目

### 3.1 固定値

| 項目 | 固定値 | 意味 |
|---|---|---|
| `rngAlgorithmVersion` | `rng.xoshiro128ss.v1` | 32ビット4語の決定的乱数生成器 |
| `shuffleAlgorithmVersion` | `shuffle.fisher-yates-desc.v1` | 後ろから前へ進むFisher-Yates法 |
| `seed` | 32文字の小文字16進数 | 32ビット語4個、合計128ビット |
| `randomConsumptionCount` | 0以上の整数 | 生成器から読み出した32ビット値の累計 |

`rngAlgorithmVersion`と`shuffleAlgorithmVersion`は、リプレイを再生するために必須である。どちらかが分からないリプレイは、結果を推測して再生しない。

### 3.2 種の形式

`seed`は、32ビットの符号なし整数4個を、各8文字の小文字16進数で左から連結する。

```text
seed = s0(8文字) + s1(8文字) + s2(8文字) + s3(8文字)
例   = 123456789abcdef00fedcba987654321
```

文字の大文字小文字、空白、`0x`接頭辞は保存形式へ入れない。

ゲーム開始時の本番種は、Web Crypto APIの`crypto.getRandomValues`で32ビット語4個を作る。ゲーム用の生成器自体は暗号用ではないため、予測しにくい種を開始時に作ることが必要である。

```text
words = Uint32Array(4)
crypto.getRandomValues(words)
seed = words[0]を8文字へ変換
     + words[1]を8文字へ変換
     + words[2]を8文字へ変換
     + words[3]を8文字へ変換
```

4語すべてが0になる種は受理せず、種を作り直す。種は試合開始後に変更しない。

`seed`は試合中の公開状態へ含めない。サーバー側の試合記録と、権限のあるリプレイ記録へ保存する。試合終了前に相手へ種を送らない。

## 4. 乱数生成器

### 4.1 採用する方式

32ビット整数を4個持ち、一定のビット演算だけで次の値を作る方式を使う。名称はxoshiro128スター・スター方式とし、版番号を`rng.xoshiro128ss.v1`へ固定する。

これは暗号用の乱数ではない。カードの山札順や先攻決定を同じ入力から再現するために使う。本番の種だけはWeb Crypto APIで作る。

### 4.2 内部状態

種の4語を、次の順で内部状態の初期値へ入れる。

```text
s0 = seedの1語目
s1 = seedの2語目
s2 = seedの3語目
s3 = seedの4語目
```

すべての語は0から`4294967295`までの符号なし32ビット整数として扱う。計算結果は必ず32ビットへ戻す。符号付き整数として保存したり、倍精度浮動小数点のまま保存したりしない。

### 4.3 `nextUint32`

1回の読み出しは、次の順序で行う。`rotl(x, k)`は32ビット値を左へ`k`ビット循環移動する関数である。

```text
result = rotl(s1 × 5, 7) × 9
t      = s1 << 9

s2 = s2 XOR s0
s3 = s3 XOR s1
s1 = s1 XOR s2
s0 = s0 XOR s3
s2 = s2 XOR t
s3 = rotl(s3, 11)

出力 = resultを32ビットへ戻した値
```

乗算は32ビットの下位だけを残す。JavaScriptで実装するときは、乗算と32ビット化の箇所で`Math.imul`を使い、ビット演算の結果へ`>>> 0`を適用する。

状態更新を終えてから次の読み出しへ進む。出力を捨てる処理は作らない。

### 4.4 `randomConsumptionCount`

`nextUint32`を呼ぶたびに、呼び出し前の値へ1を加える。

```text
randomConsumptionCount += 1
```

整数範囲の抽選でやり直しが起きた場合も、捨てた32ビット値を数える。これにより、後から見た消費数と内部状態の進み方が一致する。

## 5. 整数の抽選

### 5.1 `nextInt(maxExclusive)`

戻り値は`0`以上、`maxExclusive`未満の整数とする。

```text
1 <= maxExclusive <= 2^32
```

次の方法で、単純な剰余による偏りを避ける。

```text
range = 2^32
limit = range - (range mod maxExclusive)

繰り返す
  raw = nextUint32()
  rawがlimit未満なら raw mod maxExclusiveを返す
```

`raw`が`limit`以上の場合、その値は捨てて、同じ抽選を続ける。捨てた値も`randomConsumptionCount`へ含める。

`maxExclusive = 2^32`の場合は、32ビット値をそのまま返す。`0`や小数、文字列の数字、不正な上限は拒否する。

### 5.2 使用禁止の抽選

ゲーム結果を決める処理では、次を使わない。

```text
Math.random()
random % maxExclusiveだけを使う独自処理
Math.floor(randomFloat * maxExclusive)
現在時刻を種にする処理
画面フレーム数を種にする処理
```

確率を使う新しい効果を追加するときも、整数範囲へ変換して`nextInt`を使う。小数の乱数関数はP0-05の対象へ追加しない。

## 6. 初期12種類の山札処理

### 6.1 カード実体ID

初期12種類は各3枚、合計36枚である。カード実体IDは、次の形を使う。

```text
<cardDefinitionId>#<copyNumber>
```

`copyNumber`は`01`、`02`、`03`の2桁である。

例：

```text
attack.rift-pebble.v1#01
```

このIDは山札内の一枚を一意に表す。カード定義の変更や複製枚数の変更は、別の`catalogHash`と`rulesetId`で扱う。

### 6.2 シャッフル前の順序

シャッフル前の山札は、`cardDefinitionId`をUTF-8のバイト列で昇順に並べ、同じ定義の中では`copyNumber`の数値順に並べる。

初期12種類の定義順は次のとおりである。

```text
attack.rift-pebble.v1
attack.star-breaker.v1
attack.steadfast-strike.v1
defense.ashen-bulwark.v1
defense.guardian-veil.v1
field.frenzied-fracture.v1
field.root-sanctuary.v1
intervention.careful-redraw.v1
intervention.field-nullification.v1
intervention.judgment-of-scars.v1
intervention.oath-of-renewal.v1
intervention.verdant-bargain.v1
```

カード正本に書かれた表の順番やファイルの読み込み順を、暗黙の初期順序として使わない。

### 6.3 Fisher-Yatesシャッフル

`shuffle.fisher-yates-desc.v1`では、配列の最後から先頭の一つ前まで進む。

```text
for i = deck.length - 1 down to 1
  j = nextInt(i + 1)
  deck[i]とdeck[j]を交換
```

36枚では、`i=35`から`i=1`まで合計35回抽選する。各回の上限は`i+1`である。

並列処理、並び替え関数の実装差、オブジェクトのキー順へ依存しない。シャッフル後の配列を、そのまま山札の上から下の順として扱う。

### 6.4 初期手札と先攻

シャッフル後、まず固定された席順`[P1, P2]`へ交互に7枚ずつ配る。

```text
0枚目 → P1
1枚目 → P2
2枚目 → P1
3枚目 → P2
...
12枚目 → P1
13枚目 → P2
```

この配布では乱数を使わない。14枚を配ったあと、`SELECT_FIRST_PLAYER`として`nextInt(2)`を1回だけ呼ぶ。

```text
0 → P1が先攻
1 → P2が先攻
```

残り22枚は、14枚目の次を山札の先頭として保存する。通常の補充や`DRAW_CARD`は、乱数を使わず山札の先頭から取る。

### 6.5 初期セットアップの消費表

| 順序 | 用途 | 抽選回数 | 上限 | 備考 |
|---:|---|---:|---:|---|
| 1 | `SHUFFLE_DECK` | 35回以上 | 36, 35, …, 2 | 拒否抽選があれば追加 |
| 2 | `SELECT_FIRST_PLAYER` | 1回 | 2 | 0=P1、1=P2 |
| 合計 |  | 36回以上 |  | 通常の固定種では36回 |

`DRAW_CARD`、手札の超過破棄、カードの使用、世界境界、効果命令、採点、画面表示は、初期12種類では乱数を使わない。

## 7. 乱数消費の記録

### 7.1 記録する情報

試合状態には、少なくとも次を保存する。

```text
rngAlgorithmVersion
shuffleAlgorithmVersion
seed
randomConsumptionCount
```

調査用のサーバー記録では、各抽選の用途も残す。

```text
consumptionOrdinal
purpose
maxExclusive
acceptedAttempt
```

`rawUint32`は秘密情報になりうるため、公開状態へ含めない。固定試験値とサーバー調査記録には保存してよい。

### 7.2 用途名

初期12種類で許可する用途名は次の二つだけである。

```text
SHUFFLE_DECK
SELECT_FIRST_PLAYER
```

将来、`RANDOM_TARGET`などを追加する場合は、目的、抽選上限、処理位置、固定試験値を同時に仕様へ追加する。既存の用途へ別の意味を混ぜない。

### 7.3 乱数を消費しない条件

- 不正な命令を検証して拒否したとき
- 重複命令を最初の結果で返したとき
- `previewCommand`で結果を予測するとき
- 画面を再描画したとき
- 音や粒子を再生したとき
- 山札の先頭からカードを引くとき
- 乱数を使わないカードや世界律を解決したとき

乱数を使う処理は、入力検証を終え、実際に状態を変更すると決めた後だけ呼ぶ。

## 8. 固定試験値

以下の値は、P1-04で実装した生成器の単体試験へそのまま使う。数値はすべて10進数または8桁の小文字16進数で比較し、表示上の大文字小文字を許容しない。

共通の試験種は次である。

```text
seed = 123456789abcdef00fedcba987654321
s0   = 0x12345678
s1   = 0x9abcdef0
s2   = 0x0fedcba9
s3   = 0x87654321
```

### 8.1 `nextUint32`の出力

新しい生成器を作り、上の種から順番に読み出す。

| ordinal | 出力 |
|---:|---:|
| 1 | `0x99981812` |
| 2 | `0x66666962` |
| 3 | `0xd3905550` |
| 4 | `0x309cbe4f` |
| 5 | `0x06991cb1` |
| 6 | `0x4ef39f2d` |
| 7 | `0x1f6bc67b` |
| 8 | `0x8d5d51c5` |
| 9 | `0xa6091973` |
| 10 | `0xf2e9a317` |
| 11 | `0x270cb834` |
| 12 | `0x3f5a171f` |

12回後の`randomConsumptionCount`は`12`である。

### 8.2 `nextInt(10)`の出力

同じ種で新しい生成器を作り、`nextInt(10)`を12回呼ぶ。

```text
[2, 2, 0, 3, 9, 5, 9, 7, 5, 1, 2, 7]
```

12回ともやり直しはなく、`randomConsumptionCount`は`12`である。

### 8.3 拒否抽選の出力

同じ種で新しい生成器を作り、`nextInt(2147483649)`を4回呼ぶ。

```text
limit = 2147483649
values = [1717987682, 815578703, 110697649, 1324588845]
各結果へ到達するまでの読み出し回数 = [2, 2, 1, 1]
randomConsumptionCount = 6
```

最初と2回目の抽選では、範囲外の値を1回ずつ捨てる。結果の個数が4個でも、消費数は4ではなく6になる。

### 8.4 5要素シャッフル

次の配列を`shuffle.fisher-yates-desc.v1`でシャッフルする。

```text
入力 = [A, B, C, D, E]
```

期待する抽選と交換後の結果は次である。

| `i` | `rawUint32` | `j` | 操作後の配列 |
|---:|---|---:|---|
| 4 | `0x99981812` | 2 | `[A, B, E, D, C]` |
| 3 | `0x66666962` | 2 | `[A, B, D, E, C]` |
| 2 | `0xd3905550` | 1 | `[A, D, B, E, C]` |
| 1 | `0x309cbe4f` | 1 | `[A, D, B, E, C]` |

期待する最終結果は次である。

```text
[A, D, B, E, C]
randomConsumptionCount = 4
```

### 8.5 初期12種類のセットアップ

共通の試験種、`ruleset.alpha-12.v1`、上記の12種類のカタログを使う。シャッフル前の順序は6.2の定義順、各定義の複製番号は`01`から`03`とする。

期待する結果は次である。

```text
P1.hand = [
  attack.rift-pebble.v1#02,
  intervention.judgment-of-scars.v1#01,
  attack.star-breaker.v1#01,
  intervention.careful-redraw.v1#01,
  field.frenzied-fracture.v1#01,
  intervention.verdant-bargain.v1#02,
  intervention.judgment-of-scars.v1#03
]

P2.hand = [
  field.frenzied-fracture.v1#02,
  field.root-sanctuary.v1#02,
  intervention.oath-of-renewal.v1#01,
  attack.star-breaker.v1#02,
  intervention.field-nullification.v1#01,
  field.root-sanctuary.v1#03,
  attack.steadfast-strike.v1#01
]

firstPlayer = P2
randomConsumptionCount = 36
```

山札の先頭10枚は次である。

```text
[
  attack.steadfast-strike.v1#03,
  intervention.verdant-bargain.v1#03,
  defense.ashen-bulwark.v1#03,
  intervention.oath-of-renewal.v1#03,
  intervention.careful-redraw.v1#03,
  attack.rift-pebble.v1#01,
  defense.guardian-veil.v1#03,
  field.root-sanctuary.v1#01,
  intervention.field-nullification.v1#02,
  intervention.careful-redraw.v1#02
]
```

山札の最後の3枚は次である。

```text
[
  defense.ashen-bulwark.v1#02,
  defense.guardian-veil.v1#01,
  intervention.field-nullification.v1#03
]
```

### 8.6 固定試験値の読み方

8.1〜8.4はアルゴリズム単体を確認する。8.5は、カタログ順、複製番号、シャッフル、配布、先攻決定を一続きで確認する。

8.5の手札や山札が一致しない場合、次のどれかが一致していない。

- シャッフル前のカード順
- `copyNumber`の扱い
- Fisher-Yatesの進行方向
- `nextInt`の範囲
- 初期手札の配布順
- 先攻抽選の位置

この場合、値を都合よく変更せず、原因を特定してから`rngAlgorithmVersion`または`shuffleAlgorithmVersion`の変更要否を判断する。

## 9. リプレイと再接続

### 9.1 リプレイの再生条件

リプレイは次の値が一致するときだけ再生する。

```text
rulesetId
catalogHash
rngAlgorithmVersion
shuffleAlgorithmVersion
seed
initialPlayerOrder
acceptedCommands
```

再生中に`randomConsumptionCount`が期待値と異なった場合、その時点で再生を失敗させる。後続の状態だけを合わせる補正は行わない。

### 9.2 再接続

再接続時は、保存済みの状態と受理済み命令列から乱数状態を再構成する。乱数の種を新しく作って続行しない。

途中状態を高速に復元する必要がある場合も、P0-05では種と消費数を正本とする。内部状態の追加保存はP1-04の実装判断とし、保存しても種・版番号・消費数と矛盾させない。

### 9.3 版が違う場合

乱数の計算式、種の読み方、シャッフル順、配布順を変えるときは、少なくとも該当する版番号を上げる。

旧版のリプレイを新しい計算式で再生しない。旧版を残せない場合は、再生不能であることを明示する。

## 10. 安全性と不正入力

- クライアントが`seed`、乱数値、先攻結果、シャッフル後の山札を送っても採用しない。
- クライアントが送るのは、許可されたゲーム命令だけである。
- `randomConsumptionCount`をクライアントから受け取らない。
- 不正命令の検証で乱数を消費しない。
- 同じ命令の再送で乱数を二度消費しない。
- 種を試合途中で交換しない。
- 乱数を使わない初期12種類へ、表示上のランダム演出を理由に結果用乱数を追加しない。

## 11. P0-05完了判定

- [x] 乱数の種の形式、作成方法、非公開範囲を固定した。
- [x] `rng.xoshiro128ss.v1`の内部状態、出力、32ビット化を固定した。
- [x] `nextInt`の範囲、拒否抽選、消費数を固定した。
- [x] `shuffle.fisher-yates-desc.v1`の進行方向と抽選範囲を固定した。
- [x] 初期12種類のカード実体ID、初期順、配布順、先攻抽選位置を固定した。
- [x] 乱数を使う処理と使わない処理を区別した。
- [x] `nextUint32`、`nextInt`、拒否抽選、5要素シャッフルの固定試験値を作成した。
- [x] 初期12種類のセットアップ固定試験値を作成した。
- [x] リプレイ、再接続、版変更時の扱いを固定した。
- [x] クライアント入力、重複命令、画面演出による乱数改変を禁止した。

P0-05は完了とする。次はP0-06「ゴールデン試合3件と最終状態ハッシュ」へ進む。P0-06が終わるまで、`game-core`本実装と画面実装は開始しない。
