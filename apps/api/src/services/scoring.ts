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

// LLM scoring removed - using only fallback scoring for speed and reliability

// Enhanced fallback scoring algorithm with HEAVILY WEIGHTED alumni connections
// Alumni scoring (keeps percentages reasonable while prioritizing alumni):
// - University of Michigan alumni: +0.8 base + 0.2 bonus = 1.0 total boost (100%+ scores)
// - Other alumni connections: +0.6 base + 0.2 bonus = 0.8 total boost (80%+ scores)
// - All other factors combined typically add up to ~0.5-0.7 max
// This ensures alumni are ALWAYS ranked at the top with reasonable percentages
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

    // Alumni affinity - HEAVILY WEIGHTED (top priority)
    const schoolsText = (c.schools || c.summary || '').toLowerCase();
    let isAlumni = false;
    let alumniScore = 0;

    // Enhanced school matching function with precise matching
    const matchesSchool = (candidateText: string, schoolName: string): boolean => {
      const school = schoolName.toLowerCase().trim();
      const text = candidateText.toLowerCase();

      // Exact match
      if (text.includes(school)) return true;

      // Handle common abbreviations and variations with precise matching
      const schoolVariations: { [key: string]: string[] } = {
        'university of michigan': ['u of m', 'umich', 'michigan ann arbor'],
        'stanford university': ['stanford'],
        'massachusetts institute of technology': ['mit'],
        'university of california berkeley': ['uc berkeley', 'cal berkeley'],
        'harvard university': ['harvard'],
        'princeton university': ['princeton'],
        'yale university': ['yale'],
        'columbia university': ['columbia'],
        'university of pennsylvania': ['upenn'],
        'cornell university': ['cornell'],
        'dartmouth college': ['dartmouth'],
        'brown university': ['brown']
      };

      // Check variations for exact school
      if (schoolVariations[school]) {
        return schoolVariations[school].some(variation => text.includes(variation));
      }

      // Check if this is a reverse lookup (user provided abbreviation)
      for (const [fullName, variations] of Object.entries(schoolVariations)) {
        if (variations.includes(school) && text.includes(fullName)) return true;
      }

      return false;
    };

    // Special precise matching for University of Michigan to avoid Michigan State false positives
    const isMichiganAlumni = () => {
      const text = schoolsText;

      // Positive indicators for University of Michigan
      const umichiIndicators = [
        'university of michigan',
        'u of m',
        'umich',
        'michigan ann arbor',
        'ann arbor'
      ];

      // Negative indicators (should exclude)
      const excludeIndicators = [
        'michigan state',
        'michigan tech',
        'western michigan',
        'eastern michigan',
        'central michigan'
      ];

      // First check if any exclusion indicators are present
      if (excludeIndicators.some(exclude => text.includes(exclude))) {
        return false;
      }

      // Then check for positive indicators
      return umichiIndicators.some(indicator => text.includes(indicator));
    };

    // Apply alumni scoring with reasonable percentages
    if (isMichiganAlumni()) {
      score += 0.8; // High boost for Michigan alumni that keeps percentage reasonable
      isAlumni = true;
      console.log(`🎓 MICHIGAN ALUMNI: ${c.name} - Score boost: +0.8`);
    } else if (user.schools && user.schools.length > 0) {
      // Check for any other school matches
      for (const userSchool of user.schools) {
        if (matchesSchool(schoolsText, userSchool) && !schoolsText.includes('michigan state')) {
          score += 0.6; // High boost for any alumni connection
          isAlumni = true;
          console.log(`🎓 ALUMNI MATCH: ${c.name} (${userSchool}) - Score boost: +0.6`);
          break;
        }
      }
    }

    // Additional alumni network bonus
    if (isAlumni) {
      score += 0.2; // Extra bonus for alumni connections
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

    // Clamp score to keep percentages reasonable (max 100%)
    score = Math.max(0, Math.min(1.0, score)); // Cap at 100% maximum

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

  // Skip LLM scoring and use fast fallback scoring directly
  console.log('✅ UPDATED: Using enhanced fallback scoring (LLM completely disabled)');
  return await fallbackScoring(user, intent, candidates);
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

    // Alumni affinity - HEAVILY WEIGHTED in sync version too (precise matching)
    const schoolsText = (c.schools || c.summary || '').toLowerCase();

    // Check for Michigan alumni with precise matching
    const isMichiganAlumni = () => {
      const text = schoolsText;
      const excludeIndicators = ['michigan state', 'michigan tech', 'western michigan', 'eastern michigan', 'central michigan'];
      const umichiIndicators = ['university of michigan', 'u of m', 'umich', 'michigan ann arbor', 'ann arbor'];

      if (excludeIndicators.some(exclude => text.includes(exclude))) return false;
      return umichiIndicators.some(indicator => text.includes(indicator));
    };

    if (isMichiganAlumni()) {
      score += 0.8; // High boost for Michigan alumni
    } else if (user.schools && user.schools.length > 0) {
      for (const s of user.schools) {
        if (textContains(schoolsText, s) && !schoolsText.includes('michigan state')) {
          score += 0.6; // High boost for any alumni
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

    // Clamp to keep percentages reasonable (max 100%)
    score = Math.max(0, Math.min(1.0, score));

    return {
      ...c,
      score,
    };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}
