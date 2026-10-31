/**
 * Helpers for sending a single case from a results page to the AI Assistant.
 *
 * The case travels in React Router location state (`navigate('/assistant',
 * { state: { summariseCase } })`), so nothing is left behind in storage and a
 * refresh of the assistant page doesn't re-trigger the hand-off.
 */

/** Only what the assistant needs: drops raw table rows and structured duplicates. */
export function trimCase(c) {
  return {
    case_type: c.case_type,
    case_no: c.case_no,
    case_year: c.case_year,
    petitioner: c.petitioner,
    respondent: c.respondent,
    case_information: c.case_information,
    sections: c.sections,
    judgment_pdf: c.judgment_pdf,
  };
}

export function caseLabel(c) {
  const ident = [c.case_type, c.case_no].filter(Boolean).join(' ');
  return c.case_year ? `${ident}/${c.case_year}` : ident;
}

export function caseParties(c) {
  return [c.petitioner, c.respondent].filter(Boolean).join(' v/s ');
}

/** The first message sent on the person's behalf when they press "Summarise". */
export function summaryPrompt(c) {
  const parties = caseParties(c);
  return (
    `Summarise case ${caseLabel(c)}${parties ? ` (${parties})` : ''}: who the parties are, what it is about, ` +
    'its current status, the key orders and dates, and the outcome if there is one.'
  );
}
