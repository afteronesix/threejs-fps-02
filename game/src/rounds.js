// Rounds and the match: the state machine that turns a firefight into a
// tactical game. Buy (15 s) -> live (100 s) -> end (banner) -> next round.
// A round ends by elimination, by the bomb detonating or being defused, or by
// the clock; a planted bomb keeps the round alive past an elimination of its
// attackers, who must then be stopped by a defuse. First team to 4 rounds
// takes the match, at most 7 rounds. The machine only decides; main.js
// applies the consequences (payouts, resets, sounds, HUD).
export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const END_TIME = 4.5;
export const ROUNDS_TO_WIN = 4;
export const MAX_ROUNDS = 7;

export const WIN_REASONS = {
  ELIMINATION: 'Enemy team eliminated',
  BOMB_DETONATED: 'Bomb detonated',
  DEFUSED: 'Bomb defused',
  TIME_EXPIRED: 'Time expired — defenders hold',
};

export function createRounds() {
  const state = {
    phase: 'buy', // buy | live | end | matchEnd
    round: 1,
    scoreA: 0,
    scoreB: 0,
    timeLeft: BUY_TIME,
    winner: null,
    reason: null,
    matchWinner: null,
  };

  function startMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.scoreA = 0;
    state.scoreB = 0;
    state.timeLeft = BUY_TIME;
    state.winner = null;
    state.reason = null;
    state.matchWinner = null;
  }

  function startRound() {
    state.phase = 'buy';
    state.timeLeft = BUY_TIME;
    state.winner = null;
    state.reason = null;
  }

  function endRound(winner, reason, hooks) {
    state.phase = 'end';
    state.timeLeft = END_TIME;
    state.winner = winner;
    state.reason = reason;
    if (winner === 'A') state.scoreA += 1;
    else state.scoreB += 1;
    hooks.onRoundEnd?.(winner, reason);
  }

  // Decide the round from the live state. Called every fixed step while live.
  function step(dt, ctx, hooks) {
    if (state.phase === 'buy') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.phase = 'live';
        state.timeLeft = ROUND_TIME;
        hooks.onRoundLive?.();
      }
      return;
    }
    if (state.phase === 'end') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.scoreA >= ROUNDS_TO_WIN || state.scoreB >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
          state.phase = 'matchEnd';
          state.matchWinner = state.scoreA > state.scoreB ? 'A' : state.scoreB > state.scoreA ? 'B' : null;
          hooks.onMatchEnd?.(state.matchWinner);
        } else {
          state.round += 1;
          startRound();
          hooks.onNextRound?.();
        }
      }
      return;
    }
    if (state.phase !== 'live') return;
    const bomb = ctx.bomb;
    // The bomb decides before the clock and before elimination.
    if (bomb.state === 'exploded') { endRound('A', 'BOMB_DETONATED', hooks); return; }
    if (bomb.state === 'defused') { endRound('B', 'DEFUSED', hooks); return; }
    if (ctx.aliveB === 0) { endRound('A', 'ELIMINATION', hooks); return; }
    // Attackers eliminated with the bomb planted: the round lives on, the
    // defenders still have to defuse.
    if (ctx.aliveA === 0 && bomb.state !== 'planted') { endRound('B', 'ELIMINATION', hooks); return; }
    if (bomb.state !== 'planted') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) { endRound('B', 'TIME_EXPIRED', hooks); return; }
    }
  }

  return {
    state,
    startMatch,
    startRound,
    step,
    // The timer the HUD shows: buy time, round time, or the bomb's fuse.
    displayTime(bomb) {
      if (state.phase === 'buy') return { label: 'BUY', value: state.timeLeft };
      if (bomb.state === 'planted') return { label: 'BOMB', value: bomb.timerLeft };
      if (state.phase === 'live') return { label: 'ROUND', value: state.timeLeft };
      return { label: '', value: 0 };
    },
  };
}
