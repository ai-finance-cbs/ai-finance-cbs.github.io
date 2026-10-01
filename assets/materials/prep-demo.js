import { noteValues, speakerValues } from './prep-core.js';

// Public, synthetic examples for the loopback-only demo. Never put real prep here.
function samples() {
  const time = '2027-01-01T15:00:00Z';
  return {
    instructor_notes: [{ week: 1, body: '# Demo preparation\n\n**Opening question**\n\n- Compare two synthetic investment memos.\n- Ask which claims need a source.\n\n*Local demo only.*', updated_at: time }],
    speakers: [
      { name:'Alex Example', affiliation:'Example Asset Management', topic:'Research workflows', week:3, status:'Idea' },
      { name:'Jordan Sample', affiliation:'Sample Financial Lab', topic:'Model evaluation', week:4, status:'Contacted' },
      { name:'Taylor Demo', affiliation:'Demo Ventures', topic:'The future of finance', week:6, status:'Confirmed' },
    ].map((row, i) => ({ id:`00000000-0000-4000-8000-00000000000${i+1}`, contact:'', notes:'Synthetic local example.', created_at:time, updated_at:time, ...row })),
  };
}
export function extendPrep({ readAll, saveAll, access }) {
  const read = () => {
    const a = access();
    if (a?.role !== 'instructor' || a.view_as) throw new Error('Instructor access required.');
    const d = readAll(), seed = samples();
    d.instructor_notes ??= seed.instructor_notes; d.speakers ??= seed.speakers;
    return d;
  };
  return {
    async instructorNote(week) { return read().instructor_notes.find(n => n.week === week) || { week, body:'', updated_at:null }; },
    async saveInstructorNote(week, body) {
      const d = read(), row = { ...noteValues(week, body), updated_at:new Date().toISOString() };
      d.instructor_notes = d.instructor_notes.filter(n => n.week !== week); d.instructor_notes.push(row); saveAll(d); return row;
    },
    async speakers() { return read().speakers; },
    async saveSpeaker(row) {
      const d = read(), values = speakerValues(row), time = new Date().toISOString();
      const old = row.id ? d.speakers.find(s => s.id === row.id) : null;
      if (row.id && !old) throw new Error('Speaker not found.');
      const saved = { ...values, id:old?.id || crypto.randomUUID(), created_at:old?.created_at || time, updated_at:time };
      d.speakers = d.speakers.filter(s => s.id !== saved.id); d.speakers.push(saved); saveAll(d); return saved;
    },
    async deleteSpeaker(id) {
      const d = read(); if (!d.speakers.some(s => s.id === id)) throw new Error('Speaker not found.');
      d.speakers = d.speakers.filter(s => s.id !== id); saveAll(d);
    },
  };
}
