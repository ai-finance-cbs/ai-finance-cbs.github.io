import {emptySurvey,AI_TOOLS,SETUP_TOOLS} from '../../assets/materials/survey-core.js';
// Invented answers only. No production response belongs in a fixture.
export function surveyFixture() {
  const v=emptySurvey('Synthetic Student');
  Object.assign(v.answers,{preferred_name:'Sample',program:'MBA 2027',job:'I worked at a fictional bank. I checked reports. I prepared meeting notes.',
    sector:'Consulting',career_examples:'Example advisory firm',ai_use:'I checked a synthetic formula.',wish:'Check report totals.',setup_assistant:'Codex',
    setup_version:'codex 0.0.0-test',setup_haiku:'Numbers in the rain\nSample UNI counts the leaves\nLedgers greet the dawn',
    ai_frequency:Object.fromEntries(AI_TOOLS.map(([id])=>[id,'Never'])),experience:Object.fromEntries(SETUP_TOOLS.map(([id])=>[id,'A little']))});
  v.q9=['augment','unsure'];v.q10=25;return v;
}
