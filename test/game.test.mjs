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
import { specialVisit } from '../js/game.js';
assert.equal(specialVisit(['S20', 'S5', 'S1']), 'tröja');
assert.equal(specialVisit(['S1', 'S20', 'S5']), 'tröja');
assert.equal(specialVisit(['S1', 'T20', 'S5']), null);   // trippel räknas inte
assert.equal(specialVisit(['D10', 'S5', 'S1']), null);   // dubbel räknas inte
assert.equal(specialVisit(['S3', 'S19', 'S7']), 'byxa');
assert.equal(specialVisit(['S3', 'S19', 'D7']), null);
assert.equal(specialVisit(['T19', 'S7', 'S3']), null);
assert.equal(specialVisit(['S20', 'S5']), null);
assert.equal(specialVisit(['S20', 'S5', 'Miss']), null);
assert.equal(specialVisit(['S20', 'S5', '25']), null);
// övning: en ensam spelare
let solo = newMatch({ mode: 101, outRule: 'double', legsToWin: 1, teams: [{ name: 'Anna', players: [A] }] });
solo = applyTurn(solo, 'ok', 60, 3, ['T20', 'S20', 'Miss']);
solo = applyTurn(solo, 'checkout', 41, 2, ['S1', 'D20']);
assert.equal(solo.status, 'finished');
const ps = playerStats('a', [solo]);
assert.equal(ps.matches, 0); assert.equal(ps.wins, 0); assert.equal(ps.practice, 1);
assert.equal(ps.hits.D20, 1); assert.equal(ps.hits.Miss, 1); assert.equal(ps.dartsTracked, 5);
assert.ok(ps.avg > 0);
console.log('tröja/byxa + övning OK');
import { replacePlayer } from '../js/game.js';
let rp = newMatch({ mode: 101, outRule: 'straight', legsToWin: 1, teams: [{ name: 'Anna', players: [A] }, { name: 'Bo', players: [B] }] });
rp = applyTurn(rp, 'ok', 60, 3, ['T20', 'S20', 'Miss']);
rp = applyTurn(rp, 'ok', 45, 3, ['S20', 'S20', 'S5']);
rp = applyTurn(rp, 'checkout', 41, 2, ['S1', 'D20']);
const fixed = replacePlayer(rp, 'a', C);
assert.equal(fixed.teams[0].name, 'Cia');
assert.equal(fixed.teams[0].players[0].id, 'c');
assert.ok(fixed.legs[0].turns.filter((t) => t.t === 0).every((t) => t.p === 'c'));
assert.ok(fixed.legs[0].turns.filter((t) => t.t === 1).every((t) => t.p === 'b'));
assert.equal(fixed.rev, rp.rev + 1);
assert.equal(fixed.winner, rp.winner);
assert.equal(playerStats('c', [fixed]).wins, 1);
assert.equal(playerStats('a', [fixed]).matches, 0);
assert.equal(replacePlayer(rp, 'a', B), null);     // B är redan med
assert.equal(replacePlayer(rp, 'zzz', C), null);   // finns inte
assert.equal(rp.teams[0].players[0].id, 'a');      // originalet orört
// lag: byt en av två
let tm = newMatch({ mode: 301, outRule: 'straight', legsToWin: 1, teams: [{ name: 'Anna & Bo', players: [A, B] }, { name: 'Cia & Dan', players: [C, D] }] });
tm = applyTurn(tm, 'ok', 26, 3, ['S20', 'S5', 'S1']);
const t2 = replacePlayer(tm, 'b', { id: 'e', name: 'Eva' });
assert.equal(t2.teams[0].name, 'Anna & Eva');
console.log('byt spelare OK');
