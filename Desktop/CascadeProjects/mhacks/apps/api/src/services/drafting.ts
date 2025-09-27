type DraftArgs = {
  user: { name?: string; summary?: string };
  candidate: { name?: string; title?: string; company?: string; summary?: string };
  tone?: 'warm' | 'concise' | 'direct' | 'curious';
  channel?: 'linkedin' | 'email';
};

export function draftMessage({ user, candidate, tone = 'warm', channel = 'linkedin' }: DraftArgs): string {
  const uName = user.name || 'there';
  const cName = candidate.name || 'there';
  const title = candidate.title ? `${candidate.title}` : 'your role';
  const company = candidate.company ? ` at ${candidate.company}` : '';

  const opener = tone === 'concise'
    ? `Hi ${cName} —`
    : tone === 'direct'
      ? `Hi ${cName}, getting in touch about ${title}${company}.`
      : `Hi ${cName}, hope you're well!`;

  const reason = candidate.summary
    ? `I noticed your background in ${title}${company} and your summary stood out.`
    : `I came across your profile${company} and thought there could be a strong fit.`;

  const ask = channel === 'email'
    ? `Would you be open to a quick intro chat next week?`
    : `If you're open, I'd love to send a brief note here to introduce myself.`;

  const sign = tone === 'concise' ? `— ${uName}` : `Thanks,
${uName}`;

  const body = [opener, reason, ask, sign].join('\n\n');
  return body;
}
