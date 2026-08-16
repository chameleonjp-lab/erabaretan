# エラバレタン：P3-01 同一端末バトルシェル V1

- 文書状態：P3-01 実装・自動検証記録
- 更新日：2026-08-16
- 対象rulesetId：`ruleset.alpha-12.v1`
- 対象engineVersion：`game-core.alpha-12.v1`

## 1. 目的

game-coreと初期12種類のカード処理を、同じ端末で交互に操作できるブラウザ画面へつなぐ。通信機能やアカウントはまだ追加しない。

## 2. 画面の流れ

```text
タイトル
↓
世界律確認
↓
端末受け渡し確認
↓
対戦画面
↓（攻撃時は端末受け渡し確認）
応答選択
↓（次の手番で必要なら端末受け渡し確認）
対戦画面
↓
神の審定
↓
再戦
```

対戦画面では、現在操作するプレイヤーの手札だけを表示する。相手の手札は枚数だけを表示し、公開状態投影を通して画面へ渡す。

## 3. 実装範囲

- `web/index.html`：ブラウザ入口
- `web/styles.css`：iPhone縦画面を基準にした画面レイアウト
- `web/src/main.ts`：画面表示とボタン操作
- `web/src/local-match.ts`：本番相当のcontent executorを使う同一端末用接続
- `web/src/battle-shell.ts`：画面名、手番説明、カード・世界律表示、端末受け渡し判定の共通変換
- `web/generated/`：GitHub Pages等でそのまま読み込めるブラウザ用JavaScript

開始時・攻撃応答時・手番交代時・再戦時には、次のプレイヤーへ端末を渡して確認する画面を挟む。解放、抑制、カードを1枚捨てて手番終了、防御カードによる応答、そのまま受ける、手札上限超過時の捨て札、降参、再戦を画面から操作できる。手札を整えるカードは、捨てるカードを画面上で選べる。同じ端末用接続でも、通常破棄後の次手番開始、最大ラウンド到達、通常終了までproduction terminal resolverを通す。

## 4. 秘密情報の扱い

画面は`projectPublicState`を使い、操作中のプレイヤー以外のカードID・カード名を受け取らない。previewは本番相当の処理を通し、カードが使えるかの表示にだけ使う。山札順、seed、command履歴、効果キューは画面へ渡さない。

## 5. 検証結果

```text
npm run typecheck                         passed
npm run build:web                         passed
npm test -- --test tests/web/p3-01-battle-shell.test.mjs tests/game-core/*.test.mjs tests/content/*.test.mjs
102 tests passed
```

`tests/web/p3-01-battle-shell.test.mjs`では、画面の段階表示、世界律とカード用語、相手手札の非公開、端末受け渡しの発生条件、カード破棄による手番交代、攻撃→応答→次の手番→降参の実処理、最大10ラウンド後の通常終了を確認する。静的HTTP配信で`web/index.html`と生成された`web/generated/web/src/main.js`が200応答になることも確認した。

この環境では`agent-browser`と実ブラウザが利用できなかったため、画面をクリックする自動確認とiPhone実機での手動操作確認はまだ行っていない。CSSでは横スクロールを抑止し、カード操作のタップ領域を44px以上に固定している。公開前に実機またはブラウザ自動化で文字サイズ、カード操作の押しやすさ、320px/390px縦画面での表示を確認する。
