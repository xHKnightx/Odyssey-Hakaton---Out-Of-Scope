import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { createGamification } from '../lib/gamification.mjs';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE wisdom_events(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT NOT NULL, points INTEGER NOT NULL, note TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, actor_id INTEGER, reference_id INTEGER, impact_minutes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE runs(id INTEGER PRIMARY KEY, solution_id INTEGER, user_id INTEGER);`);
  const run = (solutionId, userId) => Number(db.prepare('INSERT INTO runs(solution_id,user_id) VALUES(?,?)').run(solutionId, userId).lastInsertRowid);
  return { db, run, gamification: createGamification(db) };
}

describe('rewardHelp', () => {
  it('pays 20 once per confirming colleague, solution and month, however many runs they rate', () => {
    const { run, gamification } = setup();
    const first = run(1, 2);
    assert.equal(gamification.rewardHelp(1, 2, first).points, 20);
    assert.equal(gamification.rewardHelp(1, 2, first).reason, 'already_counted');
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.deepEqual(gamification.rewardHelp(1, 2, run(1, 2)), { points: 0, reason: 'already_helped_this_month' });
    }
    assert.equal(gamification.rewardHelp(1, 3, run(1, 3)).points, 20);
  });

  it('caps the confirmations one colleague can give in a week', () => {
    const { run, gamification } = setup();
    const results = Array.from({ length: 7 }, (_, index) => gamification.rewardHelp(100 + index, 2, run(index + 1, 2)));
    assert.deepEqual(results.map(result => result.points), [20, 20, 20, 20, 20, 0, 0]);
    assert.equal(results[5].reason, 'weekly_cap');
    assert.equal(gamification.rewardHelp(100, 3, run(1, 3)).points, 20);
  });
});
