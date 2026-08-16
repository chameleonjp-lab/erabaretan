import {
  H2_TRIAL_CANDIDATE_ID,
  H2_TRIAL_SOURCE_SHA,
  INITIAL_12_CARD_BY_ID,
  previewAlpha12Command,
} from "../content.ts";
import type { InitialCardDefinition } from "../content.ts";
import {
  projectPublicState,
  summarizeMatch,
} from "../../../packages/game-core/src/index.ts";
import type { Command, GameState, PlayerId, PlayMode, PreviewCommandIntent, PreviewResult } from "../../../packages/game-core/src/index.ts";
import type { DiscardCardPayload, PlayCardPayload } from "../../../packages/game-core/src/commands/types.ts";
import type { PublicCardRef, PublicGameState } from "../../../packages/game-core/src/public-state.ts";
import type { MatchSummary } from "../../../packages/game-core/src/summary.ts";
import {
  battlePrompt,
  actionDescription,
  cardDescription,
  effectHint,
  handoffTargetForStateChange,
  judgmentHint,
  modeLabel,
  phaseLabel,
  playerLabel,
  previewJudgmentHint,
  roleLabel,
  requiresActionConfirmation,
  screenForPhase,
  viewerForGameState,
  worldPreview,
  type ShellScreen,
} from "./battle-shell.ts";
import { applyLocalCommand, createLocalMatch, trialSeedForMatch, H2_TRIAL_GAME_COUNT } from "./local-match.ts";
import {
  collectPublicFactBatch,
  composeResultJudgment,
  type PublicFactBatch,
  type ResultEvent,
  type ResultTurningPoint,
} from "./result-summary.ts";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("#app is required");
const app = appElement;

const PLAYER_IDS: readonly [PlayerId, PlayerId] = ["P1", "P2"];

interface ShellState {
  screen: ShellScreen;
  state: GameState | null;
  handoffFor: PlayerId | null;
  pendingAction: PendingActionConfirmation | null;
  notice: string;
  rematchNumber: number;
  commandNumber: number;
  factBatches: readonly PublicFactBatch[];
}

interface PendingActionConfirmation {
  readonly command: Command;
  readonly cardName: string;
  readonly mode: PlayMode;
  readonly actionText: string;
  readonly previewText: string;
}

const shell: ShellState = {
  screen: "TITLE",
  state: null,
  handoffFor: null,
  pendingAction: null,
  notice: "",
  rematchNumber: 0,
  commandNumber: 0,
  factBatches: [],
};

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function renderTrialIdentity(): string {
  return `<div class="trial-identity"><span class="trial-badge">H2試遊版</span><strong>${escapeHtml(H2_TRIAL_CANDIDATE_ID)}</strong><small>ビルド元SHA：${escapeHtml(H2_TRIAL_SOURCE_SHA)}</small></div>`;
}

function renderTrialMatchMeta(state: GameState): string {
  return `<div class="trial-match-meta"><span>試遊 ${shell.rematchNumber} / ${H2_TRIAL_GAME_COUNT}試合</span><span>seed <code>${escapeHtml(trialSeedForMatch(shell.rematchNumber))}</code></span><span>先攻：${escapeHtml(playerLabel(state.firstPlayerId))}</span></div>`;
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === PLAYER_IDS[0] ? PLAYER_IDS[1] : PLAYER_IDS[0];
}

function currentViewerId(state: GameState): PlayerId {
  return viewerForGameState(state);
}

function publicStateForViewer(state: GameState): PublicGameState | null {
  const result = projectPublicState(state, { kind: "PLAYER", playerId: currentViewerId(state) });
  return result.ok ? result.state : null;
}

function commandId(prefix: string): string {
  shell.commandNumber += 1;
  return `p3-01-ui.${shell.rematchNumber}.${prefix}.${String(shell.commandNumber).padStart(4, "0")}`;
}

function friendlyError(message: string): string {
  if (message.includes("CARD_CONDITION_NOT_MET")) return "このカードは今の状況では使えません。";
  if (message.includes("CARD_NOT_IN_HAND")) return "そのカードは手札にありません。";
  if (message.includes("NOT_ACTIVE_PLAYER")) return "今はこのプレイヤーの手番ではありません。";
  if (message.includes("NOT_RESPONDING_PLAYER")) return "今は応答するプレイヤーではありません。";
  return message;
}

function sendCommand(command: Command): void {
  if (!shell.state) return;
  const previousState = shell.state;
  const result = applyLocalCommand(shell.state, command);
  if (!result.accepted) {
    shell.notice = friendlyError(result.error?.message ?? "処理を受け付けられませんでした。");
    render();
    return;
  }
  shell.state = result.state;
  if (!result.replayed) {
    shell.factBatches = [...shell.factBatches, collectPublicFactBatch(result.events as readonly ResultEvent[], PLAYER_IDS)];
  }
  shell.pendingAction = null;
  shell.handoffFor = handoffTargetForStateChange(previousState, result.state);
  shell.notice = result.events.length > 0 ? "処理しました。" : "";
  shell.screen = screenForPhase(shell.state.phase);
  render();
}

function actionCommand(commandType: "PLAY_CARD", playerId: PlayerId, payload: PlayCardPayload): Command;
function actionCommand(commandType: "DISCARD_FOR_ACTION", playerId: PlayerId, payload: DiscardCardPayload): Command;
function actionCommand(commandType: "DISCARD_OVERFLOW", playerId: PlayerId, payload: DiscardCardPayload): Command;
function actionCommand(
  commandType: "PLAY_CARD" | "DISCARD_FOR_ACTION" | "DISCARD_OVERFLOW",
  playerId: PlayerId,
  payload: PlayCardPayload | DiscardCardPayload,
): Command {
  const base = {
    commandId: commandId(commandType.toLowerCase()),
    playerId,
    expectedRevision: shell.state?.revision ?? 0,
  };
  if (commandType === "PLAY_CARD") return { ...base, commandType, payload: payload as PlayCardPayload };
  return { ...base, commandType, payload: payload as DiscardCardPayload };
}

function startBattle(): void {
  shell.rematchNumber += 1;
  const nextState = createLocalMatch(shell.rematchNumber);
  shell.state = nextState;
  shell.pendingAction = null;
  shell.handoffFor = handoffTargetForStateChange(null, nextState);
  shell.notice = "同じ端末で交互に操作します。";
  shell.factBatches = [];
  shell.screen = "BATTLE";
  render();
}

function cardDefinition(card: PublicCardRef): InitialCardDefinition | null {
  return INITIAL_12_CARD_BY_ID[card.cardDefinitionId] ?? null;
}

function previewResult(state: GameState, intent: PreviewCommandIntent): PreviewResult {
  return previewAlpha12Command(state, { kind: "PLAYER", playerId: currentViewerId(state) }, intent);
}

function previewStatusFromResult(result: PreviewResult): string {
  if (result.status === "READY") return result.certainty === "PARTIAL" ? "予測は一部未確定" : "実行できます";
  if (result.status === "REJECTED") return "今は使えません";
  return "予測できません";
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function previewLabel(state: GameState, intent: PreviewCommandIntent, result: PreviewResult): string {
  if (result.status === "REJECTED") return "今は使えません";
  if (result.status === "UNAVAILABLE") return "予測できません";

  const parts: string[] = [];
  const isCardAction = intent.commandType === "PLAY_CARD" || intent.commandType === "SELECT_RESPONSE";
  const cardInstanceId = isCardAction ? intent.payload.cardInstanceId : undefined;
  const cardDefinitionId = cardInstanceId ? state.cardInstances[cardInstanceId]?.cardDefinitionId : undefined;
  if (intent.commandType === "PLAY_CARD" && result.certainty === "PARTIAL" && result.pendingAttackBaseDamage !== undefined) {
    parts.push(`相手へ${result.pendingAttackBaseDamage}（応答で変化）`);
  } else if (intent.commandType === "PLAY_CARD") {
    const targetPlayerId = intent.payload.targetPlayerId ?? intent.playerId;
    const hitPointDelta = result.delta.playerHitPointDeltas[targetPlayerId] ?? 0;
    if (hitPointDelta !== 0) parts.push(`${targetPlayerId === intent.playerId ? "自分" : "相手"}HP ${signed(hitPointDelta)}`);
  }
  if (intent.commandType === "SELECT_RESPONSE" && cardDefinitionId) {
    parts.push(actionDescription(cardDefinitionId, "RESPONSE"));
  }
  if (isCardAction) {
    const world = worldPreview(state, result);
    if (world) {
      parts.push(`世界 ${world.before} → ${world.after}${world.uncertain ? "（応答で変化）" : ""}`);
      if (world.crossedThresholds.length > 0) {
        parts.push(`${world.crossedThresholds.join("・")}境界を通過`);
      }
    }
    const judgment = previewJudgmentHint(state, intent.playerId, result);
    if (judgment) {
      parts.push(`審定傾向 ${judgment.before.label} → ${judgment.after.label}${judgment.uncertain ? "（応答で変化）" : ""}`);
    }
  }
  if (intent.commandType === "DISCARD_FOR_ACTION") parts.push("この手番を終了");
  if (parts.length === 0 && intent.commandType === "PLAY_CARD") {
    parts.push(actionDescription(cardDefinitionId ?? "", intent.payload.playMode));
  }
  if (parts.length === 0) parts.push(previewStatusFromResult(result));
  if (result.certainty === "PARTIAL") parts.push("一部未確定");
  return parts.join(" / ");
}

function renderCardActions(state: GameState, card: PublicCardRef, definition: InitialCardDefinition): string {
  const viewerId = currentViewerId(state);
  if (state.phase === "RESPONSE_SELECTION" && definition.modes.RESPONSE) {
    const intent: PreviewCommandIntent = {
      commandType: "SELECT_RESPONSE",
      playerId: viewerId,
      payload: { cardInstanceId: card.cardInstanceId, responseMode: "RESPONSE" },
    };
    const result = previewResult(state, intent);
    const disabled = shell.pendingAction || result.status === "REJECTED" ? " disabled" : "";
    return `<div class="action-row"><button class="card-action" data-response-card="${escapeHtml(card.cardInstanceId)}" title="${escapeHtml(previewStatusFromResult(result))}"${disabled}>応答する</button><span class="action-hint">${escapeHtml(previewLabel(state, intent, result))}</span></div>`;
  }
  if (state.phase !== "ACTION_SELECTION" || state.activePlayerId !== viewerId) return "";

  const modes = Object.keys(definition.modes).filter((mode) => mode !== "RESPONSE") as PlayMode[];
  const discardCardId = definition.cardDefinitionId === "intervention.careful-redraw.v1"
    ? state.players[viewerId].hand.find((cardInstanceId) => cardInstanceId !== card.cardInstanceId)
    : undefined;
  const discardOptions = definition.cardDefinitionId === "intervention.careful-redraw.v1"
    ? state.players[viewerId].hand
      .filter((cardInstanceId) => cardInstanceId !== card.cardInstanceId)
      .map((cardInstanceId) => {
        const other = state.cardInstances[cardInstanceId];
        return `<option value="${escapeHtml(cardInstanceId)}">${escapeHtml(INITIAL_12_CARD_BY_ID[other.cardDefinitionId]?.displayName ?? other.cardDefinitionId)}</option>`;
      }).join("")
    : "";
  const select = discardOptions
    ? `<label class="mini-select">捨てる<select data-redraw-select="${escapeHtml(card.cardInstanceId)}">${discardOptions}</select></label>`
    : "";
  const buttons = modes.map((mode) => {
    const condition = definition.conditions[mode];
    const target = condition?.requiresOpponentTarget ? opponentOf(viewerId) : undefined;
    const intent: PreviewCommandIntent = {
      commandType: "PLAY_CARD",
      playerId: viewerId,
      payload: {
        cardInstanceId: card.cardInstanceId,
        playMode: mode,
        ...(target ? { targetPlayerId: target } : {}),
        ...(discardCardId ? { discardCardInstanceId: discardCardId } : {}),
      },
    };
    const result = previewResult(state, intent);
    const disabled = shell.pendingAction || result.status === "REJECTED" ? " disabled" : "";
    return `<div class="action-row"><button class="card-action" data-play-card="${escapeHtml(card.cardInstanceId)}" data-play-mode="${escapeHtml(mode)}" data-target-player="${escapeHtml(target)}" title="${escapeHtml(previewStatusFromResult(result))}"${disabled}>${escapeHtml(modeLabel(mode))}</button><span class="action-hint">${escapeHtml(previewLabel(state, intent, result))}</span></div>`;
  }).join("");
  const discardIntent: PreviewCommandIntent = {
    commandType: "DISCARD_FOR_ACTION",
    playerId: viewerId,
    payload: { cardInstanceId: card.cardInstanceId },
  };
  const discardResult = previewResult(state, discardIntent);
  const disabled = shell.pendingAction || discardResult.status === "REJECTED" ? " disabled" : "";
  const discardButton = `<div class="action-row"><button class="card-action" data-discard-action="${escapeHtml(card.cardInstanceId)}" title="${escapeHtml(previewStatusFromResult(discardResult))}"${disabled}>捨てて終了</button><span class="action-hint">この手番を終了</span></div>`;
  return `${select}<div class="card-actions">${buttons}${discardButton}</div>`;
}

function renderCard(state: GameState, card: PublicCardRef): string {
  const definition = cardDefinition(card);
  if (!definition) return "";
  return `<article class="hand-card">
    <div class="card-topline"><span class="card-role">${escapeHtml(roleLabel(definition.role))}</span><span class="card-impact ${escapeHtml(definition.worldImpactType.toLowerCase())}">${escapeHtml(definition.worldImpactType === "DAMAGE" ? "世界-" : definition.worldImpactType === "RESTORE" ? "世界+" : "中立")}</span></div>
    <h3>${escapeHtml(definition.displayName)}</h3>
    <p class="card-description">${escapeHtml(cardDescription(definition.cardDefinitionId))}</p>
    ${renderCardActions(state, card, definition)}
  </article>`;
}

function renderPlayers(state: GameState, publicState: PublicGameState): string {
  return `<section class="player-strip" aria-label="プレイヤー情報">${publicState.players.map((player) => {
    const current = player.playerId === (publicState.respondingPlayerId ?? publicState.activePlayerId);
    const hint = judgmentHint(state, player.playerId);
    return `<article class="player-panel ${current ? "is-current" : ""}">
      <div class="player-name">${escapeHtml(playerLabel(player.playerId))}${current ? "<span class=\"turn-badge\">いま</span>" : ""}</div>
      <div class="hp-line"><span>体力</span><strong>${player.hp}</strong><span>/ ${player.maxHp}</span></div>
      <div class="mini-stats"><span>世界損傷 ${player.worldDamageResponsibility}</span><span>世界再生 ${player.effectiveWorldRestore}</span><span>手札 ${player.hand.count}</span></div>
      <div class="judgment-hint ${hint.level.toLowerCase()}">審定傾向：${escapeHtml(hint.label)}</div>
    </article>`;
  }).join("")}</section>`;
}

function renderWorld(publicState: PublicGameState): string {
  const world = publicState.world;
  return `<section class="world-panel" aria-label="世界の状態">
    <div class="world-heading"><div><span class="eyebrow">世界律：砕けゆく原初界</span><h2>共有世界</h2></div><strong>${world.durability}<small> / ${world.maxDurability}</small></strong></div>
    <progress max="${world.maxDurability}" value="${world.durability}" aria-label="世界耐久"></progress>
    <div class="thresholds"><span class="threshold ${world.triggeredThresholds.includes(75) ? "passed" : ""}">75</span><span class="threshold ${world.triggeredThresholds.includes(50) ? "passed" : ""}">50</span><span class="threshold ${world.triggeredThresholds.includes(25) ? "passed" : ""}">25</span><span class="next-boundary">${escapeHtml(effectHint(publicState))}</span></div>
    <p class="judgment-note">審定傾向は、今の公開状態で審定した場合の目安です。正確な点数は試合終了後に表示します。</p>
    ${publicState.activeField ? `<p class="field-note">フィールド：${escapeHtml(INITIAL_12_CARD_BY_ID[publicState.activeField.fieldDefinitionId]?.displayName ?? publicState.activeField.fieldDefinitionId)}</p>` : ""}
  </section>`;
}

function renderPendingAction(): string {
  const pending = shell.pendingAction;
  if (!pending) return "";
  return `<section class="decision-panel confirm-panel" aria-live="polite"><span class="eyebrow">行動確認</span><h2>${escapeHtml(pending.cardName)} / ${escapeHtml(modeLabel(pending.mode))}</h2><p>${escapeHtml(pending.actionText)}</p><p class="confirm-preview">${escapeHtml(pending.previewText)}</p><div class="confirm-actions"><button class="primary-button" data-confirm-action>この行動を実行</button><button class="secondary-button" data-cancel-action>やめる</button></div></section>`;
}

function renderBattleControls(state: GameState, publicState: PublicGameState, viewerId: PlayerId): string {
  const ownPlayer = publicState.players.find((player) => player.playerId === viewerId);
  const ownCards = ownPlayer?.hand.cards ?? [];
  if (shell.pendingAction) return renderPendingAction();
  if (state.phase === "RESPONSE_SELECTION") {
    const attack = publicState.pendingInteraction;
    return `<section class="decision-panel response-panel"><span class="eyebrow">応答選択</span><h2>${escapeHtml(battlePrompt(publicState, viewerId))}</h2><p>相手の攻撃力：<strong>${attack?.baseDamage ?? "未確定"}</strong></p><button class="secondary-button" data-accept-damage>そのまま受ける</button></section>`;
  }
  if (state.phase === "TURN_START" && ownPlayer && ownPlayer.hand.count > state.ruleset.handLimit) {
    return `<section class="decision-panel"><span class="eyebrow">手札整理</span><h2>手札上限を超えています</h2><p>捨てるカードを1枚選んでください。</p><div class="overflow-actions">${ownCards.map((card) => `<button class="secondary-button" data-overflow-card="${escapeHtml(card.cardInstanceId)}">${escapeHtml(cardDefinition(card)?.displayName ?? card.cardDefinitionId)}を捨てる</button>`).join("")}</div></section>`;
  }
  if (state.phase === "ACTION_SELECTION" && state.activePlayerId === viewerId) {
    return `<section class="decision-panel"><span class="eyebrow">行動選択</span><h2>${escapeHtml(battlePrompt(publicState, viewerId))}</h2><p>解放は強い効果、抑制は世界を守る効果です。</p><button class="danger-button" data-surrender>降参して結果を見る</button></section>`;
  }
  return `<section class="decision-panel"><span class="eyebrow">${escapeHtml(phaseLabel(state.phase))}</span><h2>${escapeHtml(battlePrompt(publicState, viewerId))}</h2></section>`;
}

function renderBattle(): string {
  if (!shell.state) return "";
  const viewerId = currentViewerId(shell.state);
  const publicState = publicStateForViewer(shell.state);
  if (!publicState) return renderError("公開状態を作れませんでした。");
  const ownPlayer = publicState.players.find((player) => player.playerId === viewerId);
  const hand = ownPlayer?.hand.cards ?? [];
  return `<main class="screen battle-screen">
    <header class="topbar"><div><span class="eyebrow">エラバレタン / H2試遊</span><h1>砕けゆく原初界</h1>${renderTrialMatchMeta(shell.state)}</div><span class="phase-chip">${escapeHtml(phaseLabel(publicState.phase))}</span></header>
    ${renderWorld(publicState)}
    ${renderPlayers(shell.state, publicState)}
    <section class="decision-area">${renderBattleControls(shell.state, publicState, viewerId)}</section>
    <section class="hand-section"><div class="section-heading"><div><span class="eyebrow">${escapeHtml(playerLabel(viewerId))}の手札</span><h2>カードを選ぶ</h2></div><span>${hand.length}枚</span></div><div class="hand-grid">${hand.length ? hand.map((card) => renderCard(shell.state!, card)).join("") : "<p class=\"empty-note\">手札はありません。</p>"}</div></section>
    ${shell.notice ? `<p class="notice" role="status">${escapeHtml(shell.notice)}</p>` : ""}
  </main>`;
}

function renderHandoff(playerId: PlayerId): string {
  return `<main class="screen handoff-screen"><span class="eyebrow">同じ端末で交互に操作</span><h1>端末を${escapeHtml(playerLabel(playerId))}へ渡してください</h1><p>前のプレイヤーに手札を見せないように、端末を渡してから確認してください。</p><div class="handoff-card"><strong>次の操作担当</strong><span>${escapeHtml(playerLabel(playerId))}</span></div><button class="primary-button wide" data-handoff-ready>確認して手札を見る</button></main>`;
}

function endReasonText(summary: MatchSummary): string {
  if (summary.endKind === "SURRENDER") {
    const surrendering = summary.players.find((player) => player.playerId !== summary.battle.winnerId);
    return surrendering ? `${playerLabel(surrendering.playerId)}の降参で戦闘が終了しました。` : "降参で戦闘が終了しました。";
  }
  if (summary.endKind !== "NORMAL") return `終了種別：${summary.endKind}`;
  const reasons = summary.normalEndReasons;
  const defeated = summary.players.filter((player) => player.survivalEvaluation !== null && player.score !== null && player.playerId !== summary.battle.winnerId);
  const reasonText = reasons.map((reason) => {
    if (reason === "PLAYER_DEFEATED") return defeated.length === 1 ? `${playerLabel(defeated[0].playerId)}の体力が0` : "両者の体力が0";
    if (reason === "WORLD_COLLAPSED") return "世界耐久が0となり世界崩壊";
    return "最大ラウンドを終えた";
  });
  return `${reasonText.join("、")}で戦闘が終了しました。`;
}

function scoreText(value: number | null): string {
  return value === null ? "—" : `${value}点`;
}

function turningPointText(point: ResultTurningPoint): string {
  const firstPlayer = point.playerIds[0] ? playerLabel(point.playerIds[0]) : "誰か";
  if (point.kind === "WORLD_DAMAGE") return `${firstPlayer}が世界へ${point.amount ?? 0}損傷を与えました。`;
  if (point.kind === "WORLD_RESTORE") return `${firstPlayer}が世界を${point.amount ?? 0}回復しました。`;
  if (point.kind === "WORLD_THRESHOLD") return `世界が${point.thresholds.join("・")}境界を通過しました。`;
  if (point.kind === "PLAYER_DEFEATED") return `${point.playerIds.map(playerLabel).join("・") || "プレイヤー"}の体力が0になりました。`;
  if (point.kind === "WORLD_COLLAPSED") {
    const damageText = point.amount ? `${firstPlayer}の世界への${point.amount}損傷を契機に、` : "";
    const defeatedText = point.amount && point.playerIds.length > 1 ? ` ${playerLabel(point.playerIds[point.playerIds.length - 1])}の体力も0になり、` : "";
    return `${damageText}${defeatedText}世界耐久が0となり、世界が崩壊しました。`;
  }
  if (point.kind === "MAX_ROUNDS_REACHED") return "最大ラウンドに到達し、決着なしで戦闘が終了しました。";
  return `${firstPlayer}の降参で戦闘が終了しました。`;
}

function renderTurningPoints(points: readonly ResultTurningPoint[]): string {
  if (points.length === 0) {
    return `<section class="turning-points"><h2>試合を変えた転換点</h2><p>大きな公開転換点は記録されませんでした。</p></section>`;
  }
  return `<section class="turning-points"><h2>試合を変えた転換点</h2><ol class="turning-point-list">${points.map((point) => `<li class="turning-point">${escapeHtml(turningPointText(point))}</li>`).join("")}</ol></section>`;
}

function selectionReasonText(summary: MatchSummary): string {
  if (summary.endKind !== "NORMAL") return "非通常終了のため、神の審定は行われませんでした。";
  if (summary.divineSelection.status === "TIE") {
    return `合計点が同点のため、神の選定は同率です。`;
  }
  const winnerId = summary.divineSelection.winnerId;
  if (!winnerId) return "神の選定者はありません。";
  const winner = summary.players.find((player) => player.playerId === winnerId);
  const other = summary.players.find((player) => player.playerId !== winnerId);
  if (!winner || !other || winner.score === null || other.score === null) return `${playerLabel(winnerId)}を選定しました。`;
  return `${playerLabel(winnerId)}を選定。合計${winner.score}点が${playerLabel(other.playerId)}の${other.score}点を上回りました。`;
}


function renderTrialRecord(summary: MatchSummary): string {
  if (!shell.state) return "";
  const state = shell.state;
  const questions = [
    "75境界が、カードを選ぶ理由として理解できましたか？",
    "星砕きの「解放」は、使いたい行動として魅力的でしたか？",
    "星砕きの「抑制」が、毎回の正解に感じられませんでしたか？",
    "75境界の直前で、試合が長く停滞しませんでしたか？",
    "神の選定者を、結果が出る前にある程度予想できましたか？",
  ];
  return `<section class="trial-record"><span class="eyebrow">人間試遊の記録</span><h2>試合 ${shell.rematchNumber} の記録</h2><p class="trial-record-meta">候補：${escapeHtml(H2_TRIAL_CANDIDATE_ID)} / seed：<code>${escapeHtml(trialSeedForMatch(shell.rematchNumber))}</code> / 先攻：${escapeHtml(playerLabel(state.firstPlayerId))} / 終了：${escapeHtml(summary.endKind)} / ラウンド：${state.roundNumber} / 75境界：${state.world.triggeredThresholds.includes(75) ? "到達" : "未到達"}</p><div class="trial-questions">${questions.map((question, index) => `<label><span>${index + 1}. ${escapeHtml(question)}</span><textarea data-trial-answer="${index}" rows="2" placeholder="短く記録"></textarea></label>`).join("")}</div><button class="secondary-button wide" data-copy-trial-record>この試合の記録をコピー</button><p class="trial-record-notice" data-trial-record-notice role="status"></p><p class="small-note">記録はこの画面内だけに置かれ、どこにも送信されません。</p></section>`;
}

async function copyTrialRecord(): Promise<void> {
  if (!shell.state) return;
  const result = summarizeMatch(shell.state);
  if (!result.ok) return;
  const answers = Array.from(app.querySelectorAll<HTMLTextAreaElement>("[data-trial-answer]")).map((input) => input.value.trim());
  const notice = app.querySelector<HTMLElement>("[data-trial-record-notice]");
  if (answers.some((answer) => answer.length === 0)) {
    if (notice) notice.textContent = "5問すべてに回答してからコピーしてください。";
    return;
  }
  const state = shell.state;
  const text = [
    `candidate=${H2_TRIAL_CANDIDATE_ID}`,
    `sourceSha=${H2_TRIAL_SOURCE_SHA}`,
    `match=${shell.rematchNumber}/${H2_TRIAL_GAME_COUNT}`,
    `seed=${trialSeedForMatch(shell.rematchNumber)}`,
    `firstPlayer=${state.firstPlayerId}`,
    `endKind=${result.summary.endKind}`,
    `round=${state.roundNumber}`,
    `threshold75=${state.world.triggeredThresholds.includes(75)}`,
    ...answers.map((answer, index) => `q${index + 1}=${answer}`),
  ].join("\n");
  if (!navigator.clipboard) {
    if (notice) notice.textContent = "自動コピーに対応していません。画面の記録を手動で保存してください。";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (notice) notice.textContent = "試遊記録をコピーしました。";
  } catch {
    if (notice) notice.textContent = "自動コピーできませんでした。回答は画面に残しています。手動で保存してください。";
  }
}

function renderResult(): string {
  if (!shell.state) return "";
  const result = summarizeMatch(shell.state);
  if (!result.ok) return renderError(`結果を表示できません：${result.code}`);
  const summary = result.summary;
  const resultJudgment = composeResultJudgment(summary, shell.factBatches);
  const battleWinner = summary.battle.winnerId ? playerLabel(summary.battle.winnerId) : "引き分け";
  const divineWinner = summary.divineSelection.winnerId ? playerLabel(summary.divineSelection.winnerId) : "選定なし";
  return `<main class="screen result-screen">
    <header class="result-hero"><span class="eyebrow">試合終了</span><h1>神の審定</h1><p>戦闘の勝者と、世界への責任を分けて確認します。</p></header>
    <p class="result-reason">${escapeHtml(endReasonText(summary))}</p>
    <section class="result-cards"><article><span class="eyebrow">戦闘勝者</span><strong>${escapeHtml(battleWinner)}</strong></article></section>
    <section class="score-table"><h2>評価の内訳</h2>${summary.players.map((player) => `<div class="score-row"><span>${escapeHtml(playerLabel(player.playerId))}</span><strong>${escapeHtml(scoreText(player.score))}</strong><small>生存評価 ${escapeHtml(scoreText(player.survivalEvaluation))} / 世界評価 ${escapeHtml(scoreText(player.worldEvaluation))}</small><small>世界損傷 ${player.worldDamageResponsibility} / 世界再生 ${player.effectiveWorldRestore}${player.causedWorldCollapse ? " / 破界責任あり" : ""}</small></div>`).join("")}</section>
    <p class="result-explanation">${escapeHtml(summary.endKind === "NORMAL" ? "神の選定は、生存・世界損傷・世界再生・破界責任を合わせた正式評価です。" : "非通常終了のため、神の審定は行われませんでした。")}</p>
    ${renderTurningPoints(resultJudgment.turningPoints)}
    <section class="result-cards result-selection"><article><span class="eyebrow">神の選定者</span><strong>${escapeHtml(divineWinner)}</strong><p class="selection-reason">${escapeHtml(selectionReasonText(summary))}</p></article></section>
    ${renderTrialRecord(summary)}
    <button class="primary-button wide" data-rematch>もう一度遊ぶ</button>
  </main>`;
}

function renderTitle(): string {
  return `<main class="screen title-screen"><div class="title-mark">${renderTrialIdentity()}<span class="eyebrow">短時間対戦カードゲーム</span><h1>エラバレタン</h1><p>相手を倒すか、世界を守るか。最後に神が戦い方を査定します。</p></div><div class="title-actions"><button class="primary-button wide" data-world-law>世界律を確認する</button><p class="small-note">P3-04 結果要約・転換点 / 2人で交互に操作</p></div></main>`;
}

function renderWorldLaw(): string {
  return `<main class="screen law-screen"><span class="eyebrow">世界律確認</span><h1>砕けゆく原初界</h1><p class="lead">強いカードは相手だけでなく、共有世界にも影響します。世界を壊しすぎると、戦闘に勝っても神の評価を落とします。</p><div class="law-rules"><div><strong>75</strong><span>世界が傷つき、守りにくくなる</span></div><div><strong>50</strong><span>世界を戻した者が評価される</span></div><div><strong>25</strong><span>世界が脆くなり、危険が増える</span></div></div><section class="trial-checkpoint"><span class="eyebrow">固定場面の確認</span><strong>世界83で星砕きを使うと</strong><span>V1：83 → 76（75未到達）</span><span>H2：83 → 75（75境界を通過）</span></section><p class="small-note">まずは解放と抑制を使い分け、相手と世界の両方を見てください。</p><button class="primary-button wide" data-start-battle>戦闘を開始する</button></main>`;
}

function renderError(message: string): string {
  return `<main class="screen error-screen"><h1>一時停止</h1><p>${escapeHtml(message)}</p><button class="secondary-button" data-world-law>最初に戻る</button></main>`;
}

function render(): void {
  if (shell.screen === "TITLE") app.innerHTML = renderTitle();
  else if (shell.screen === "WORLD_LAW") app.innerHTML = renderWorldLaw();
  else if (shell.screen === "RESULT") app.innerHTML = renderResult();
  else if (shell.handoffFor) app.innerHTML = renderHandoff(shell.handoffFor);
  else app.innerHTML = renderBattle();
}

app.addEventListener("click", (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("button") : null;
  if (!target) return;
  if (target.dataset.worldLaw !== undefined) {
    shell.screen = "WORLD_LAW";
    shell.notice = "";
    render();
    return;
  }
  if (target.dataset.startBattle !== undefined) {
    startBattle();
    return;
  }
  if (target.dataset.rematch !== undefined) {
    startBattle();
    return;
  }
  if (target.dataset.handoffReady !== undefined) {
    shell.handoffFor = null;
    shell.notice = "";
    render();
    return;
  }
  if (target.dataset.cancelAction !== undefined) {
    shell.pendingAction = null;
    render();
    return;
  }
  if (target.dataset.confirmAction !== undefined) {
    const pending = shell.pendingAction;
    shell.pendingAction = null;
    if (pending) sendCommand(pending.command);
    return;
  }
  if (target.dataset.copyTrialRecord !== undefined) {
    void copyTrialRecord();
    return;
  }
  if (!shell.state) return;
  const viewerId = currentViewerId(shell.state);
  if (target.dataset.surrender !== undefined) {
    sendCommand({ commandId: commandId("surrender"), playerId: viewerId, expectedRevision: shell.state.revision, commandType: "SURRENDER", payload: {} });
    return;
  }
  if (target.dataset.acceptDamage !== undefined) {
    sendCommand({ commandId: commandId("accept-damage"), playerId: viewerId, expectedRevision: shell.state.revision, commandType: "ACCEPT_DAMAGE", payload: {} });
    return;
  }
  if (target.dataset.overflowCard !== undefined) {
    sendCommand(actionCommand("DISCARD_OVERFLOW", viewerId, { cardInstanceId: target.dataset.overflowCard }));
    return;
  }
  if (target.dataset.discardAction !== undefined) {
    sendCommand(actionCommand("DISCARD_FOR_ACTION", viewerId, { cardInstanceId: target.dataset.discardAction }));
    return;
  }
  if (target.dataset.responseCard !== undefined) {
    sendCommand({ commandId: commandId("response"), playerId: viewerId, expectedRevision: shell.state.revision, commandType: "SELECT_RESPONSE", payload: { cardInstanceId: target.dataset.responseCard, responseMode: "RESPONSE" } });
    return;
  }
  if (target.dataset.playCard !== undefined && target.dataset.playMode !== undefined) {
    const definitionId = shell.state.cardInstances[target.dataset.playCard]?.cardDefinitionId;
    const discardSelect = Array.from(app.querySelectorAll<HTMLSelectElement>("[data-redraw-select]"))
      .find((select) => select.dataset.redrawSelect === target.dataset.playCard);
    const targetPlayer = target.dataset.targetPlayer || undefined;
    const playPayload: PlayCardPayload = {
      cardInstanceId: target.dataset.playCard,
      playMode: target.dataset.playMode as PlayMode,
      ...(targetPlayer ? { targetPlayerId: targetPlayer as PlayerId } : {}),
      ...(definitionId === "intervention.careful-redraw.v1" && discardSelect?.value ? { discardCardInstanceId: discardSelect.value } : {}),
    };
    const playIntent: PreviewCommandIntent = {
      commandType: "PLAY_CARD",
      playerId: viewerId,
      payload: playPayload,
    };
    const command = actionCommand("PLAY_CARD", viewerId, playPayload);
    if (definitionId && requiresActionConfirmation(definitionId, playPayload.playMode)) {
      const preview = previewResult(shell.state, playIntent);
      if (preview.status === "REJECTED") {
        shell.notice = "この行動は今は使えません。カードの条件を確認してください。";
        render();
        return;
      }
      shell.pendingAction = {
        command,
        cardName: INITIAL_12_CARD_BY_ID[definitionId]?.displayName ?? definitionId,
        mode: playPayload.playMode,
        actionText: cardDescription(definitionId),
        previewText: previewLabel(shell.state, playIntent, preview),
      };
      render();
      return;
    }
    sendCommand(command);
  }
});

render();
