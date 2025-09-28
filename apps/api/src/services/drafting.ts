import { GoogleGenerativeAI } from '@google/generative-ai';

type DraftArgs = {
  user: { name?: string; summary?: string };
  candidate: { name?: string; title?: string; company?: string; summary?: string };
  tone?: 'warm' | 'concise' | 'direct' | 'curious';
  channel?: 'linkedin' | 'email';
};

type PersonalizedDraftArgs = {
  senderProfile: {
    name?: string;
    headline?: string;
    current_company?: string;
    university?: string;
    summary?: string;
    skills?: string[];
    experiences?: any[];
    schools?: any[];
  };
  receiverProfile: {
    name?: string;
    title?: string;
    company?: string;
    location?: string;
    summary?: string;
    skills?: string;
    schools?: string;
    experience?: string;
  };
  tone?: 'warm' | 'concise' | 'direct' | 'curious';
  channel?: 'linkedin' | 'email';
};

export async function generatePersonalizedMessage({ senderProfile, receiverProfile, tone = 'warm', channel = 'linkedin' }: PersonalizedDraftArgs): Promise<string> {
  console.log('🚀 generatePersonalizedMessage called for:', receiverProfile.name);

  try {
    // Initialize Gemini AI inside the function to ensure env vars are loaded
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    console.log('🔑 API Key check:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');

    if (!apiKey) {
      console.error('❌ GOOGLE_AI_API_KEY is missing');
      throw new Error('API key not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',        // Use the correct available model
      generationConfig: {
        temperature: 0.3,               // Increase for better output
        topP: 0.8,                     // Less restrictive
        topK: 40,                      // Allow more variety
        candidateCount: 1,             // Single response only
        maxOutputTokens: 5024,         // Ensure sufficient tokens
      }
    });

    // Parse and extract profile data more carefully
    const senderData = {
      name: senderProfile.name || 'User',
      headline: senderProfile.headline || '',
      company: senderProfile.current_company || '',
      university: senderProfile.university || '',
      summary: senderProfile.summary || '',
      skills: Array.isArray(senderProfile.skills) ? senderProfile.skills.join(', ') : (senderProfile.skills || ''),
      experiences: senderProfile.experiences || [],
      schools: senderProfile.schools || []
    };

    // Parse receiver profile data - handle JSON strings if needed
    let receiverSchools = '';
    let receiverSkills = '';
    let receiverExperience = '';

    // Try to parse schools if it's a JSON string
    try {
      if (receiverProfile.schools && receiverProfile.schools.startsWith('[')) {
        const schoolsArray = JSON.parse(receiverProfile.schools);
        receiverSchools = schoolsArray.map((s: any) => s.school || s.degree || s).join(', ');
      } else {
        receiverSchools = receiverProfile.schools || '';
      }
    } catch {
      receiverSchools = receiverProfile.schools || '';
    }

    // Try to parse skills if it's a JSON string
    try {
      if (receiverProfile.skills && receiverProfile.skills.startsWith('[')) {
        const skillsArray = JSON.parse(receiverProfile.skills);
        receiverSkills = skillsArray.map((s: any) => s.name || s).join(', ');
      } else {
        receiverSkills = receiverProfile.skills || '';
      }
    } catch {
      receiverSkills = receiverProfile.skills || '';
    }

    // Try to parse experience if it's a JSON string
    try {
      if (receiverProfile.experience && receiverProfile.experience.startsWith('[')) {
        const expArray = JSON.parse(receiverProfile.experience);
        receiverExperience = expArray.map((e: any) => `${e.title || ''} at ${e.company || ''}`).join(', ');
      } else {
        receiverExperience = receiverProfile.experience || '';
      }
    } catch {
      receiverExperience = receiverProfile.experience || '';
    }

    const receiverData = {
      name: receiverProfile.name || 'Professional',
      title: receiverProfile.title || '',
      company: receiverProfile.company || '',
      location: receiverProfile.location || '',
      summary: receiverProfile.summary || '',
      schools: receiverSchools,
      skills: receiverSkills,
      experience: receiverExperience
    };

    const prompt = `You are a professional LinkedIn networker (coffee-chat / recruiter / referral outreach specialist).
You write concise, polite, and PERSONALIZED LinkedIn messages that reference ONLY the data provided.
Never invent facts. If a field is missing, omit it.

Task:
Given (A) the requesting user's LinkedIn session profile and intent, and (B) a single candidate's profile,
compose a custom outreach message for LinkedIn. Also produce a <=300-character connection note variant.

Message goals:
- ALWAYS start with proper email greeting: "Hi {first_name}," followed by a newline, then "I'm {sender_name}, {sender_description}"
- Be specific and personal: reference 1–2 TRUE overlaps from the prioritized list below.
- Keep it respectful; 1 clear CTA (e.g., brief chat, quick question, referral guidance).
- Avoid spammy tone. No multiple CTAs. No hard sells.

STRICT evidence policy:
- Use ONLY provided fields. DO NOT infer employment, schools, clubs, or mutuals not present.
- If an item is missing, do not mention it.

Prioritized personalizers (most → least):
1) University (same school or same system/peer group)
2) Role (exact canonical match or adjacent hiring manager)
3) Clubs / Organizations (exact or clearly same category)
4) High School / Hometown (exact or same metro if both present)
5) Mutual connections (use count only if provided; do not name people unless included)

Deterministic selection rules:
- Choose at most TWO personalizers, in the priority order above.
- If multiple candidates ties exist, prefer University then Role.
- If no personalizers available, anchor on company/role intent ONLY.

Length & channel:
- Produce (1) a primary LinkedIn DM (60–100 words max - KEEP IT SHORT)
- and (2) a <=200-character connection note (strict hard limit).
- Do NOT include salutations longer than "Hi {first_name},".
- If the candidate's company matches intent.company, mention it once.

Style & formatting:
- MANDATORY: Always begin with "Hi {first_name},\n\nI'm {sender_name}, {brief_sender_description}" (ensure newline after greeting)
- MANDATORY: Always end with "Thank you,\n{sender_name}"
- Tone: warm, professional, specific, and brief.
- No bullet lists. 2–4 short paragraphs or 5–7 compact sentences.
- One hyperlink max (user portfolio/resume) if provided in user profile.
- No emojis, exclamation marks capped at 1.
- Proper spacing: ensure spaces after commas and proper line breaks.

Safety:
- No sensitive data. No promises of employment. No discriminatory language.
- Do not include chain-of-thought. Return ONLY the structured JSON requested.

Scoring flags (for explainability only, not shown to the recipient):
- For each selected personalizer, set score=1.0 if exact, 0.5 if category/system/metro match, else 0.0.
- total_personalization_score = average of used personalizers (0..1).

SENDER (who's reaching out):
- Name: ${senderData.name}
- Current: ${senderData.headline} ${senderData.company ? `at ${senderData.company}` : ''}
- Education: ${senderData.university}
- Background: ${senderData.summary}

RECEIVER (who they're messaging):
- Name: ${receiverData.name}
- Role: ${receiverData.title} ${receiverData.company ? `at ${receiverData.company}` : ''}
- Location: ${receiverData.location}
- Education: ${receiverData.schools}
- Background: ${receiverData.summary}
- Skills: ${receiverData.skills}

Return ONLY this JSON (NO markdown, NO code blocks):
{
  "message": "the primary LinkedIn DM (60-100 words)",
  "connection_note": "connection note (<=200 chars)",
  "total_personalization_score": 1.0
}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    console.log('🔥 Gemini raw output:', text);

    // Clean up the response - remove markdown code blocks
    let cleanedText = text.trim();
    cleanedText = cleanedText.replace(/```json\s*/g, '');
    cleanedText = cleanedText.replace(/```\s*/g, '');
    cleanedText = cleanedText.trim();

    // Try to parse JSON response
    try {
      const parsed = JSON.parse(cleanedText);
      if (parsed.message) {
        console.log('✅ Generated personalized message with Gemini');
        return parsed.message;
      }
    } catch (parseError) {
      console.warn('❌ Could not parse Gemini JSON response:', parseError.message);
      console.warn('Raw cleaned text:', cleanedText);

      // Try to extract just the message field if JSON parsing fails
      const messageMatch = cleanedText.match(/"message"\s*:\s*"([^"]+)"/);
      if (messageMatch) {
        console.log('🔧 Extracted message from partial JSON');
        return messageMatch[1];
      }
    }

    // If we get here, fallback to a simple message
    console.log('⚠️ Using simple fallback message');
    return `Hi ${receiverData.name}, hope you're well! Would love to connect and chat about your experience. Best, ${senderData.name}`;
  } catch (error) {
    console.error('❌ Gemini API error:', error);
    console.log('🔄 Falling back to template-based message');

    // Ensure we have valid data for fallback
    const fallbackMessage = draftMessage({
      user: {
        name: senderProfile?.name || 'User',
        summary: senderProfile?.summary || ''
      },
      candidate: {
        name: receiverProfile?.name || 'there',
        title: receiverProfile?.title || '',
        company: receiverProfile?.company || '',
        summary: receiverProfile?.summary || ''
      },
      tone,
      channel
    });

    console.log('✅ Generated fallback message:', fallbackMessage);
    return fallbackMessage;
  }
}

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
