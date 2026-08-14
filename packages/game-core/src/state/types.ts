export type PlayerId = string;
export type CardInstanceId = string;
export type CardDefinitionId = string;
export type CommandId = string;

export type GamePhase =
  | "SETUP"
  | "TURN_START"
  | "ACTION_SELECTION"
  | "RESPONSE_SELECTION"
  | "RESOLUTION"
  | "TURN_END"
  | "JUDGMENT"
  | "FINISHED";

export type PlayMode = "RELEASE" | "RESTRAIN";
export type ResponseMode = "RESPONSE";
export type CardZone = "DRAW_PILE" | "HAND" | "DISCARD_PILE" | "REVEALED" | "RESOLUTION";

export interface RulesetSnapshot {
  readonly rulesetId: string;
  readonly worldLawId: string;
  readonly playerCount: 2;
  readonly startingHp: number;
  readonly maxHp: number;
  readonly startingWorldDurability: number;
  readonly worldMaxDurability: number;
  readonly worldThresholds: readonly number[];
  readonly maxRounds: number;
  readonly startingHand: number;
  readonly handLimit: number;
  readonly maxEffectsPerResolution: number;
  readonly survivalRoundScore: number;
  readonly survivalBonus: number;
  readonly worldDamageScoreMultiplier: number;
  readonly worldRestoreScoreMultiplier: number;
  readonly worldCollapsePenalty: number;
}

export interface CardInstanceState {
  readonly cardInstanceId: CardInstanceId;
  readonly cardDefinitionId: CardDefinitionId;
  readonly ownerPlayerId: PlayerId;
  readonly zone: CardZone;
  readonly drawOrder: number;
}

export interface CardZones {
  readonly drawPile: readonly CardInstanceId[];
  readonly hands: Readonly<Record<PlayerId, readonly CardInstanceId[]>>;
  readonly discardPile: readonly CardInstanceId[];
  readonly revealedCards: readonly CardInstanceId[];
  readonly inResolution: readonly CardInstanceId[];
}

export interface PlayerStatusEffects {
  readonly nextDefensePenalty: number;
  readonly fragileWorld: boolean;
}

export interface PlayerState {
  readonly playerId: PlayerId;
  readonly hitPoints: number;
  readonly maxHitPoints: number;
  readonly hand: readonly CardInstanceId[];
  readonly worldDamageResponsibility: number;
  readonly effectiveWorldRestore: number;
  readonly survivedRoundCount: number;
  readonly statusEffects: PlayerStatusEffects;
}

export interface WorldState {
  readonly durability: number;
  readonly maxDurability: number;
  readonly triggeredThresholds: readonly number[];
  readonly worldLawId: string;
  readonly collapseResponsiblePlayerId: PlayerId | null;
}

export interface ActiveFieldState {
  readonly fieldDefinitionId: CardDefinitionId;
  readonly ownerPlayerId: PlayerId;
  readonly expiresAfterTurnSequence: number;
}

export interface CardResolutionAction {
  readonly kind: "CARD_RESOLUTION";
  readonly pendingActionId: string;
  readonly commandId: CommandId;
  readonly playerId: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly cardDefinitionId: CardDefinitionId;
  readonly playMode: PlayMode;
  readonly targetPlayerId: PlayerId | null;
  readonly responseCardInstanceId: CardInstanceId | null;
  readonly responseMode: ResponseMode | "ACCEPT_DAMAGE" | null;
}

export interface ResponseSelectionAction {
  readonly kind: "RESPONSE_SELECTION";
  readonly pendingAttackId: string;
  readonly commandId: CommandId;
  readonly attackingPlayerId: PlayerId;
  readonly defendingPlayerId: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly cardDefinitionId: CardDefinitionId;
  readonly playMode: PlayMode;
  readonly targetPlayerId: PlayerId;
}

export type PendingAction = CardResolutionAction | ResponseSelectionAction;

export interface TerminalFlags {
  readonly worldCollapsed: boolean;
  readonly defeatedPlayerIds: readonly PlayerId[];
  readonly maxRoundsReached: boolean;
  readonly endKind: "NORMAL" | "SURRENDER" | "DISCONNECT_FORFEIT" | "SERVER_ABORT" | "INVALID_MATCH" | null;
  readonly battleWinnerId: PlayerId | null;
  readonly divineSelectionWinnerId: PlayerId | null;
}

export interface JudgmentState {
  readonly playerScores: Readonly<Record<PlayerId, number>>;
  readonly winnerId: PlayerId | null;
}

export interface CoreEventBase {
  readonly type: string;
  readonly revision: number;
}

export interface CommandAcceptedEvent extends CoreEventBase {
  readonly type: "COMMAND_ACCEPTED";
  readonly commandId: CommandId;
}

export interface CommandRejectedEvent extends CoreEventBase {
  readonly type: "COMMAND_REJECTED";
  readonly commandId: CommandId | null;
  readonly reasonCode: string;
}

export interface CardPlayedEvent extends CoreEventBase {
  readonly type: "CARD_PLAYED";
  readonly commandId: CommandId;
  readonly playerId: PlayerId;
  readonly cardInstanceId: CardInstanceId;
  readonly playMode: PlayMode;
}

export interface CardDiscardedEvent extends CoreEventBase {
  readonly type: "CARD_DISCARDED";
  readonly commandId: CommandId;
  readonly playerId: PlayerId;
  readonly cardInstanceId: CardInstanceId | null;
  readonly reason: "ACTION" | "OVERFLOW" | "TIMEOUT";
}

export interface ResponseAcceptedEvent extends CoreEventBase {
  readonly type: "RESPONSE_ACCEPTED";
  readonly commandId: CommandId;
  readonly playerId: PlayerId;
  readonly responseKind: ResponseMode | "ACCEPT_DAMAGE";
}

export interface MatchFinishedEvent extends CoreEventBase {
  readonly type: "MATCH_FINISHED";
  readonly endKind: TerminalFlags["endKind"];
}

export type CoreEvent =
  | CommandAcceptedEvent
  | CommandRejectedEvent
  | CardPlayedEvent
  | CardDiscardedEvent
  | ResponseAcceptedEvent
  | MatchFinishedEvent;

export interface CommandHistoryEntry {
  readonly command: unknown;
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly events: readonly CoreEvent[];
}

export interface GameState {
  readonly stateHashVersion: "state-hash.alpha-12.v1";
  readonly ruleset: RulesetSnapshot;
  readonly catalogHash: string;
  readonly engineVersion: string;
  readonly rngAlgorithmVersion: string;
  readonly shuffleAlgorithmVersion: string;
  readonly matchId: string;
  readonly seed: string;
  readonly initialPlayerOrder: readonly PlayerId[];
  readonly revision: number;
  readonly phase: GamePhase;
  readonly roundNumber: number;
  readonly turnSequence: number;
  readonly activePlayerId: PlayerId | null;
  readonly respondingPlayerId: PlayerId | null;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly cardZones: CardZones;
  readonly cardInstances: Readonly<Record<CardInstanceId, CardInstanceState>>;
  readonly world: WorldState;
  readonly activeField: ActiveFieldState | null;
  readonly pendingAction: PendingAction | null;
  readonly effectQueue: readonly unknown[];
  readonly terminalFlags: TerminalFlags;
  readonly judgment: JudgmentState | null;
  readonly randomConsumptionCount: number;
  readonly commandHistory: Readonly<Record<CommandId, CommandHistoryEntry>>;
}
