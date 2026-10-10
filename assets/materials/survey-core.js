// Question wording follows M1 survey design, draft v20261009. No teaching-team notes belong here.
export const SURVEY_OPENING = 'This survey is really for you. Tell me a little about yourself and your background, so that I can make this course about the people in the room. There are no right answers, and nothing here is graded except completion. Only I see the individual responses. In class I may show anonymous summaries (for example, "40% of you think..."). -Simon';
export const QUESTIONS = {
  q1:'Q1. Full name and UNI.', q2:'Q2. What name should I call you in class?', q3:'Q3. Program and year.',
  q4:'Q4. Describe your most recent internship or job in 3 to 5 sentences.', q5:'Q5. Where do you want to work after CBS?',
  q6:'Q6. How often do you use each tool?', q7:'Q7. What is the most useful thing you have done with AI so far?',
  q8:'Q8. What is one task in your future job that you wish AI could do for you?',
  q9:'Q9. Where are you on AI in finance? Check all that apply.',
  q10:'Q10. By 2030, what share of the tasks a first-year analyst does today will AI do instead?',
  q11:'Q11. What worries you most about going into a finance role in a world where AI capabilities are expanding rapidly?',
  q12:'Q12. Have you used any of these?', q13:'Q13. Anything else I should know?',
  s1:'S1. Which assistant did you set up?', s2:'S2. Paste the output of claude --version (or codex --version).',
  s3:'S3. Paste the haiku your assistant wrote for: "Write a haiku about finance that includes the word YOUR-UNI."',
  s4:'S4. Any setup problems?',
};
export const PROGRAMS = ['MBA 2027','MBA 2028','EMBA','MS','PhD','Other'];
export const SECTORS = ['Investment banking','Sales and trading','Asset management / hedge funds','Private equity / VC / private credit','Corporate finance','Consulting','Fintech / tech','Entrepreneurship','Other'];
export const FREQUENCIES = ['Never','Tried it','Monthly','Weekly','Daily'];
export const AI_TOOLS = [['chatgpt','ChatGPT'],['claude','Claude'],['gemini','Gemini'],['copilot','Microsoft Copilot'],['perplexity','Perplexity'],['other','Other (name it)']];
export const EXPERIENCE = ['Never','A little','Comfortable'];
export const SETUP_TOOLS = [['vscode','VS Code'],['github','GitHub'],['terminal','A terminal / command line'],['python_r','Python or R'],['excel','Excel formulas']];
export const ASSISTANTS = ['Claude Code','Codex','I could not finish setup.'];
// These identifiers stay stable for the later Week 6 comparison.
export const VIEWS = [
  ['change_work','AI will change most of the work in finance within five years.'],
  ['overhyped','AI is overhyped in finance right now.'],
  ['augment','AI will mostly help people do more, not replace them.'],
  ['entry_jobs','AI will reduce the number of entry-level jobs in finance.'],
  ['builders_gain','Most of the gains will go to the companies that build AI, not the firms that use it.'],
  ['efficient_markets','AI will make financial markets more efficient.'],
  ['stability_risks','AI will create new risks to financial stability.'],
  ['unsure','I am not sure yet.'],
];
export const TEXT_LIMITS = {full_name:120,preferred_name:120,job:3000,career_examples:500,other_tool:120,
  ai_use:1500,wish:600,worries:1000,other_info:2000,setup_version:500,setup_haiku:2000,setup_problems:2000};
const REQUIRED_TEXT = {full_name:'Q1',preferred_name:'Q2',job:'Q4',career_examples:'Q5',ai_use:'Q7',wish:'Q8',setup_version:'S2',setup_haiku:'S3'};
export function emptySurvey(name = '') {
  return {answers:{...Object.fromEntries(Object.keys(TEXT_LIMITS).map(k=>[k,''])),full_name:name,program:'',sector:'',setup_assistant:'',
    ai_frequency:Object.fromEntries(AI_TOOLS.map(([k])=>[k,''])),experience:Object.fromEntries(SETUP_TOOLS.map(([k])=>[k,'']))},q9:[],q10:null};
}
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const surveyClosed = (due, now=Date.now()) => !due || !Number.isFinite(Date.parse(due)) || Number(now)>=Date.parse(due);
export function validateSurvey(value, submit=false) {
  if (!object(value) || !object(value.answers)) throw Error('Invalid survey answers.');
  const a=value.answers, keys=Object.keys(emptySurvey().answers);
  if (Object.keys(a).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(a,k))) throw Error('Invalid survey fields.');
  for (const [key,cap] of Object.entries(TEXT_LIMITS)) {
    if (typeof a[key]!=='string' || [...a[key]].length>cap) throw Error(`${key.replaceAll('_',' ')} must be text of at most ${cap} characters.`);
    if (submit && REQUIRED_TEXT[key] && !a[key].trim()) throw Error(`Complete ${REQUIRED_TEXT[key]} before submitting.`);
  }
  for (const [key,choices,q] of [['program',PROGRAMS,'Q3'],['sector',SECTORS,'Q5'],['setup_assistant',ASSISTANTS,'S1']]) {
    if (!choices.includes(a[key]) && a[key]!=='') throw Error(`Invalid choice for ${q}.`);
    if (submit && !a[key]) throw Error(`Complete ${q} before submitting.`);
  }
  for (const [key,rows,choices,q] of [['ai_frequency',AI_TOOLS,FREQUENCIES,'Q6'],['experience',SETUP_TOOLS,EXPERIENCE,'Q12']]) {
    const grid=a[key];
    if (!object(grid) || Object.keys(grid).length!==rows.length || Object.keys(grid).some(k=>!rows.some(([id])=>id===k))) throw Error(`Invalid grid for ${q}.`);
    for (const [id] of rows) if (!choices.includes(grid[id]) && !(grid[id]==='' && !submit)) throw Error(`Choose an answer for every row in ${q}.`);
  }
  if (submit && a.ai_frequency.other!=='Never' && !a.other_tool.trim()) throw Error('Name the other tool in Q6.');
  if (!Array.isArray(value.q9) || value.q9.length>8 || new Set(value.q9).size!==value.q9.length || value.q9.some(id=>!VIEWS.some(([k])=>k===id))) throw Error('Invalid Q9 selections.');
  if (submit && !value.q9.length) throw Error('Choose at least one statement in Q9.');
  if (value.q10!==null && (typeof value.q10!=='number' || !Number.isFinite(value.q10) || value.q10<0 || value.q10>100)) throw Error('Q10 must be a number from 0 to 100.');
  if (submit && value.q10===null) throw Error('Complete Q10 with a number from 0 to 100.');
  return value;
}
export function surveySummary(students) {
  const submitted=students.map(s=>s.submission).filter(s=>s?.status==='submitted');
  const predictions=submitted.map(s=>s.q10).sort((a,b)=>a-b), n=predictions.length;
  return {roster:students.length,submitted:n,drafts:students.filter(s=>s.submission?.status==='draft').length,
    q9:Object.fromEntries(VIEWS.map(([id])=>[id,submitted.filter(s=>s.q9.includes(id)).length])),
    q10:n?{min:predictions[0],median:n%2?predictions[(n-1)/2]:(predictions[n/2-1]+predictions[n/2])/2,max:predictions[n-1]}:null,
    sectors:Object.fromEntries(SECTORS.map(k=>[k,submitted.filter(s=>s.answers.sector===k).length])),
    setup:Object.fromEntries(ASSISTANTS.map(k=>[k,submitted.filter(s=>s.answers.setup_assistant===k).length]))};
}
// Quote every cell and neutralize spreadsheet formulas, including after leading whitespace.
const csvCell = value => {
  let text=String(value??''); if (/^\s*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
export function surveyCSV(students) {
  const headers=['UNI','Roster name','Status','Submitted at','Updated at','Q1 Full name','Q2 Preferred name','Q3 Program','Q4 Job','Q5 Sector','Q5 Example firms or roles',
    ...AI_TOOLS.map(([,name])=>`Q6 ${name}`),'Q6 Other tool name','Q7 AI use','Q8 Future task',...VIEWS.map(([,label])=>`Q9 ${label}`),'Q10 Percent','Q11 Worries',
    ...SETUP_TOOLS.map(([,name])=>`Q12 ${name}`),'Q13 Other information','S1 Assistant','S2 Version','S3 Haiku','S4 Problems'];
  const rows=students.map(student=>{
    const s=student.submission,a=s?.answers;
    return [student.uni,student.name,s?.status||'not_started',s?.submitted_at,s?.updated_at,a?.full_name,a?.preferred_name,a?.program,a?.job,a?.sector,a?.career_examples,
      ...AI_TOOLS.map(([id])=>a?.ai_frequency[id]),a?.other_tool,a?.ai_use,a?.wish,...VIEWS.map(([id])=>s?Number(s.q9.includes(id)):''),s?.q10,a?.worries,
      ...SETUP_TOOLS.map(([id])=>a?.experience[id]),a?.other_info,a?.setup_assistant,a?.setup_version,a?.setup_haiku,a?.setup_problems];
  });
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
