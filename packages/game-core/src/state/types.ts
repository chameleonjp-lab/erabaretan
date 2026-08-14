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

export type ShieldScope = "CURRENT_PENDING_ATTACK" | "NEXT_APPLICABLE_ATTACK" | "UNTIL_TURN_SEQUENCE";

export interface ShieldState {
  readonly amount: number;
  readonly scope: ShieldScope;
  readonly pendingAttackId: string | null;
  readonly expiresAfterTurnSequence: number | null;
}

export type StatModifierName = "INCOMING_DAMAGE_REDUCTION" | "ACTION_DAMAGE";

export interface StatModifierState {
  readonly stat: StatModifierName;
  readonly delta: number;
  readonly expiresAfterTurnSequence: number;
}

export type ScoreModifierKind =
  | "WORLD_COLLAPSE_PENALTY"
  | "SURVIVAL_BONUS"
  | "WORLD_DAMAGE_RESPONSIBILITY"
  | "EFFECTIVE_WORLD_RESTORE";

export interface ScoreModifierState {
  readonly playerId: PlayerId;
  readonly modifierKind: ScoreModifierKind;
  readonly amount: number;
}

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
  readonly fieldDefinitionIds?: readonly CardDefinitionId[];
  readonly maxActiveFields?: number;
  readonly maxResponsesPerAttack?: number;
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
  readonly shields: readonly ShieldState[];
  readonly statModifiers: readonly StatModifierState[];
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
  /** The last card instance that received the frenzied-fracture +1 modifier. */
  readonly lastFrenziedCardInstanceId?: CardInstanceId | null;
  /** The turnSequence whose first world-damage request used root-sanctuary. */
  readonly rootSanctuaryUsedTurnSequence?: number | null;
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

export interface PendingAttackState {
  readonly pendingAttackId: string;
  readonly attackingPlayerId: PlayerId;
  readonly defendingPlayerId: PlayerId;
  readonly baseDamage: number;
  readonly responseCount: number;
  readonly incomingDamageReduction: number;
  readonly currentShield: number;
  readonly effectiveDamage: number | null;
  readonly reflectionApplied: boolean;
}

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
  readonly pendingAttack: PendingAttackState | null;
  readonly effectQueue: readonly unknown[];
  readonly scoreModifiers: readonly ScoreModifierState[];
  readonly terminalFlags: TerminalFlags;
  readonly judgment: JudgmentState | null;
  readonly randomConsumptionCount: number;
  readonly commandHistory: Readonly<Record<CommandId, CommandHistoryEntry>>;
}
