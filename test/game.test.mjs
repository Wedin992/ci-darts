import assert from 'node:assert/strict';
import { evalDarts, newMatch, applyTurn, undo, legInfo, legsWon, evaluate, checkoutHint, dartsOptions } from '../js/game.js';
import { playerStats } from '../js/stats.js';

const A = { id: 'a', name: 'Anna' }, B = { id: 'b', name: 'Bo' };
const C = { id: 'c', name: 'Cia' }, D = { id: 'd', name: 'Dan' };

// evaluate
assert.equal(evaluate(40, 40, 'double'), 'checkout');
assert.equal(evaluate(169, 169, 'double'), 'invalid');
assert.equal(evaluate(159, 159, 'double'), 'bust');
assert.equal(evaluate(40, 39, 'double'), 'bust');
assert.equal(evaluate(40, 39, 'straight'), 'ok');
assert.equal(evaluate(40, 41, 'double'), 'bust');
assert.equal(evaluate(100, 179, 'double'), 'invalid');
assert.equal(evaluate(100, 180, 'double'), 'bust');
assert.equal(evaluate(501, 180, 'double'), 'ok');

// checkout hints
assert.deepEqual(checkoutHint(170), ['T20', 'T20', 'Bull']);
assert.deepEqual(checkoutHint(40), ['D20']);
assert.equal(checkoutHint(169), null);
for (let r = 2; r <= 170; r++) {
  const h = checkoutHint(r);
  if (![159, 162, 163, 165, 166, 168, 169].includes(r)) assert.ok(h, 'hint ' + r);
}
assert.deepEqual(dartsOptions(40, 'double'), [1, 2, 3]);
assert.deepEqual(dartsOptions(100, 'double'), [2, 3]);

// singles 101, first to 2 legs
let m = newMatch({
  mode: 101, outRule: 'double', legsToWin: 2,
  teams: [{ name: 'Anna', players: [A] }, { name: 'Bo', players: [B] }],
});
m = applyTurn(m, 'ok', 60);            // A 41
m = applyTurn(m, 'ok', 100);           // B 1 -> bust under double? 101-100=1
assert.equal(evaluate(101, 100, 'double'), 'bust');
m = undo(m);
m = applyTurn(m, 'bust', 100);         // B bust, stays 101
assert.deepEqual(legInfo(m).rem, [41, 101]);
m = applyTurn(m, 'checkout', 41, 2);   // A wins leg 1
assert.deepEqual(legsWon(m), [1, 0]);
assert.equal(m.legs.length, 2);
assert.equal(m.legs[1].starter, 1);    // B starts leg 2
assert.equal(legInfo(m).next.team, 1);
m = applyTurn(m, 'ok', 50);            // B 51
m = applyTurn(m, 'ok', 60);            // A 41
m = applyTurn(m, 'ok', 11);            // B 40
m = applyTurn(m, 'checkout', 41, 1);   // A wins
assert.equal(m.status, 'finished');
assert.equal(m.winner, 0);
const s = playerStats('a', [m]);
assert.equal(s.wins, 1);
assert.equal(s.highCheckout, 41);
assert.equal(s.legsWon, 2);
// undo reopens a finished match and previous leg
m = undo(m);
assert.equal(m.status, 'active');
m = undo(m); m = undo(m); m = undo(m); m = undo(m);
assert.equal(m.legs.length, 1, 'reopened leg 1 (checkout undone)');
assert.equal(legsWon(m)[0], 0);

// teams: order A1, B1, A2, B2
let t = newMatch({
  mode: 301, outRule: 'double', legsToWin: 1,
  teams: [{ name: 'A&C', players: [A, C] }, { name: 'B&D', players: [B, D] }],
});
const order = [];
for (let i = 0; i < 4; i++) { order.push(legInfo(t).next.player.id); t = applyTurn(t, 'ok', 26); }
assert.deepEqual(order, ['a', 'b', 'c', 'd']);
assert.equal(legInfo(t).next.player.id, 'a');

// three players, own sides
let g = newMatch({
  mode: 101, outRule: 'straight', legsToWin: 1,
  teams: [A, B, C].map((p) => ({ name: p.name, players: [p] })),
});
for (let i = 0; i < 3; i++) g = applyTurn(g, 'ok', 20);
assert.equal(legInfo(g).next.team, 0);
// pil för pil
const T=(n)=>({v:3*n,dbl:false,l:'T'+n}), Dd=(n)=>({v:2*n,dbl:true,l:'D'+n}), Sg=(n)=>({v:n,dbl:false,l:'S'+n});
assert.equal(evalDarts(501,[T(20),T(20)],'double').state,'open');
assert.equal(evalDarts(501,[T(20),T(20),T(20)],'double').state,'complete');
assert.equal(evalDarts(40,[Dd(20)],'double').state,'checkout');
assert.equal(evalDarts(40,[Sg(20),Sg(20)],'double').state,'bust');   // 0 utan dubbel
assert.equal(evalDarts(40,[Sg(20),Sg(19)],'double').state,'bust');   // kvar 1
assert.equal(evalDarts(40,[Sg(20),Sg(20)],'straight').state,'checkout');
assert.equal(evalDarts(32,[Sg(16),Dd(8)],'double').n,2);
assert.equal(evalDarts(20,[T(20)],'double').state,'bust');
console.log('alla tester OK');
import { checkoutRoutes } from '../js/game.js';
assert.deepEqual(checkoutRoutes(170, 3, 'double'), [['T20', 'T20', 'Bull']]);
assert.deepEqual(checkoutRoutes(170, 2, 'double'), []);
assert.deepEqual(checkoutRoutes(40, 3, 'double')[0], ['D20']);
assert.ok(checkoutRoutes(40, 3, 'double').length >= 2);
assert.deepEqual(checkoutRoutes(32, 1, 'double'), [['D16']]);
assert.deepEqual(checkoutRoutes(35, 1, 'double'), []);
assert.ok(checkoutRoutes(60, 1, 'straight').some((r) => r[0] === 'T20'));
for (let r = 2; r <= 170; r++) {
  for (const route of checkoutRoutes(r, 3, 'double')) {
    const v = route.map((l) => (l === 'Bull' ? 50 : l === '25' ? 25 : l[0] === 'T' ? 3 * +l.slice(1) : l[0] === 'D' ? 2 * +l.slice(1) : +l.slice(1)));
    assert.equal(v.reduce((a, b) => a + b, 0), r, route.join());
    assert.ok(/^(D|Bull)/.test(route[route.length - 1]));
  }
}
console.log('avslutsförslag OK');
