// Economy: Counter-Strike-style money. Everyone starts a match with $800; a
// kill pays $300, a round win $3,250, a round loss $1,400 plus $500 per
// consecutive loss (capped at $3,400), planting the bomb $300. Money buys
// weapons, grenades and armour in the buy menu (economy owns the prices;
// weapons.js owns what a purchase gives). Bots keep money too and buy by a
// simple policy in bots.js, so the economy changes what both teams can field.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

export const PRICES = {
  rifle: WEAPONS.rifle.price,
  smg: WEAPONS.smg.price,
  frag: GRENADES.frag.price,
  smoke: GRENADES.smoke.price,
  armor: ARMOR_PRICE,
};

const START_MONEY = 800;
const KILL_BONUS = 300;
const WIN_BONUS = 3250;
const LOSS_BASE = 1400;
const LOSS_STEP = 500;
const LOSS_MAX = 3400;
const PLANT_BONUS = 300;

export function createEconomy() {
  const money = { player: START_MONEY };
  const botMoney = new Map();
  let lossStreak = { A: 0, B: 0 };

  function get(id) {
    if (id === 'player') return money.player;
    if (!botMoney.has(id)) botMoney.set(id, START_MONEY);
    return botMoney.get(id);
  }
  function set(id, value) {
    if (id === 'player') money.player = value;
    else botMoney.set(id, value);
  }

  return {
    get,
    reset() {
      money.player = START_MONEY;
      botMoney.clear();
      lossStreak = { A: 0, B: 0 };
    },
    // Bots read their money through the same table as the player.
    botMoney(bot) { return get(bot.id); },
    // Charge a bot's purchase; returns false when it cannot afford it.
    buyFor(bot, item) {
      const price = PRICES[item];
      if (price === undefined || get(bot.id) < price) return false;
      set(bot.id, get(bot.id) - price);
      return true;
    },
    // Charge the player's purchase; the arsenal applies the item.
    buyPlayer(item) {
      const price = PRICES[item];
      if (price === undefined || money.player < price) return false;
      money.player -= price;
      return true;
    },
    // Direct grant, used by payouts and by the capture setup only.
    grant(id, amount) { set(id, get(id) + amount); },
    onKill(killerId) {
      if (killerId) set(killerId, get(killerId) + KILL_BONUS);
    },
    onPlant(planterId) {
      if (planterId) set(planterId, get(planterId) + PLANT_BONUS);
    },
    onRoundEnd(winnerTeam) {
      for (const team of ['A', 'B']) {
        if (team === winnerTeam) {
          lossStreak[team] = 0;
          // Every member of the winning team is paid.
          for (const id of [...botMoney.keys()]) if (id.startsWith(team)) set(id, get(id) + WIN_BONUS);
          if (team === 'A') money.player += WIN_BONUS;
        } else {
          lossStreak[team] += 1;
          const bonus = Math.min(LOSS_MAX, LOSS_BASE + (lossStreak[team] - 1) * LOSS_STEP);
          for (const id of [...botMoney.keys()]) if (id.startsWith(team)) set(id, get(id) + bonus);
          if (team === 'A') money.player += bonus;
        }
      }
      return { win: WIN_BONUS, loss: Math.min(LOSS_MAX, LOSS_BASE + (lossStreak[winnerTeam === 'A' ? 'B' : 'A'] - 1) * LOSS_STEP) };
    },
  };
}
