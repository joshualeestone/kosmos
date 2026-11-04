// kosmos#7933: the promote check's seed, through the app's own engine (the build under test, not this checkout).
//   node promote-check-seed-7933.js <app dir> seed   one project, two tasks, the second held
//   node promote-check-seed-7933.js <app dir> read   prints "read projects <n> <name>:<tasks> held <held>,..."
// Reads AGENT_WORKFORCE_DATA / _PROJECTS from the environment, as the board does.
const [app, mode] = process.argv.slice(2);
if (!app || (mode !== 'seed' && mode !== 'read')) { console.error('usage: <app dir> seed|read'); process.exit(2); }
const projects = require(app + '/engine/projects');
const tasks = require(app + '/engine/tasks');
if (mode === 'seed') {
  const p = projects.create({ name: 'Masterclass prep' });
  tasks.create(p.id, { sentence: 'Book the room', made: { via: 'screen' } }, []);
  const held = tasks.create(p.id, { sentence: 'Print the notes', made: { via: 'screen' } }, []);
  tasks.setOnHold(p.id, held.number, true, { viaScreen: true });
  console.log('seeded', p.id);
} else {
  const all = projects.readAll();
  console.log('read projects', all.length, all.map((a) => a.name + ':' + (a.tasks || []).length + ' held ' + (a.tasks || []).filter((k) => k.onHold).length).join(','));
}
