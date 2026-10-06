import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from '../assets/materials/demo.js';
import { OTHER_NOTES, preparationDocument, serializePreparationLayout, movePreparationCard } from '../assets/materials/prep-outline-core.js';
const outline = { topics:[{name:'Evidence'}], exercises:['Exercise'] };
let b;
beforeEach(async () => {
  const data = new Map();
  globalThis.sessionStorage = { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k) };
  globalThis.window = { location:new URL('http://127.0.0.1:4173/materials/preparation/week-1/?fakeauth=instructor') };
  b=createDemo(); await b.pickRole('instructor');
});

test('demo persists the complete layout unchanged across backend instances and rollover',async () => {
  const original=(await b.instructorNote(1)).body, doc=preparationDocument(original,outline);
  doc.sections=movePreparationCard(doc.sections,'Exercise',true);
  doc.notes.Evidence='Saved content';
  const body=serializePreparationLayout(doc);
  await b.saveInstructorNote(1,body);
  assert.equal((await createDemo().instructorNote(1)).body,body);
  assert.equal((await b.instructorNote(2)).body,'');
  await b.openTerm('Spring 2028'); assert.equal((await b.instructorNote(1)).body,body);
  assert.ok(preparationDocument(body,{}).notes[OTHER_NOTES].includes(original));
});
for (const role of ['grader','student','auditor','unlisted','preview']) test(`demo denies ${role} layout reads and writes`,async () => {
  const body=serializePreparationLayout(preparationDocument('',outline));
  if (role==='preview') await b.setPreview('ab1234'); else await b.pickRole(role);
  await assert.rejects(b.instructorNote(1),/Instructor/);
  await assert.rejects(b.saveInstructorNote(1,body),/Instructor/);
});
test('an oversized layout does not replace the saved demo note',async () => {
  const before=(await b.instructorNote(1)).body, doc=preparationDocument(before,outline);
  doc.notes.Evidence='x'.repeat(50000);
  await assert.rejects(b.saveInstructorNote(1,serializePreparationLayout(doc)),/50,000/);
  assert.equal((await b.instructorNote(1)).body,before);
});
