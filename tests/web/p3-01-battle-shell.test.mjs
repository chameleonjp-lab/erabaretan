import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAlpha12Setup, previewAlpha12Command } from "../../packages/content/src/index.ts";
import { projectPublicState } from "../../packages/game-core/src/index.ts";
import { applyLocalCommand, createLocalMatch } from "../../web/src/local-match.ts";
import {
  battlePrompt,
  actionDescription,
  cardDescription,
  effectHint,
  handoffTargetForStateChange,
  modeLabel,
  nextWorldBoundary,
  phaseLabel,
  roleLabel,
  requiresActionConfirmation,
  screenForPhase,
} from "../../web/src/battle-shell.ts";

const setup = createAlpha12Setup({
  matchId: "p3-01-shell-contract",
  seed: "123456789abcdef00fedcba987654321",
  playerIds: ["P1", "P2"],
});
const projected = projectPublicState(setup.state, { kind: "PLAYER", playerId: setup.state.activePlayerId });
assert.equal(projected.ok, true);
if (!projected.ok) throw new Error("the deterministic shell fixture must project");

test("P3-01 maps game phases to the intended screen flow", () => {
  assert.equal(screenForPhase("ACTION_SELECTION"), "BATTLE");
  assert.equal(screenForPhase("RESPONSE_SELECTION"), "BATTLE");
  assert.equal(screenForPhase("FINISHED"), "RESULT");
  assert.equal(phaseLabel("ACTION_SELECTION"), "行動選択");
  assert.equal(phaseLabel("RESPONSE_SELECTION"), "応答選択");
  assert.equal(phaseLabel("FINISHED"), "試合終了");
});

test("P3-01 keeps the world and card vocabulary understandable", () => {
  assert.equal(roleLabel("ATTACK"), "攻撃");
  assert.equal(roleLabel("FIELD"), "フィールド");
  assert.equal(modeLabel("RELEASE"), "解放");
  assert.equal(modeLabel("RESTRAIN"), "抑制");
  assert.equal(nextWorldBoundary(projected.state), 75);
  assert.equal(effectHint(projected.state), "次の境界 75");
});

test("P3-02 explains card actions in plain language and confirms risky releases", () => {
  assert.match(cardDescription("attack.star-breaker.v1"), /相手16/);
  assert.match(cardDescription("field.frenzied-fracture.v1"), /1増やします/);
  assert.match(cardDescription("field.root-sanctuary.v1"), /2減らします/);
  assert.match(cardDescription("intervention.judgment-of-scars.v1"), /5以上/);
  assert.equal(actionDescription("attack.star-breaker.v1", "RELEASE"), "相手へ16 / 世界へ7");
  assert.equal(actionDescription("attack.star-breaker.v1", "RESTRAIN"), "次の攻撃を3軽減");
  assert.equal(requiresActionConfirmation("attack.star-breaker.v1", "RELEASE"), true);
  assert.equal(requiresActionConfirmation("attack.steadfast-strike.v1", "RELEASE"), false);
  assert.equal(requiresActionConfirmation("attack.rift-pebble.v1", "RELEASE"), false);
  assert.equal(requiresActionConfirmation("intervention.field-nullification.v1", "RELEASE"), false);
  assert.equal(requiresActionConfirmation("intervention.oath-of-renewal.v1", "RELEASE"), false);
});

test("P3-02 uses the production preview without changing the local match", () => {
  const state = createLocalMatch(5);
  const playerId = state.activePlayerId;
  assert.ok(playerId);
  const cardInstanceId = state.players[playerId].hand.find(
    (id) => state.cardInstances[id].cardDefinitionId === "attack.star-breaker.v1",
  );
  assert.ok(cardInstanceId);
  const revision = state.revision;
  const preview = previewAlpha12Command(state, { kind: "PLAYER", playerId }, {
    commandType: "PLAY_CARD",
    playerId,
    payload: { cardInstanceId, playMode: "RELEASE", targetPlayerId: playerId === "P1" ? "P2" : "P1" },
  });
  assert.equal(preview.status, "READY");
  if (preview.status !== "READY") return;
  assert.equal(preview.certainty, "PARTIAL");
  assert.equal(preview.pendingAttackBaseDamage, 16);
  assert.equal(state.revision, revision);
  assert.equal(state.phase, "ACTION_SELECTION");

  const nullificationCard = state.players[playerId].hand.find(
    (id) => state.cardInstances[id].cardDefinitionId === "intervention.field-nullification.v1",
  );
  assert.ok(nullificationCard);
  const rejected = previewAlpha12Command(state, { kind: "PLAYER", playerId }, {
    commandType: "PLAY_CARD",
    playerId,
    payload: { cardInstanceId: nullificationCard, playMode: "RELEASE" },
  });
  assert.equal(rejected.status, "REJECTED");
});

test("P3-01 explains whose action is needed without exposing the other hand", () => {
  const viewerId = setup.state.activePlayerId;
  assert.equal(battlePrompt(projected.state, viewerId), "カードを1枚選び、解放するか抑制するか決めてください。");
  assert.equal(projected.state.players.find((player) => player.playerId !== viewerId)?.hand.cards, null);
});

test("P3-01 inserts a private handoff before every new local viewer sees a hand", () => {
  let state = createLocalMatch(3);
  const initialViewer = state.activePlayerId;
  assert.ok(initialViewer);
  assert.equal(handoffTargetForStateChange(null, state), initialViewer);

  const discardedCard = state.players[initialViewer].hand[0];
  const discarded = applyLocalCommand(state, {
    commandId: "p3-01-handoff-discard",
    playerId: initialViewer,
    expectedRevision: state.revision,
    commandType: "DISCARD_FOR_ACTION",
    payload: { cardInstanceId: discardedCard },
  });
  assert.equal(discarded.accepted, true);
  if (!discarded.accepted) return;
  state = discarded.state;
  assert.equal(state.phase, "ACTION_SELECTION");
  assert.notEqual(state.activePlayerId, initialViewer);
  assert.equal(handoffTargetForStateChange({ ...state, activePlayerId: initialViewer }, state), state.activePlayerId);

  const mainSource = readFileSync(new URL("../../web/src/main.ts", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../../web/styles.css", import.meta.url), "utf8");
  assert.match(mainSource, /data-handoff-ready/);
  assert.match(mainSource, /data-discard-action/);
  assert.match(mainSource, /data-confirm-action/);
  assert.match(mainSource, /data-cancel-action/);
  assert.match(mainSource, /data-response-card/);
  assert.match(mainSource, /data-rematch/);
  assert.match(mainSource, /card-description/);
  assert.match(styleSource, /\.card-action \{[^}]*min-height: 44px/s);
  assert.match(styleSource, /\.mini-select select \{[^}]*min-height: 44px/s);
  assert.match(styleSource, /body \{ min-width: 320px; overflow-x: hidden; \}/);
  assert.match(styleSource, /\.hand-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
});

test("P3-01 local adapter carries a real attack through response and result flow", () => {
  let state = createLocalMatch(2);
  const attacker = state.activePlayerId;
  assert.ok(attacker);
  const attackCard = state.players[attacker].hand.find(
    (cardInstanceId) => state.cardInstances[cardInstanceId].cardDefinitionId === "attack.steadfast-strike.v1",
  );
  assert.ok(attackCard, "the deterministic shell match must have a standard attack");
  const played = applyLocalCommand(state, {
    commandId: "p3-01-flow-attack",
    playerId: attacker,
    expectedRevision: state.revision,
    commandType: "PLAY_CARD",
    payload: { cardInstanceId: attackCard, playMode: "RELEASE", targetPlayerId: attacker === "P1" ? "P2" : "P1" },
  });
  assert.equal(played.accepted, true);
  if (!played.accepted) return;
  state = played.state;
  assert.equal(state.phase, "RESPONSE_SELECTION");
  assert.equal(state.respondingPlayerId, attacker === "P1" ? "P2" : "P1");
  assert.equal(handoffTargetForStateChange(createLocalMatch(2), state), state.respondingPlayerId);

  const responseState = state;
  const response = applyLocalCommand(state, {
    commandId: "p3-01-flow-accept",
    playerId: state.respondingPlayerId,
    expectedRevision: state.revision,
    commandType: "ACCEPT_DAMAGE",
    payload: {},
  });
  assert.equal(response.accepted, true);
  if (!response.accepted) return;
  state = response.state;
  assert.equal(state.phase, "ACTION_SELECTION");
  assert.equal(handoffTargetForStateChange(responseState, state), null);
  const surrendered = applyLocalCommand(state, {
    commandId: "p3-01-flow-surrender",
    playerId: state.activePlayerId,
    expectedRevision: state.revision,
    commandType: "SURRENDER",
    payload: {},
  });
  assert.equal(surrendered.accepted, true);
  if (!surrendered.accepted) return;
  assert.equal(surrendered.state.phase, "FINISHED");
});

test("P3-01 local adapter finishes after the configured maximum number of rounds", () => {
  let state = createLocalMatch(4);
  for (let turn = 0; turn < 20; turn += 1) {
    assert.equal(state.phase, "ACTION_SELECTION");
    const playerId = state.activePlayerId;
    assert.ok(playerId);
    const cardInstanceId = state.players[playerId].hand[0];
    const result = applyLocalCommand(state, {
      commandId: `p3-01-max-round-${turn}`,
      playerId,
      expectedRevision: state.revision,
      commandType: "DISCARD_FOR_ACTION",
      payload: { cardInstanceId },
    });
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    state = result.state;
  }
  assert.equal(state.phase, "FINISHED");
  assert.equal(state.roundNumber, state.ruleset.maxRounds + 1);
  assert.equal(state.terminalFlags.maxRoundsReached, true);
  assert.equal(state.terminalFlags.endKind, "NORMAL");
});
