import type { GamePhase, GameState, PlayerId } from "../../packages/game-core/src/state/types.ts";
import type { PublicGameState } from "../../packages/game-core/src/public-state.ts";

export type ShellScreen = "TITLE" | "WORLD_LAW" | "BATTLE" | "RESULT";

export function screenForPhase(phase: GamePhase): ShellScreen {
  return phase === "FINISHED" ? "RESULT" : "BATTLE";
}

export function viewerForGameState(state: Pick<GameState, "activePlayerId" | "respondingPlayerId">): PlayerId {
  return state.respondingPlayerId ?? state.activePlayerId ?? "P1";
}

/** Returns the player who may safely see a handoff screen after a state change. */
export function handoffTargetForStateChange(previousState: GameState | null, nextState: GameState): PlayerId | null {
  if (nextState.phase === "FINISHED") return null;
  const nextViewer = viewerForGameState(nextState);
  if (!previousState) return nextViewer;
  return viewerForGameState(previousState) === nextViewer ? null : nextViewer;
}

export function phaseLabel(phase: GamePhase): string {
  switch (phase) {
    case "SETUP": return "準備";
    case "TURN_START": return "手番開始";
    case "ACTION_SELECTION": return "行動選択";
    case "RESPONSE_SELECTION": return "応答選択";
    case "RESOLUTION": return "効果解決";
    case "TURN_END": return "手番終了";
    case "JUDGMENT": return "神の審定";
    case "FINISHED": return "試合終了";
  }
}

export function playerLabel(playerId: PlayerId | null | undefined): string {
  if (!playerId) return "—";
  return playerId === "P1" ? "守護者A" : playerId === "P2" ? "守護者B" : playerId;
}

export function roleLabel(role: string): string {
  switch (role) {
    case "ATTACK": return "攻撃";
    case "DEFENSE": return "防御";
    case "FIELD": return "フィールド";
    case "INTERVENTION": return "介入";
    default: return role;
  }
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case "RELEASE": return "解放";
    case "RESTRAIN": return "抑制";
    case "RESPONSE": return "応答";
    default: return mode;
  }
}

export function battlePrompt(state: PublicGameState, viewerPlayerId: PlayerId): string {
  if (state.phase === "RESPONSE_SELECTION") {
    return state.respondingPlayerId === viewerPlayerId
      ? "攻撃を受けています。防御するか、そのまま受けるか選んでください。"
      : `${playerLabel(state.respondingPlayerId)}の応答を待っています。`;
  }
  if (state.phase === "TURN_START") {
    return state.players.find((player) => player.playerId === viewerPlayerId)?.hand.count
      ? "手札が上限を超えています。捨てるカードを選んでください。"
      : "手番を準備しています。";
  }
  if (state.phase === "ACTION_SELECTION") {
    return state.activePlayerId === viewerPlayerId
      ? "カードを1枚選び、解放するか抑制するか決めてください。"
      : `${playerLabel(state.activePlayerId)}の行動を待っています。`;
  }
  if (state.phase === "RESOLUTION") return "カードの効果を解決しています。";
  if (state.phase === "FINISHED") return "試合が終わりました。神の審定を確認してください。";
  return phaseLabel(state.phase);
}

export function nextWorldBoundary(state: PublicGameState): number | null {
  return state.world.triggeredThresholds.includes(75)
    ? state.world.triggeredThresholds.includes(50)
      ? state.world.triggeredThresholds.includes(25) ? null : 25
      : 50
    : 75;
}

export function effectHint(state: PublicGameState): string {
  const next = nextWorldBoundary(state);
  return next === null ? "すべての境界を通過" : `次の境界 ${next}`;
}
