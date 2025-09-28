export type UserProfile = {
  summary?: string;
  schools?: string[];
  companies?: string[];
  skills?: string[];
};

export type Candidate = {
  id: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedinUrl?: string;
  location?: string;
  summary?: string;
  source?: string;
  schools?: string;
  skills?: string;
  profilePhoto?: string;
  score?: number;
};

function textContains(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase().includes(b.toLowerCase());
}

function tokenOverlap(a: string[] = [], b: string[] = []): number {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const denom = Math.max(1, A.size + B.size - inter);
  return inter / denom; // Jaccard-like
}

// Enhanced LLM scoring with Google AI integration
async function scoreWithLLM(
  user: UserProfile,
  intent: string,
  candidates: Candidate[]
): Promise<Candidate[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey || candidates.length === 0) {
    console.warn('No Google AI API key found or no candidates, falling back to enhanced scoring');
    return await fallbackScoring(user, intent, candidates);
  }

  try {
    // Prepare the prompt for LLM scoring
    const userContext = `User Profile:
- Schools: ${user.schools?.join(', ') || 'Not specified'}
- Companies: ${user.companies?.join(', ') || 'Not specified'}
- Skills: ${user.skills?.join(', ') || 'Not specified'}
- Summary: ${user.summary || 'Not specified'}

Search Intent: ${intent}`;

    // Process candidates in batches of 5 for efficiency
    const batchSize = 5;
    const scoredCandidates: Candidate[] = [];

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      const candidatesText = batch.map((c, idx) =>
        `Candidate ${idx + 1}:
- Name: ${c.name}
- Title: ${c.title || 'Not specified'}
- Company: ${c.company || 'Not specified'}
- Location: ${c.location || 'Not specified'}
- Summary: ${c.summary?.substring(0, 300) || 'Not specified'}
- Schools: ${c.schools || 'Not specified'}
- Skills: ${c.skills || 'Not specified'}`
      ).join('\n\n');

      const prompt = `${userContext}

Please score the following candidates from 0.0 to 1.0 based on how well they match the user's profile and search intent. Consider factors like:
1. Alumni connections (same schools)
2. Role/title relevance
3. Company matching or similar companies
4. Skills overlap
5. Career progression alignment
6. Overall networking value

Candidates:
${candidatesText}

Respond with ONLY a JSON array of scores in this format:
[0.85, 0.72, 0.61, ...]`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (text) {
          try {
            // Extract JSON from the response
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const scores = JSON.parse(jsonMatch[0]);

              // Apply scores to batch
              batch.forEach((candidate, idx) => {
                if (scores[idx] !== undefined) {
                  candidate.score = Math.max(0, Math.min(1, scores[idx] || 0));
                } else {
                  candidate.score = 0.1; // Default low score if LLM didn't provide one
                }
              });
            } else {
              throw new Error('No JSON found in LLM response');
            }
          } catch (parseError) {
            console.warn('Failed to parse LLM response, using fallback scoring for batch');
            // Fall back to enhanced scoring for this batch
            const fallbackBatch = await fallbackScoring(user, intent, batch);
            batch.forEach((candidate, idx) => {
              candidate.score = fallbackBatch[idx]?.score || 0.1;
            });
          }
        } else {
          throw new Error('Empty response from LLM');
        }
      } else {
        throw new Error(`LLM API error: ${response.status}`);
      }

      scoredCandidates.push(...batch);

      // Add small delay between batches to avoid rate limiting
      if (i + batchSize < candidates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sort by score and return
    return scoredCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));

  } catch (error) {
    console.warn('LLM scoring failed, falling back to enhanced scoring:', error);
    return await fallbackScoring(user, intent, candidates);
  }
}

// Enhanced fallback scoring algorithm
async function fallbackScoring(
  user: UserProfile,
  intent: string,
  candidates: Candidate[]
): Promise<Candidate[]> {
  const roleHints = [
    'engineer', 'software', 'swe', 'data', 'ml', 'ai', 'product', 'pm',
    'designer', 'manager', 'director', 'lead', 'senior', 'principal',
    'architect', 'developer', 'analyst', 'scientist'
  ];

  const intentRole = roleHints.find((h) => textContains(intent, h));
  const intentCompanyMatch = /at\s+([A-Za-z0-9\-\.& ]+)/i.exec(intent || '')?.[1]?.trim();
  const intentLocation = /in\s+([A-Za-z\s,]+)/i.exec(intent || '')?.[1]?.trim();

  return candidates.map((c) => {
    let score = 0;

    // Alumni affinity (special priority for University of Michigan)
    const schoolsText = c.schools || c.summary || '';
    if (textContains(schoolsText, 'University of Michigan') || textContains(schoolsText, 'Michigan')) {
      score += 0.4; // High priority for Michigan alumni
    } else if (user.schools && user.schools.length > 0) {
      for (const s of user.schools) {
        if (textContains(schoolsText, s)) {
          score += 0.3;
          break;
        }
      }
    }

    // Role/title similarity (enhanced)
    if (intentRole && c.title) {
      if (textContains(c.title, intentRole)) {
        score += 0.3;
      }
      // Check for similar roles
      const roleSynonyms: { [key: string]: string[] } = {
        'engineer': ['developer', 'dev', 'programmer', 'architect'],
        'software': ['swe', 'dev', 'developer', 'programming'],
        'manager': ['lead', 'director', 'head'],
        'product': ['pm', 'product manager'],
        'data': ['analyst', 'scientist', 'ml', 'ai']
      };

      if (roleSynonyms[intentRole]) {
        for (const synonym of roleSynonyms[intentRole]) {
          if (textContains(c.title, synonym)) {
            score += 0.2;
            break;
          }
        }
      }
    }

    // Company match
    if (intentCompanyMatch && c.company && textContains(c.company, intentCompanyMatch)) {
      score += 0.25;
    }

    // Location match
    if (intentLocation && c.location && textContains(c.location, intentLocation)) {
      score += 0.15;
    }

    // Summary keyword overlap (enhanced)
    const intentKeywords = intent
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !['find', 'contacts', 'with', 'from'].includes(w))
      .slice(0, 8);

    const summaryText = (c.summary || '').toLowerCase();
    let keywordMatches = 0;
    for (const keyword of intentKeywords) {
      if (summaryText.includes(keyword)) {
        keywordMatches++;
      }
    }

    if (keywordMatches > 0) {
      const keywordScore = Math.min(0.2, (keywordMatches / intentKeywords.length) * 0.2);
      score += keywordScore;
    }

    // Skills overlap (enhanced)
    const candidateSkillsText = c.skills || c.summary || '';
    const userSkills = user.skills || [];
    let skillMatches = 0;

    for (const skill of userSkills) {
      if (textContains(candidateSkillsText, skill)) {
        skillMatches++;
      }
    }

    if (skillMatches > 0) {
      const skillScore = Math.min(0.2, (skillMatches / Math.max(1, userSkills.length)) * 0.2);
      score += skillScore;
    }

    // Company affinity (past companies)
    if (user.companies && user.companies.length > 0 && c.company) {
      for (const comp of user.companies) {
        if (textContains(c.company, comp)) {
          score += 0.15;
          break;
        }
      }
    }

    // Seniority bonus (for leadership roles)
    const seniorityKeywords = ['senior', 'lead', 'principal', 'staff', 'manager', 'director', 'vp', 'chief'];
    if (c.title && seniorityKeywords.some(keyword => textContains(c.title, keyword))) {
      score += 0.1;
    }

    // Profile completeness bonus
    let completenessBonus = 0;
    if (c.summary && c.summary.length > 50) completenessBonus += 0.05;
    if (c.email) completenessBonus += 0.05;
    if (c.linkedinUrl) completenessBonus += 0.05;
    if (c.schools) completenessBonus += 0.05;
    if (c.skills) completenessBonus += 0.05;

    if (completenessBonus > 0) {
      score += completenessBonus;
    }

    // Clamp score between 0 and 1
    score = Math.max(0, Math.min(1, score));

    return {
      ...c,
      score: Number(score.toFixed(3)),
    };
  }).sort((a, b) => (b.score || 0) - (a.score || 0)); // Sort by score descending
}

// Main scoring function with LLM integration capability
export async function scoreCandidates(args: {
  user: UserProfile;
  intent: string;
  candidates: Candidate[]
}): Promise<Candidate[]> {
  const { user, intent, candidates } = args;

  // Try LLM scoring first, fallback to enhanced scoring if it fails
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (apiKey && candidates.length > 0) {
    console.log('Using LLM-powered scoring with Google AI');
    return await scoreWithLLM(user, intent, candidates);
  } else {
    console.log('Using enhanced fallback scoring');
    return await fallbackScoring(user, intent, candidates);
  }
}

// Legacy synchronous version for backwards compatibility
export function scoreCandidatesSync(args: {
  user: UserProfile;
  intent: string;
  candidates: Candidate[]
}): Candidate[] {
  const { user, intent, candidates } = args;
  const roleHints = ['engineer', 'software', 'swe', 'data', 'ml', 'ai', 'product', 'pm', 'designer'];
  const intentRole = roleHints.find((h) => textContains(intent, h));
  const intentCompanyMatch = /at\s+([A-Za-z0-9\-\.& ]+)/i.exec(intent || '')?.[1]?.trim();

  return candidates.map((c) => {
    let score = 0;

    // Role/title similarity
    if (intentRole && textContains(c.title, intentRole)) {
      score += 0.3;
    }

    // Company match
    if (intentCompanyMatch && textContains(c.company, intentCompanyMatch)) {
      score += 0.25;
    }

    // Summary overlap with intent keywords
    const sumHit = intent
      .split(/\W+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .some((w) => textContains(c.summary, w));
    if (sumHit) {
      score += 0.15;
    }

    // Skills overlap
    const skillsOverlap = tokenOverlap(user.skills || [], (c.summary || '').toLowerCase().split(/\W+/));
    if (skillsOverlap > 0) {
      score += Math.min(0.15, skillsOverlap * 0.15);
    }

    // Schools and companies affinity
    if (user.schools && user.schools.length > 0) {
      for (const s of user.schools) {
        if (textContains(c.summary, s) || textContains(c.company, s)) {
          score += 0.1;
          break;
        }
      }
    }

    if (user.companies && user.companies.length > 0 && c.company) {
      for (const comp of user.companies) {
        if (textContains(c.company, comp)) {
          score += 0.1;
          break;
        }
      }
    }

    // Clamp
    score = Math.max(0, Math.min(1, score));

    return {
      ...c,
      score,
    };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}
