import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { createApolloProvider } from './providers/apollo';
import { createAgentMailProvider } from './providers/agentmail';
import { draftMessage } from './services/drafting';
import { scoreCandidates } from './services/scoring';

dotenv.config();

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(formbody);

const apollo = createApolloProvider({ apiKey: process.env.APOLLO_API_KEY });
const agentMail = createAgentMailProvider({ apiKey: process.env.AGENTMAIL_API_KEY });

app.get('/health', async () => ({ ok: true }));

// LinkedIn Authentication using StaffSpy init_account (browser-based)
// Session storage for authenticated users
const userSessions = new Map<string, { sessionFile: string; authenticated: boolean; email?: string }>();

// Function to initialize LinkedIn account using StaffSpy (browser-based auth)
async function initLinkedInAccount(sessionFile: string): Promise<{ success: boolean; error?: string; email?: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), '../../', 'staff_functions.py');
    app.log.info(`Initializing LinkedIn account with session file: ${sessionFile}`);

    // Simple Python script that calls init_account()
    const authScript = `
import sys
import json
sys.path.append('${path.join(process.cwd(), '../../')}')

try:
    from staff_functions import init_account

    # Call init_account with default session file
    account = init_account(session_file='${sessionFile}')

    print(json.dumps({
        "success": True,
        "message": "LinkedIn authentication completed successfully",
        "session_file": "${sessionFile}"
    }))

except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const python = spawn('python3', ['-c', authScript], {
      cwd: path.join(process.cwd(), '../../'),
      stdio: ['inherit', 'pipe', 'pipe'] // Allow user interaction
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Log non-JSON output for debugging
      if (!output.trim().startsWith('{')) {
        app.log.info(`LinkedIn auth stdout: ${output.trim()}`);
      }
    });

    python.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      app.log.warn(`LinkedIn auth stderr: ${error.trim()}`);

      // Check for specific StaffSpy errors
      if (error.includes('500 status code returned from linkeind')) {
        app.log.error('LinkedIn returned 500 error - likely rate limiting or authentication issue');
      }
      if (error.includes('StaffSpy - ERROR')) {
        app.log.error('StaffSpy encountered an error during authentication');
      }
    });

    python.on('close', (code) => {
      app.log.info(`LinkedIn authentication process finished with code: ${code}`);

      if (code === 0) {
        try {
          // Parse the JSON output
          const lines = stdout.trim().split('\n');
          const jsonLine = lines.find(line => line.trim().startsWith('{'));

          if (jsonLine) {
            const result = JSON.parse(jsonLine);
            app.log.info(`LinkedIn authentication result: ${result.success ? 'success' : 'failed'}`);
            resolve(result);
          } else {
            app.log.warn('No JSON found in LinkedIn auth output');
            resolve({ success: false, error: 'Authentication process completed but no result found' });
          }
        } catch (e) {
          app.log.warn(`Failed to parse LinkedIn auth output: ${e instanceof Error ? e.message : String(e)}`);
          resolve({ success: false, error: 'Failed to parse authentication result' });
        }
      } else {
        app.log.error(`LinkedIn authentication failed with code ${code}: ${stderr}`);

        // Provide specific error messages based on stderr content
        let errorMessage = 'Authentication process failed';
        if (stderr.includes('500 status code returned from linkeind')) {
          errorMessage = 'LinkedIn is currently blocking requests (500 error). This may be due to rate limiting or LinkedIn detecting automated access. Please try again later or use a different approach.';
        } else if (stderr.includes('StaffSpy - ERROR')) {
          errorMessage = 'StaffSpy encountered an error during authentication. Please check your LinkedIn login and try again.';
        }

        resolve({ success: false, error: errorMessage });
      }
    });

    python.on('error', (error) => {
      app.log.error(`LinkedIn authentication error: ${error.message}`);
      resolve({ success: false, error: 'Failed to start authentication process' });
    });
  });
}

app.post('/linkedin/auth', async (req, reply) => {
  try {
    // Generate unique session ID and file path for this user
    const sessionId = Math.random().toString(36).substring(7) + Date.now().toString(36);
    const sessionFile = `linkedin_session_${sessionId}.pkl`;

    app.log.info('Starting LinkedIn browser authentication...');

    // Call init_account without credentials to trigger browser auth
    const result = await initLinkedInAccount(sessionFile);

    if (result.success) {
      // Store session info
      userSessions.set(sessionId, {
        sessionFile,
        authenticated: true,
        email: result.email
      });

      // Store user in database if we have email
      if (result.email) {
        await prisma.user.upsert({
          where: { email: result.email },
          update: { name: 'LinkedIn User' },
          create: { email: result.email, name: 'LinkedIn User' }
        });
      }

      app.log.info('LinkedIn authentication successful');

      reply.send({
        success: true,
        sessionId,
        message: 'LinkedIn authentication successful',
        user: { email: result.email || 'linkedin@user.com', name: 'LinkedIn User' }
      });
    } else {
      app.log.warn(`LinkedIn authentication failed: ${result.error}`);
      reply.code(401).send({
        success: false,
        error: result.error || 'LinkedIn authentication failed'
      });
    }
  } catch (error) {
    app.log.error('LinkedIn authentication error:', error);
    reply.code(500).send({
      success: false,
      error: 'Authentication service unavailable'
    });
  }
1});

app.get('/linkedin/callback', async (req, reply) => {
  const { code, state } = req.query as any;
  
  if (!code) {
    return reply.code(400).send({ error: 'Authorization code not provided' });
  }
  
  try {
    // In a real implementation, you would:
    // 1. Exchange the code for an access token
    // 2. Use the access token to get user profile
    // 3. Store the user session
    
    // For demo purposes, we'll simulate successful authentication
    const mockUser = {
      id: 'demo-user-' + Date.now(),
      email: 'demo@linkedin.com',
      name: 'Demo User'
    };
    
    // Store user in database
    await prisma.user.upsert({
      where: { email: mockUser.email },
      update: { name: mockUser.name },
      create: { email: mockUser.email, name: mockUser.name }
    });
    
    // Redirect back to frontend with success
    reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?auth=success&user=${encodeURIComponent(mockUser.email)}`);
  } catch (error) {
    app.log.error('LinkedIn callback error:', error);
    reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?auth=error`);
  }
});

// Mock authentication for development
app.post('/linkedin/auth/mock', async (req, reply) => {
  try {
    const mockUser = {
      email: 'demo@linkedin.com',
      name: 'Demo User'
    };
    
    await prisma.user.upsert({
      where: { email: mockUser.email },
      update: { name: mockUser.name },
      create: { email: mockUser.email, name: mockUser.name }
    });

    reply.send({ 
      status: 'authenticated', 
      message: 'LinkedIn authentication successful (mock)',
      user: mockUser
    });
  } catch (error) {
    app.log.error('Mock auth error:', error);
    reply.code(500).send({ error: 'Authentication service unavailable' });
  }
});

app.post('/linkedin/scrape', async (req, reply) => {
  const { email, password, prompt, maxResults = 20 } = (req.body as any) || {};
  
  if (!email || !password || !prompt) {
    return reply.code(400).send({ 
      error: 'Email, password, and search prompt are required' 
    });
  }

  try {
    // Parse the user prompt to extract search parameters
    const searchParams = parseSearchPrompt(prompt);
    
    if (!searchParams.company || !searchParams.role) {
      return reply.code(400).send({ 
        error: 'Could not parse company and role from prompt. Please specify like "Find SWE contacts at Amazon in Seattle"' 
      });
    }

    app.log.info(`Scraping LinkedIn: ${searchParams.role} at ${searchParams.company} in ${searchParams.location}`);

    // Run the Python script
    const result = await runPythonScript('staff_functions.py', [
      email,
      password,
      searchParams.company,
      searchParams.role,
      searchParams.location,
      maxResults.toString()
    ]);

    if (result.success) {
      // Convert CSV data to candidates format for frontend
      const csvData = await readCSVFile(result.csv_file);
      const candidates = csvData.map((row: any, index: number) => ({
        id: `linkedin-${index}`,
        name: row.name || 'Unknown',
        title: row.title || row.headline || searchParams.role,
        company: row.company || searchParams.company,
        email: row.email || null,
        linkedinUrl: row.profile_link || row.linkedin_url || null,
        location: row.location || searchParams.location,
        summary: row.summary || row.about || `${row.title || searchParams.role} at ${row.company || searchParams.company}`,
        source: 'linkedin-staffspy'
      }));

      // Score the candidates
      const scored = scoreCandidates({
        user: { schools: [], companies: [], skills: [], summary: '' },
        intent: prompt,
        candidates
      });

      reply.send({ 
        results: scored,
        metadata: {
          total_profiles: result.total_profiles,
          csv_file: result.csv_file,
          search_params: searchParams
        }
      });
    } else {
      reply.code(500).send({ 
        error: 'LinkedIn scraping failed', 
        details: result.error 
      });
    }
  } catch (error) {
    app.log.error('LinkedIn scrape error:', error);
    reply.code(500).send({ error: 'Scraping service unavailable' });
  }
});

// Helper functions
async function runSimpleLinkedInScrape(sessionFile: string, searchParams: { company: string; role: string; location: string }): Promise<any> {
  return new Promise((resolve) => {
    app.log.info(`Running LinkedIn scrape: ${searchParams.role} at ${searchParams.company}`);

    // Simple Python script that uses our working staff_functions
    const scrapeScript = `
import sys
import json
sys.path.append('${path.join(process.cwd(), '../../')}')

try:
    from staff_functions import init_account, scrape_company_staff

    # Initialize account with existing session
    account = init_account(session_file='${sessionFile}')

    # Scrape company staff
    csv_file = scrape_company_staff(
        account=account,
        company_name='${searchParams.company}',
        search_term='${searchParams.role}',
        location='${searchParams.location}',
        max_results=50
    )

    print(json.dumps({
        "success": True,
        "csv_file": csv_file,
        "message": "Scraping completed successfully"
    }))

except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const python = spawn('python3', ['-c', scrapeScript], {
      cwd: path.join(process.cwd(), '../../')
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      if (!output.trim().startsWith('{')) {
        app.log.info(`Scrape stdout: ${output.trim()}`);
      }
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          const lines = stdout.trim().split('\n');
          const jsonLine = lines.find(line => line.trim().startsWith('{'));
          if (jsonLine) {
            const result = JSON.parse(jsonLine);
            resolve(result);
          } else {
            resolve({ success: false, error: 'No JSON output from scrape' });
          }
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse scrape output' });
        }
      } else {
        resolve({ success: false, error: stderr || `Scrape failed with code ${code}` });
      }
    });

    python.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

async function runPythonScriptWithSession(scriptName: string, sessionFile: string, args: string[]): Promise<any> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), '../../', scriptName);
    app.log.info(`Executing: python3 ${scriptPath} with session ${sessionFile} and args: ${args.slice(0, 2).join(' ')} [company and role hidden]`);

    // Create a Python script that uses the session file for authentication
    const sessionScript = `
import sys
import json
import os
sys.path.append('${path.join(process.cwd(), '../../')}')

try:
    from staff_functions import init_account, scrape_company_staff

    # Use existing session file for authentication
    session_path = os.path.join('${path.join(process.cwd(), '../../')}', '${sessionFile}')

    # Initialize account with existing session
    account = init_account('', '', session_file=session_path)

    # Scrape staff data
    csv_file = scrape_company_staff(
        account=account,
        company_name='${args[0]}',
        search_term='${args[1]}',
        location='${args[2] || 'USA'}',
        max_results=${args[3] || 10}
    )

    # Read CSV to get metadata
    import pandas as pd
    df = pd.read_csv(csv_file)

    print(json.dumps({
        "success": True,
        "csv_file": csv_file,
        "total_profiles": len(df),
        "columns": df.columns.tolist()
    }))

except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const python = spawn('python3', ['-c', sessionScript], {
      cwd: path.join(process.cwd(), '../../')
    });

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Log non-JSON output for debugging
      if (!output.trim().startsWith('{')) {
        app.log.info(`Python stdout: ${output.trim()}`);
      }
    });

    python.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      app.log.warn(`Python stderr: ${error.trim()}`);
    });

    python.on('close', (code) => {
      app.log.info(`Python script finished with code: ${code}`);

      if (code === 0) {
        try {
          // Try to find and parse the JSON output
          const lines = stdout.trim().split('\n');
          let jsonStart = -1;

          // Find the start of JSON output
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('{')) {
              jsonStart = i;
              break;
            }
          }

          if (jsonStart >= 0) {
            // Combine all lines from JSON start to end
            const jsonLines = lines.slice(jsonStart);
            const jsonString = jsonLines.join('\n');
            const result = JSON.parse(jsonString);
            app.log.info(`Python script success: ${result.success ? 'true' : 'false'}`);
            if (result.csv_file) {
              app.log.info(`CSV file generated: ${result.csv_file}`);
            }
            resolve(result);
          } else {
            app.log.warn('No JSON found in Python output');
            resolve({ success: false, error: 'No JSON output from Python script' });
          }
        } catch (e) {
          app.log.warn(`Failed to parse Python output as JSON: ${e instanceof Error ? e.message : String(e)}`);
          resolve({ success: false, error: 'Failed to parse Python script output' });
        }
      } else {
        app.log.error(`Python script failed with code ${code}: ${stderr}`);
        resolve({ success: false, error: stderr || `Process exited with code ${code}` });
      }
    });

    python.on('error', (error) => {
      app.log.error(`Python script error: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
  });
}

async function runPythonScript(scriptName: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), '../../', scriptName);
    app.log.info(`Executing: python3 ${scriptPath} ${args.slice(0, 3).join(' ')} [credentials hidden]`);
    
    const python = spawn('python3', [scriptPath, ...args], {
      cwd: path.join(process.cwd(), '../../')
    });
    
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      // Log non-JSON output for debugging
      if (!output.trim().startsWith('{')) {
        app.log.info(`Python stdout: ${output.trim()}`);
      }
    });
    
    python.stderr.on('data', (data) => {
      const error = data.toString();
      stderr += error;
      app.log.warn(`Python stderr: ${error.trim()}`);
    });
    
    python.on('close', (code) => {
      app.log.info(`Python script finished with code: ${code}`);
      
      if (code === 0) {
        try {
          // Try to find and parse the JSON output (look for lines starting with {)
          const lines = stdout.trim().split('\n');
          let jsonStart = -1;
          
          // Find the start of JSON output
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('{')) {
              jsonStart = i;
              break;
            }
          }
          
          if (jsonStart >= 0) {
            // Combine all lines from JSON start to end
            const jsonLines = lines.slice(jsonStart);
            const jsonString = jsonLines.join('\n');
            const result = JSON.parse(jsonString);
            app.log.info(`Python script success: ${result.success ? 'true' : 'false'}`);
            if (result.csv_file) {
              app.log.info(`CSV file generated: ${result.csv_file}`);
            }
            resolve(result);
          } else {
            app.log.warn('No JSON found in Python output');
            resolve({ success: false, error: 'No JSON output from Python script' });
          }
        } catch (e) {
          app.log.warn(`Failed to parse Python output as JSON: ${e instanceof Error ? e.message : String(e)}`);
          resolve({ success: false, error: 'Failed to parse Python script output' });
        }
      } else {
        app.log.error(`Python script failed with code ${code}: ${stderr}`);
        resolve({ success: false, error: stderr || `Process exited with code ${code}` });
      }
    });
    
    python.on('error', (error) => {
      app.log.error(`Python script error: ${error.message}`);
      resolve({ success: false, error: error.message });
    });
  });
}

async function readCSVFile(filePath: string): Promise<any[]> {
  try {
    const csvContent = await fs.readFile(filePath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.replace(/"/g, '').trim());
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      return obj;
    });
  } catch (error) {
    throw new Error(`Failed to read CSV file: ${error}`);
  }
}

function parseSearchPrompt(prompt: string): { company: string; role: string; location: string } {
  let company = '';
  let role = '';
  let location = 'USA';
  
  // Normalize the prompt
  const normalizedPrompt = prompt.toLowerCase().trim();
  
  // Extract company (after "at" or common company names)
  const companyMatch = prompt.match(/\bat\s+([A-Za-z0-9\-\.& ]+?)(?:\s+in\s+|\s*$)/i);
  if (companyMatch) {
    company = companyMatch[1].trim();
  } else {
    // Look for known companies in the prompt
    const knownCompanies = ['openai', 'google', 'microsoft', 'amazon', 'meta', 'apple', 'netflix', 'tesla', 'uber', 'airbnb'];
    for (const comp of knownCompanies) {
      if (normalizedPrompt.includes(comp)) {
        company = comp.charAt(0).toUpperCase() + comp.slice(1);
        break;
      }
    }
  }
  
  // Extract location (after "in")
  const locationMatch = prompt.match(/\bin\s+([A-Za-z\s,]+?)(?:\s*$)/i);
  if (locationMatch) {
    location = locationMatch[1].trim();
  }
  
  // Extract role/position with more comprehensive patterns
  const rolePatterns = [
    /\b(software engineer intern|software engineer|SWE|engineer|developer|dev|intern)\b/i,
    /\b(product manager|PM|product)\b/i,
    /\b(data scientist|data engineer|ML engineer|AI engineer)\b/i,
    /\b(designer|UX|UI)\b/i,
    /\b(marketing|sales|business)\b/i,
    /\b(research scientist|researcher)\b/i,
    /\b(backend|frontend|fullstack|full stack)\b/i
  ];
  
  for (const pattern of rolePatterns) {
    const match = prompt.match(pattern);
    if (match) {
      role = match[1];
      break;
    }
  }
  
  // If no specific role found, look for general terms before "contacts" or after company
  if (!role) {
    const generalMatch = prompt.match(/find\s+([A-Za-z\s]+?)\s+contacts/i) || 
                        prompt.match(/([A-Za-z\s]+?)\s+at\s+/i) ||
                        prompt.match(/^([A-Za-z\s]+?)\s+[A-Z]/);
    if (generalMatch) {
      role = generalMatch[1].trim();
    }
  }
  
  // Handle case where prompt is just "Company Role" format
  if (!company && !role) {
    const words = prompt.split(/\s+/);
    if (words.length >= 2) {
      // First word might be company, rest might be role
      const potentialCompany = words[0];
      const potentialRole = words.slice(1).join(' ');
      
      const knownCompanies = ['openai', 'google', 'microsoft', 'amazon', 'meta', 'apple'];
      if (knownCompanies.includes(potentialCompany.toLowerCase())) {
        company = potentialCompany;
        role = potentialRole;
      } else {
        // Assume it's all role if we can't identify company
        role = prompt;
      }
    }
  }
  
  app.log.info(`Parsed prompt "${prompt}" -> Company: "${company}", Role: "${role}", Location: "${location}"`);
  
  return { company, role, location };
}

async function cleanupOldCSVFiles(): Promise<void> {
  try {
    const projectRoot = path.join(process.cwd(), '../../');
    const files = await fs.readdir(projectRoot);
    
    // Find all staff CSV files
    const csvFiles = files.filter(file => 
      file.endsWith('.csv') && file.includes('staff')
    );
    
    // Delete old CSV files to save space
    for (const file of csvFiles) {
      const filePath = path.join(projectRoot, file);
      try {
        await fs.unlink(filePath);
        app.log.info(`Deleted old CSV file: ${file}`);
      } catch (error) {
        app.log.warn(`Failed to delete ${file}:`, error);
      }
    }
  } catch (error) {
    app.log.error('Error cleaning up CSV files:', error);
  }
}

async function loadCandidatesFromCSV(csvFilePath: string, searchParams: { company: string; role: string; location: string }): Promise<any[]> {
  try {
    const csvContent = await fs.readFile(csvFilePath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const candidates = [];
    
    for (let i = 1; i < lines.length && candidates.length < 20; i++) {
      const values = parseCSVLine(lines[i]);
      const candidate: any = {};
      
      headers.forEach((header, index) => {
        candidate[header] = values[index] || '';
      });
      
      // Skip empty or invalid entries
      if (!candidate.name || candidate.name === 'LinkedIn Member' || candidate.name.trim() === '') continue;
      
      // Parse potential emails safely
      let primaryEmail = null;
      try {
        if (candidate.potential_emails && candidate.potential_emails !== 'NaN' && candidate.potential_emails.startsWith('[')) {
          const emails = JSON.parse(candidate.potential_emails);
          primaryEmail = emails.length > 0 ? emails[0] : null;
        }
      } catch (e) {
        // If parsing fails, leave email as null
      }
      
      // Parse schools data safely
      let schoolInfo = '';
      try {
        if (candidate.schools && candidate.schools !== 'NaN' && candidate.schools.startsWith('[')) {
          const schools = JSON.parse(candidate.schools);
          schoolInfo = schools.map((s: any) => s.school || s.degree || '').filter(Boolean).join(', ');
        } else if (candidate.school_1) {
          schoolInfo = candidate.school_1;
        }
      } catch (e) {
        schoolInfo = candidate.school_1 || '';
      }
      
      // Parse skills data safely
      let skillsInfo = '';
      try {
        if (candidate.skills && candidate.skills !== 'NaN' && candidate.skills.startsWith('[')) {
          const skills = JSON.parse(candidate.skills);
          skillsInfo = skills.slice(0, 5).map((s: any) => s.name || s).filter(Boolean).join(', ');
        } else if (candidate.top_skill_1) {
          skillsInfo = [candidate.top_skill_1, candidate.top_skill_2, candidate.top_skill_3].filter(Boolean).join(', ');
        }
      } catch (e) {
        skillsInfo = [candidate.top_skill_1, candidate.top_skill_2, candidate.top_skill_3].filter(Boolean).join(', ');
      }
      
      // Convert to our candidate format
      const formattedCandidate = {
        id: `csv-${i}`,
        name: candidate.name || 'Unknown',
        title: candidate.headline || candidate.current_position || searchParams.role,
        company: candidate.current_company || searchParams.company,
        email: primaryEmail,
        linkedinUrl: candidate.profile_link || null,
        location: candidate.location || searchParams.location,
        summary: candidate.bio && candidate.bio !== 'NaN' ? candidate.bio : 
                 candidate.headline || 
                 `${candidate.current_position || searchParams.role} at ${candidate.current_company || searchParams.company}`,
        source: 'staffspy-csv',
        // Additional parsed data
        schools: schoolInfo,
        skills: skillsInfo,
        experience: candidate.experiences || '',
        profilePhoto: candidate.profile_photo && candidate.profile_photo !== 'NaN' ? candidate.profile_photo : null,
        // Raw data for debugging
        rawData: {
          followers: candidate.followers,
          connections: candidate.connections,
          estimated_age: candidate.estimated_age
        }
      };
      
      candidates.push(formattedCandidate);
    }
    
    app.log.info(`Successfully parsed ${candidates.length} candidates from CSV`);
    return candidates;
  } catch (error) {
    app.log.error('Error loading CSV:', error);
    return [];
  }
}

function parseCSVLine(line: string): string[] {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

app.post('/profiles/import', async (req, reply) => {
  const body: any = req.body || {};
  // naive import: upsert fake user and profile
  const user = await prisma.user.upsert({
    where: { email: body.email || 'demo@user.com' },
    update: {},
    create: { email: body.email || 'demo@user.com', name: body.name || 'Demo User' }
  });
  await prisma.profile.upsert({
    where: { userId: user.id },
    update: { summary: body.summary || null, schools: body.schools || [], companies: body.companies || [], skills: body.skills || [] },
    create: { userId: user.id, summary: body.summary || null, schools: body.schools || [], companies: body.companies || [], skills: body.skills || [] }
  });
  reply.send({ status: 'ok' });
});

app.post('/search/run', async (req, reply) => {
  const { prompt, sessionId } = (req.body as any) || {};

  // Check if user is authenticated
  if (!sessionId || !userSessions.has(sessionId)) {
    return reply.code(401).send({
      error: 'LinkedIn authentication required. Please connect your LinkedIn account first.'
    });
  }

  const userSession = userSessions.get(sessionId);
  if (!userSession?.authenticated) {
    return reply.code(401).send({
      error: 'LinkedIn session invalid. Please reconnect your LinkedIn account.'
    });
  }

  try {
    // Parse the user prompt to extract search parameters
    const searchParams = parseSearchPrompt(prompt);

    // Always generate fresh data for each search - don't reuse existing CSVs
    if (searchParams.company && searchParams.role) {
      // Clean up old CSV files first to save space
      await cleanupOldCSVFiles();

      // Generate fresh data for each search
      app.log.info(`Running StaffSpy for: ${searchParams.role} at ${searchParams.company} using session ${sessionId}`);

      // Use scrape_company_staff directly with session
      const result = await runSimpleLinkedInScrape(userSession.sessionFile, searchParams);

      if (result.success && result.csv_file) {
        // Load the newly generated CSV (ensure correct path)
        const csvPath = path.isAbsolute(result.csv_file) 
          ? result.csv_file 
          : path.join(process.cwd(), '../../', result.csv_file);
        const candidates = await loadCandidatesFromCSV(csvPath, searchParams);
        
        // Score the candidates
        const scored = scoreCandidates({
          user: { schools: [], companies: [], skills: [], summary: '' },
          intent: prompt || '',
          candidates
        });

        reply.send({ 
          results: scored,
          source: 'csv-generated',
          csvFile: result.csv_file,
          totalProfiles: result.total_profiles
        });
      } else {
        // StaffSpy failed, return error instead of mock data
        app.log.error('StaffSpy failed:', result.error);
        reply.code(500).send({ 
          error: `LinkedIn extraction failed: ${result.error}. Please try again or check your LinkedIn credentials.`
        });
      }
    } else {
      // Couldn't parse the search query properly
      reply.code(400).send({ 
        error: 'Could not parse search query. Please use format like "Find software engineer contacts at OpenAI"' 
      });
    }
  } catch (error) {
    app.log.error('Search error:', error);
    reply.code(500).send({ error: 'Search failed' });
  }
});

app.post('/messages/draft', async (req, reply) => {
  const { candidate, tone } = (req.body as any) || {};
  const bodyText = draftMessage({
    user: { name: 'Demo User', summary: 'Software engineer exploring opportunities in cloud.' },
    candidate,
    tone: tone || 'warm'
  });
  reply.send({ body: bodyText });
});

app.post('/send/email', async (req, reply) => {
  const { to, subject, text } = (req.body as any) || {};
  const res = await agentMail.sendEmail({ to, from: 'demo@linkedin-messager.dev', subject: subject || 'Hello', text: text || 'Hi there' });
  reply.send(res);
});

app.post('/webhooks/agentmail', async (req, reply) => {
  const event = req.body as any;
  await prisma.event.create({ data: { provider: 'agentmail', type: event.type || 'unknown', messageId: event.messageId || null, payload: event } });
  reply.send({ ok: true });
});

const port = Number(process.env.PORT || 4000);
app.listen({ port }, (err, addr) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API listening on ${addr}`);
});
