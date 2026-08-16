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

const CARD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "attack.steadfast-strike.v1": "相手に6ダメージ。世界は傷つけません。",
  "attack.star-breaker.v1": "解放で相手16・世界7。抑制で次に受ける攻撃を3軽減します。",
  "attack.rift-pebble.v1": "解放で相手4・世界2。抑制で次に受ける攻撃を1軽減します。",
  "defense.guardian-veil.v1": "応答で、いま受けている攻撃を7防ぎます。",
  "defense.ashen-bulwark.v1": "応答で、いま受けている攻撃を12防ぎますが、世界4を傷つけます。",
  "intervention.verdant-bargain.v1": "応答で攻撃を3軽減し、世界を4回復します。",
  "intervention.oath-of-renewal.v1": "自分の体力4を支払い、世界を7回復します。",
  "intervention.judgment-of-scars.v1": "解放は、相手の世界損傷責任が5以上のとき相手に8。抑制は相手に3ダメージです。",
  "field.frenzied-fracture.v1": "共有フィールドを置き換え、解放による世界損傷を1増やします。",
  "field.root-sanctuary.v1": "共有フィールドを置き換え、各手番の最初の世界損傷を2減らします。",
  "intervention.field-nullification.v1": "共有フィールドを消去し、世界を2傷つけます。",
  "intervention.careful-redraw.v1": "手札を1枚捨て、山札から1枚引きます。",
};

const ACTION_DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "attack.steadfast-strike.v1": { RELEASE: "相手へ6" },
  "attack.star-breaker.v1": { RELEASE: "相手へ16 / 世界へ7", RESTRAIN: "次の攻撃を3軽減" },
  "attack.rift-pebble.v1": { RELEASE: "相手へ4 / 世界へ2", RESTRAIN: "次の攻撃を1軽減" },
  "defense.guardian-veil.v1": { RESPONSE: "攻撃を7防ぐ" },
  "defense.ashen-bulwark.v1": { RESPONSE: "攻撃を12防ぐ / 世界へ4" },
  "intervention.verdant-bargain.v1": { RESPONSE: "攻撃を3軽減 / 世界へ4回復" },
  "intervention.oath-of-renewal.v1": { RELEASE: "体力を4支払い / 世界へ7回復" },
  "intervention.judgment-of-scars.v1": { RELEASE: "条件成立時、相手へ8", RESTRAIN: "相手へ3" },
  "field.frenzied-fracture.v1": { RELEASE: "共有フィールドを置換" },
  "field.root-sanctuary.v1": { RELEASE: "共有フィールドを置換" },
  "intervention.field-nullification.v1": { RELEASE: "フィールド消去 / 世界へ2" },
  "intervention.careful-redraw.v1": { RELEASE: "手札を交換" },
};

export function cardDescription(cardDefinitionId: string): string {
  return CARD_DESCRIPTIONS[cardDefinitionId] ?? "このカードの効果を確認してください。";
}

export function actionDescription(cardDefinitionId: string, mode: string): string {
  return ACTION_DESCRIPTIONS[cardDefinitionId]?.[mode] ?? modeLabel(mode);
}

export function requiresActionConfirmation(cardDefinitionId: string, mode: string): boolean {
  return mode === "RELEASE" && new Set([
    "attack.star-breaker.v1",
  ]).has(cardDefinitionId);
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
