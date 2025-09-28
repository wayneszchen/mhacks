import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { createApolloProvider, EmailEnrichmentResult } from './providers/apollo';
import { Candidate } from '../../../packages/shared/src';
import { createAgentMailProvider } from './providers/agentmail';
import { draftMessage, generatePersonalizedMessage } from './services/drafting';
import { scoreCandidates } from './services/scoring';

dotenv.config();

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(formbody);

const apollo = createApolloProvider({ apiKey: process.env.APOLLO_API_KEY });
const agentMail = createAgentMailProvider({ apiKey: process.env.AGENTMAIL_API_KEY });

app.get('/health', async () => ({ ok: true }));

// Check authentication status without creating or reusing sessions
app.get('/linkedin/status', async (req, reply) => {
  try {
    reply.send({
      authenticated: false,
      message: 'No active session - fresh authentication required',
      requiresAuth: true
    });
  } catch (error) {
    app.log.error('Error checking LinkedIn status:', error);
    reply.code(500).send({
      authenticated: false,
      error: 'Failed to check authentication status'
    });
  }
});


// LinkedIn Authentication using StaffSpy init_account (browser-based)
// Session storage for authenticated users
const userSessions = new Map<string, { sessionFile: string; authenticated: boolean; email?: string; profile?: any; createdAt: number }>();

// Profile cache to avoid repeated file system operations
const profileCache = new Map<string, { profile: any; timestamp: number }>();
const PROFILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Session cleanup - remove old sessions
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
async function cleanupOldSessions() {
  const now = Date.now();
  const projectRoot = path.join(process.cwd(), '../../');

  try {
    // Clean up in-memory sessions
    for (const [sessionId, session] of userSessions.entries()) {
      if (now - session.createdAt > SESSION_TTL) {
        userSessions.delete(sessionId);
        app.log.info(`🗑️ Cleaned up expired in-memory session: ${sessionId}`);
      }
    }

    // Clean up file-based sessions
    const files = await fs.readdir(projectRoot);
    const sessionFiles = files.filter(file =>
      file.startsWith('linkedin_session_') &&
      (file.endsWith('.pkl') || file.endsWith('_profile.json'))
    );

    for (const file of sessionFiles) {
      try {
        const filePath = path.join(projectRoot, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtime.getTime() > SESSION_TTL) {
          await fs.unlink(filePath);
          app.log.info(`🗑️ Cleaned up old session file: ${file}`);
        }
      } catch (error) {
        app.log.warn(`Failed to clean up session file ${file}:`, error);
      }
    }
  } catch (error) {
    app.log.warn('Session cleanup failed:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// Function to initialize LinkedIn account using StaffSpy (browser-based auth)
async function initLinkedInAccount(sessionFile: string): Promise<{ success: boolean; error?: string; email?: string }> {
  return new Promise((resolve) => {
    // const scriptPath = path.join(process.cwd(), '../../', 'staff_functions.py');
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
    // Always create a fresh session for new authentication requests
    // This ensures proper isolation between different browser contexts/users
    const sessionId = Math.random().toString(36).substring(7) + Date.now().toString(36);
    const sessionFile = `linkedin_session_${sessionId}.pkl`;
    const usingExistingSession = false;

    app.log.info(`🔐 Creating new LinkedIn authentication session: ${sessionFile}`);

    app.log.info('Starting LinkedIn browser authentication...');

    // Call init_account without credentials to trigger browser auth
    const result = await initLinkedInAccount(sessionFile);

    if (result.success) {
      // Load the user profile that was created during authentication
      let userProfile = null;
      try {
        const projectRoot = path.join(process.cwd(), '../../');
        const profileFile = sessionFile.replace('.pkl', '_profile.json');
        const profilePath = path.join(projectRoot, profileFile);

        const profileData = await fs.readFile(profilePath, 'utf-8');
        userProfile = JSON.parse(profileData);
        app.log.info(`✅ Loaded user profile: ${userProfile.name} (${userProfile.university})`);
      } catch (profileError) {
        app.log.warn('Could not load user profile after authentication:', profileError);
      }

      // Store session info with profile
      userSessions.set(sessionId, {
        sessionFile,
        authenticated: true,
        email: result.email || userProfile?.email,
        profile: userProfile,
        createdAt: Date.now()
      });

      // Store user in database with real profile data
      const userName = userProfile?.name || 'LinkedIn User';
      const userEmail = result.email || userProfile?.email || 'linkedin@user.com';

      if (userEmail !== 'linkedin@user.com') {
        await prisma.user.upsert({
          where: { email: userEmail },
          update: { name: userName },
          create: { email: userEmail, name: userName }
        });
      }

      app.log.info('LinkedIn authentication successful');

      reply.send({
        success: true,
        sessionId,
        message: usingExistingSession
          ? 'LinkedIn authentication successful (reused existing session)'
          : 'LinkedIn authentication successful',
        usingExistingSession,
        sessionFile,
        user: {
          email: userEmail,
          name: userName,
          profile: userProfile
        }
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

// Force new LinkedIn authentication (don't reuse existing sessions)
app.post('/linkedin/auth/new', async (req, reply) => {
  try {
    // Always generate new session ID and file path
    const sessionId = Math.random().toString(36).substring(7) + Date.now().toString(36);
    const sessionFile = `linkedin_session_${sessionId}.pkl`;

    app.log.info(`Creating new LinkedIn session: ${sessionFile}`);

    // Call init_account without credentials to trigger browser auth
    const result = await initLinkedInAccount(sessionFile);

    if (result.success) {
      // Load the user profile that was created during authentication
      let userProfile = null;
      try {
        const projectRoot = path.join(process.cwd(), '../../');
        const profileFile = sessionFile.replace('.pkl', '_profile.json');
        const profilePath = path.join(projectRoot, profileFile);

        const profileData = await fs.readFile(profilePath, 'utf-8');
        userProfile = JSON.parse(profileData);
        app.log.info(`✅ Loaded new user profile: ${userProfile.name} (${userProfile.university})`);
      } catch (profileError) {
        app.log.warn('Could not load user profile after new authentication:', profileError);
      }

      // Store session info with profile
      userSessions.set(sessionId, {
        sessionFile,
        authenticated: true,
        email: result.email || userProfile?.email,
        profile: userProfile,
        createdAt: Date.now()
      });

      // Store user in database with real profile data
      const userName = userProfile?.name || 'LinkedIn User';
      const userEmail = result.email || userProfile?.email || 'linkedin@user.com';

      if (userEmail !== 'linkedin@user.com') {
        await prisma.user.upsert({
          where: { email: userEmail },
          update: { name: userName },
          create: { email: userEmail, name: userName }
        });
      }

      app.log.info('New LinkedIn authentication successful');

      reply.send({
        success: true,
        sessionId,
        message: 'New LinkedIn authentication successful',
        usingExistingSession: false,
        sessionFile,
        user: {
          email: userEmail,
          name: userName,
          profile: userProfile
        }
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
});

// Clean up old session files
app.delete('/linkedin/sessions/cleanup', async (req, reply) => {
  try {
    const projectRoot = path.join(process.cwd(), '../../');
    const files = await fs.readdir(projectRoot);

    // Find all LinkedIn session files
    const sessionFiles = files.filter(file =>
      file.startsWith('linkedin_session_') &&
      (file.endsWith('.pkl') || file.endsWith('_profile.json'))
    );

    let deletedCount = 0;
    for (const file of sessionFiles) {
      try {
        await fs.unlink(path.join(projectRoot, file));
        deletedCount++;
        app.log.info(`Deleted session file: ${file}`);
      } catch (error) {
        app.log.warn(`Failed to delete ${file}:`, error);
      }
    }

    // Clear in-memory sessions
    userSessions.clear();

    reply.send({
      success: true,
      message: `Cleaned up ${deletedCount} session files`,
      deletedFiles: deletedCount
    });
  } catch (error) {
    app.log.error('Session cleanup error:', error);
    reply.code(500).send({
      error: 'Session cleanup failed'
    });
  }
});

// List current LinkedIn sessions
app.get('/linkedin/sessions', async (req, reply) => {
  try {
    const projectRoot = path.join(process.cwd(), '../../');
    const files = await fs.readdir(projectRoot);

    // Find all LinkedIn session files
    const sessionFiles = files.filter(file =>
      file.startsWith('linkedin_session_') &&
      file.endsWith('.pkl')
    );

    const sessions = [];
    for (const file of sessionFiles) {
      const sessionId = file.replace('linkedin_session_', '').replace('.pkl', '');
      const filePath = path.join(projectRoot, file);

      try {
        const stats = await fs.stat(filePath);
        const profileFile = file.replace('.pkl', '_profile.json');
        const profilePath = path.join(projectRoot, profileFile);

        let profileInfo = null;
        try {
          const profileData = await fs.readFile(profilePath, 'utf-8');
          const profile = JSON.parse(profileData);
          profileInfo = {
            name: profile.name,
            email: profile.email || 'N/A',
            company: profile.current_company || 'N/A'
          };
        } catch (profileError) {
          // Profile file doesn't exist or can't be read
        }

        sessions.push({
          sessionId,
          sessionFile: file,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
          size: stats.size,
          inMemory: userSessions.has(sessionId),
          profile: profileInfo
        });
      } catch (error) {
        app.log.warn(`Error reading session file stats for ${file}:`, error);
      }
    }

    // Sort by modification time (most recent first)
    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

    reply.send({
      success: true,
      sessions,
      inMemoryCount: userSessions.size,
      totalFiles: sessionFiles.length
    });
  } catch (error) {
    app.log.error('Error listing sessions:', error);
    reply.code(500).send({
      error: 'Failed to list sessions'
    });
  }
});

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
        max_results=25
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

    // Use simple, reliable CSV parsing similar to Python's approach
    const records = parseCSVSimple(csvContent);
    if (records.length < 2) return [];

    const headers = records[0];
    const candidates = [];

    app.log.info(`CSV parsing: Found ${records.length - 1} records with ${headers.length} fields each`);

    for (let i = 1; i < records.length && candidates.length < 20; i++) {
      const values = records[i];

      // Skip if field count doesn't match headers (malformed record)
      if (values.length !== headers.length) {
        app.log.warn(`Skipping malformed CSV record ${i + 1}: expected ${headers.length} fields, got ${values.length}. First few fields: ${JSON.stringify(values.slice(0, 6))}`);
        continue;
      }

      const candidate: any = {};
      headers.forEach((header, index) => {
        candidate[header] = values[index] || '';
      });

      // Skip empty or invalid entries
      if (!candidate.name || candidate.name === 'LinkedIn Member' || candidate.name.trim() === '') {
        app.log.debug(`Skipping candidate with empty/invalid name: "${candidate.name}" (URL: ${candidate.profile_link})`);
        continue;
      }

      // Skip entries where name contains obviously non-name content
      const name = candidate.name.trim();

      // Check if name starts with a non-letter character
      if (name.length > 0 && !/^[A-Za-z]/.test(name)) {
        app.log.warn(`Filtering out candidate with name starting with non-letter: "${name}" (URL: ${candidate.profile_link})`);
        continue;
      }

      const invalidNamePatterns = [
        /VSCode/i,
        /Visual Studio/i,
        /Programming Languages:/i,
        /Frameworks:/i,
        /Databases:/i,
        /Tools:/i,
        /Skills:/i,
        /^[A-Z]{2,}$/,  // All caps words (likely technologies)
        /\b(Java|Python|JavaScript|React|Node|HTML|CSS|SQL|AWS|Docker)\b/i,
        /[{}[\]]/,  // Contains JSON-like brackets
        /^\d+$/,  // Just numbers
        /^[A-Za-z]\.$/, // Single letter with period (like "T.")
        /\bGit\b/i,
        /\bAPI\b/i,
        /\bSDK\b/i,
        /^'/,  // Starts with single quote (like "'location': None")
        /^"/,  // Starts with double quote
        /^[{[]/  // Starts with JSON bracket
      ];

      const isInvalidName = invalidNamePatterns.some(pattern => pattern.test(name));
      if (isInvalidName) {
        app.log.warn(`Filtering out candidate with invalid name: "${name}" (URL: ${candidate.profile_link})`);
        continue;
      }

      app.log.debug(`Processing valid candidate: ${name}`);
      
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

function parseCSVSimple(csvContent: string): string[][] {
  // Robust CSV parser that handles multiline records and malformed data
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csvContent.length) {
    const char = csvContent[i];

    if (char === '"') {
      if (inQuotes && i + 1 < csvContent.length && csvContent[i + 1] === '"') {
        // Escaped quote: "" becomes "
        currentField += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // Field delimiter outside quotes
      currentRecord.push(cleanField(currentField));
      currentField = '';
      i++;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Record delimiter outside quotes
      currentRecord.push(cleanField(currentField));

      // Only add non-empty records
      if (currentRecord.some(field => field.trim())) {
        records.push(currentRecord);
      }

      currentRecord = [];
      currentField = '';

      // Handle \r\n
      if (char === '\r' && i + 1 < csvContent.length && csvContent[i + 1] === '\n') {
        i++;
      }
      i++;
    } else {
      currentField += char;
      i++;
    }
  }

  // Handle the last field/record
  if (currentField || currentRecord.length > 0) {
    currentRecord.push(cleanField(currentField));
    if (currentRecord.some(field => field.trim())) {
      records.push(currentRecord);
    }
  }

  return records;
}

function cleanField(field: string): string {
  field = field.trim();
  // Remove surrounding quotes if they exist
  if (field.startsWith('"') && field.endsWith('"')) {
    field = field.slice(1, -1);
  }
  // Clean up common CSV escaping issues
  field = field.replace(/""/g, '"'); // Fix escaped quotes
  return field;
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
  let userSession;

  if (sessionId && userSessions.has(sessionId)) {
    // Use in-memory session if available
    userSession = userSessions.get(sessionId);
  } else if (sessionId) {
    // Try to recover session from session file (for server restarts)
    try {
      const projectRoot = path.join(process.cwd(), '../../');
      const files = await fs.readdir(projectRoot);

      // Look for session files that match this sessionId
      const sessionFiles = files.filter(file =>
        file.startsWith('linkedin_session_') &&
        file.endsWith('.pkl') &&
        file.includes(sessionId)
      );

      if (sessionFiles.length > 0) {
        const sessionFile = sessionFiles[0];
        userSession = {
          sessionFile,
          authenticated: true,
          email: undefined,
          createdAt: Date.now()
        };
        userSessions.set(sessionId, userSession);
        app.log.info(`Recovered session from file: ${sessionFile}`);
      } else {
        // Try to find any recent session file as fallback
        const allSessionFiles = files.filter(file =>
          file.startsWith('linkedin_session_') &&
          file.endsWith('.pkl')
        );

        if (allSessionFiles.length > 0) {
          // Use the most recent session file
          const sessionFile = allSessionFiles[0];
          userSession = {
            sessionFile,
            authenticated: true,
            email: undefined,
            createdAt: Date.now()
          };
          userSessions.set(sessionId, userSession);
          app.log.info(`Using fallback session file: ${sessionFile}`);
        } else {
          userSession = null;
        }
      }
    } catch (error) {
      app.log.warn('Failed to recover session from files:', error);
      userSession = null;
    }
  }

  if (!sessionId || !userSession?.authenticated) {
    return reply.code(401).send({
      error: 'LinkedIn authentication required. Please connect your LinkedIn account first.'
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
        
        // Extract user profile for better scoring
        let userProfile = { schools: [] as string[], companies: [] as string[], skills: [] as string[], summary: '' };

        // Try to load user profile from session file
        try {
          const profileFile = userSession.sessionFile.replace('.pkl', '_profile.json');
          const profilePath = path.join(process.cwd(), '../../', profileFile);
          const profileData = await fs.readFile(profilePath, 'utf-8');
          const parsedProfile = JSON.parse(profileData);

          // Extract relevant data for scoring
          userProfile = {
            schools: parsedProfile.university ? [parsedProfile.university] : [],
            companies: parsedProfile.current_company ? [parsedProfile.current_company] : [],
            skills: [] as string[], // Could be extracted from detailed_data if available
            summary: parsedProfile.headline || ''
          };

          app.log.info(`Using user profile for scoring: ${parsedProfile.name} (${parsedProfile.university || 'N/A'})`);
        } catch (error) {
          app.log.warn('Could not load user profile for scoring, using defaults');
        }

        // Score the candidates using enhanced scoring
        const scored = await scoreCandidates({
          user: userProfile,
          intent: prompt || '',
          candidates
        });

        // Enrich emails for candidates who don't have them
        const candidatesNeedingEmails = scored.filter(c => !c.email || c.email === '' || c.email === 'null');
        app.log.info(`Found ${candidatesNeedingEmails.length} candidates needing email enrichment`);

        if (candidatesNeedingEmails.length > 0) {
          try {
            const enrichmentResults = await apollo.bulkEnrichEmails(
              candidatesNeedingEmails.map(c => ({
                name: c.name,
                company: c.company,
                linkedinUrl: c.linkedinUrl,
                domain: c.company ? `${c.company.toLowerCase().replace(/[^a-z]/g, '')}.com` : undefined
              }))
            );

            // Update candidates with enriched emails
            candidatesNeedingEmails.forEach((candidate, index) => {
              const enrichment = enrichmentResults[index];
              if (enrichment) {
                candidate.email = enrichment.email || undefined;
                candidate.emailStatus = enrichment.status;
              }
            });

            app.log.info(`Email enrichment complete: ${enrichmentResults.filter(r => r.status === 'found').length} emails found`);
          } catch (error) {
            app.log.warn('Email enrichment failed:', error);
            // Mark candidates as having email search errors
            candidatesNeedingEmails.forEach((candidate: Candidate) => {
              candidate.emailStatus = 'error';
            });
          }
        }

        reply.send({
          results: scored,
          source: 'csv-generated',
          csvFile: result.csv_file,
          totalProfiles: result.total_profiles,
          emailEnrichment: {
            attempted: candidatesNeedingEmails.length,
            found: scored.filter(c => c.emailStatus === 'found').length
          }
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
  const { candidate, tone, channel, sessionId } = (req.body as any) || {};

  try {
    // Try to load sender profile from session file
    let senderProfile = {
      name: 'Demo User',
      headline: 'Software engineer exploring opportunities',
      current_company: '',
      university: '',
      summary: 'Software engineer exploring opportunities in cloud.',
      skills: [],
      experiences: [],
      schools: []
    };

    if (sessionId) {
      // First check in-memory session storage
      const sessionData = userSessions.get(sessionId);
      if (sessionData && sessionData.profile) {
        senderProfile = {
          name: sessionData.profile.name || 'User',
          headline: sessionData.profile.headline || '',
          current_company: sessionData.profile.current_company || '',
          university: sessionData.profile.university || '',
          summary: sessionData.profile.bio || sessionData.profile.headline || '',
          skills: sessionData.profile.skills || [],
          experiences: sessionData.profile.experiences || [],
          schools: sessionData.profile.schools || []
        };
        app.log.info(`🚀 Using in-memory profile for session ${sessionId}: ${senderProfile.name}`);
      } else {
        // Check cache next
        const cacheKey = `profile_${sessionId}`;
        const cached = profileCache.get(cacheKey);
        const now = Date.now();

        if (cached && (now - cached.timestamp < PROFILE_CACHE_TTL)) {
          senderProfile = cached.profile;
          app.log.info(`✅ Using cached profile for session ${sessionId}`);
        } else {
          try {
            // Direct file path construction (faster than directory scanning)
            const projectRoot = path.join(process.cwd(), '../../');
            const profileFile = `linkedin_session_${sessionId}_profile.json`;
          const profilePath = path.join(projectRoot, profileFile);

          try {
            const profileData = await fs.readFile(profilePath, 'utf-8');
            const parsedProfile = JSON.parse(profileData);

            senderProfile = {
              name: parsedProfile.name || parsedProfile.headline || 'User',
              headline: parsedProfile.headline || '',
              current_company: parsedProfile.current_company || '',
              university: parsedProfile.university || '',
              summary: parsedProfile.bio || parsedProfile.headline || '',
              skills: parsedProfile.skills || [],
              experiences: parsedProfile.experiences || [],
              schools: parsedProfile.schools || []
            };

            // Cache the profile
            profileCache.set(cacheKey, { profile: senderProfile, timestamp: now });
            app.log.info(`📁 Loaded and cached sender profile: ${senderProfile.name} from ${profileFile}`);
            } catch (profileError) {
              app.log.warn(`Could not load profile file: ${profileFile}`, profileError);
            }
          } catch (error) {
            app.log.warn('Could not load session profile:', error);
          }
        }
      }
    }

    // Generate personalized message using Gemini
    const bodyText = await generatePersonalizedMessage({
      senderProfile,
      receiverProfile: {
        name: candidate.name,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        summary: candidate.summary,
        skills: candidate.skills,
        schools: candidate.schools,
        experience: candidate.experience
      },
      tone: tone || 'warm',
      channel: channel || 'linkedin'
    });

    reply.send({
      body: bodyText,
      senderProfile: {
        name: senderProfile.name,
        headline: senderProfile.headline,
        company: senderProfile.current_company
      }
    });
  } catch (error) {
    app.log.error('Error generating personalized message:', error);

    // Fallback to basic template
    const bodyText = draftMessage({
      user: { name: 'Demo User', summary: 'Software engineer exploring opportunities in cloud.' },
      candidate,
      tone: tone || 'warm'
    });

    reply.send({ body: bodyText });
  }
});

// Email enrichment endpoint
app.post('/email/enrich', async (req, reply) => {
  const { people } = (req.body as any) || {};

  if (!people || !Array.isArray(people)) {
    return reply.code(400).send({
      error: 'Request must include a "people" array with person objects'
    });
  }

  try {
    app.log.info(`Enriching emails for ${people.length} people`);

    // Use Apollo to enrich emails
    const results = await apollo.bulkEnrichEmails(people);

    const enrichedPeople = people.map((person, index) => ({
      ...person,
      emailEnrichment: results[index] || {
        email: null,
        status: 'error' as const,
        error: 'No result returned'
      }
    }));

    reply.send({
      success: true,
      results: enrichedPeople,
      stats: {
        total: people.length,
        found: results.filter(r => r.status === 'found').length,
        not_found: results.filter(r => r.status === 'not_found').length,
        errors: results.filter(r => r.status === 'error').length
      }
    });
  } catch (error) {
    app.log.error('Email enrichment error:', error);
    reply.code(500).send({
      error: 'Email enrichment service unavailable'
    });
  }
});

// Single person email enrichment
app.post('/email/enrich/single', async (req, reply) => {
  const { name, company, linkedinUrl, domain } = (req.body as any) || {};

  if (!name) {
    return reply.code(400).send({
      error: 'Name is required for email enrichment'
    });
  }

  try {
    app.log.info(`Enriching email for: ${name} at ${company || 'unknown company'}`);

    const result = await apollo.enrichPersonEmail({
      name,
      company,
      linkedinUrl,
      domain
    });

    reply.send({
      success: true,
      person: { name, company, linkedinUrl, domain },
      email: result.email,
      status: result.status,
      confidence: result.confidence,
      source: result.source,
      error: result.error
    });
  } catch (error) {
    app.log.error('Single email enrichment error:', error);
    reply.code(500).send({
      success: false,
      error: 'Email enrichment service unavailable'
    });
  }
});

// Complete Apollo pipeline: search by company/name + email enrichment + website post
app.post('/apollo/pipeline', async (req, reply) => {
  const { company, role, location, maxResults = 10 } = (req.body as any) || {};

  if (!company || !role) {
    return reply.code(400).send({
      error: 'Company and role are required for Apollo search'
    });
  }

  try {
    app.log.info(`Starting Apollo pipeline: ${role} at ${company}`);

    // Step 1: Search for people using Apollo API
    const searchResults = await apollo.searchPeople({
      company,
      role,
      location
    });

    if (searchResults.length === 0) {
      return reply.send({
        success: true,
        message: 'No candidates found matching the criteria',
        results: [],
        stats: { searched: 0, enriched: 0, posted: 0 }
      });
    }

    app.log.info(`Found ${searchResults.length} candidates from Apollo search`);

    // Step 2: Filter for candidates without emails and enrich them
    const candidatesNeedingEmails = searchResults
      .filter(c => !c.email || c.email === '' || c.email === 'null')
      .slice(0, maxResults);

    let enrichedEmails: EmailEnrichmentResult[] = [];
    if (candidatesNeedingEmails.length > 0) {
      app.log.info(`Enriching emails for ${candidatesNeedingEmails.length} candidates`);

      enrichedEmails = await apollo.bulkEnrichEmails(
        candidatesNeedingEmails.map(c => ({
          name: c.name,
          company: c.company,
          linkedinUrl: c.linkedinUrl,
          domain: c.company ? `${c.company.toLowerCase().replace(/[^a-z]/g, '')}.com` : undefined
        }))
      );

      // Update candidates with enriched emails
      candidatesNeedingEmails.forEach((candidate, index) => {
        const enrichment = enrichedEmails[index];
        if (enrichment && enrichment.email) {
          candidate.email = enrichment.email;
          candidate.emailStatus = enrichment.status;
        }
      });
    }

    // Step 3: Get all candidates with emails
    const candidatesWithEmails = searchResults.filter(c => c.email && c.email !== '' && c.email !== 'null');
    const emailFoundCount = enrichedEmails.filter(r => r.status === 'found').length;

    app.log.info(`Final results: ${candidatesWithEmails.length} candidates with emails`);

    // Step 4: POST results to website (if configured)
    let postResults = [];
    if (process.env.WEBHOOK_URL && candidatesWithEmails.length > 0) {
      try {
        app.log.info(`Posting ${candidatesWithEmails.length} candidates to webhook`);

        const postResponse = await fetch(process.env.WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': process.env.WEBHOOK_AUTH || ''
          },
          body: JSON.stringify({
            query: { company, role, location },
            candidates: candidatesWithEmails.map(c => ({
              name: c.name,
              title: c.title,
              company: c.company,
              email: c.email,
              linkedinUrl: c.linkedinUrl,
              location: c.location,
              source: c.source,
              emailStatus: c.emailStatus
            })),
            timestamp: new Date().toISOString(),
            source: 'apollo-pipeline'
          })
        });

        if (postResponse.ok) {
          postResults.push({ status: 'success', count: candidatesWithEmails.length });
          app.log.info('Successfully posted candidates to webhook');
        } else {
          const errorText = await postResponse.text();
          postResults.push({ status: 'error', error: `Webhook failed: ${postResponse.status} - ${errorText}` });
        }
      } catch (error) {
        app.log.error('Webhook post error:', error);
        postResults.push({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown webhook error'
        });
      }
    }

    reply.send({
      success: true,
      results: candidatesWithEmails,
      stats: {
        searched: searchResults.length,
        needingEnrichment: candidatesNeedingEmails.length,
        enriched: emailFoundCount,
        finalWithEmails: candidatesWithEmails.length,
        posted: postResults.length > 0 ? (postResults[0].status === 'success' ? candidatesWithEmails.length : 0) : 0
      },
      enrichment: enrichedEmails.map(r => ({
        status: r.status,
        found: !!r.email,
        source: r.source
      })),
      webhook: postResults.length > 0 ? postResults[0] : null
    });
  } catch (error) {
    app.log.error('Apollo pipeline error:', error);
    reply.code(500).send({
      error: 'Apollo pipeline failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Enhanced email sending with AgentMail integration
app.post('/email/send', async (req, reply) => {
  const {
    candidateId,
    candidateName,
    candidateEmail,
    subject,
    message,
    userId = 'demo-user', // TODO: Get from auth
    tone = 'warm',
    sessionId
  } = (req.body as any) || {};

  if (!candidateEmail || !message) {
    return reply.code(400).send({
      error: 'Candidate email and message are required'
    });
  }

  try {
    // Check if development email routing is enabled
    const isDevMode = process.env.DEV_EMAIL_ROUTING === 'true';
    const devEmail = process.env.DEV_EMAIL_ADDRESS || 'linusaw@umich.edu';

    const actualRecipientEmail = isDevMode ? devEmail : candidateEmail;
    const originalCandidateEmail = candidateEmail;

    app.log.info(`📧 Starting email send to ${actualRecipientEmail} (originally for ${originalCandidateEmail}) for user ${userId}`);

    // 1. Ensure user has an AgentMail inbox
    let providerAccount = await prisma.emailProviderAccount.findFirst({
      where: {
        userId,
        provider: 'agentmail',
        isActive: true
      }
    });

    if (!providerAccount) {
      app.log.info('Creating new AgentMail inbox for user');

      // Create user if doesn't exist
      const user = await prisma.user.upsert({
        where: { email: `${userId}@demo.com` }, // Replace with actual user email from auth
        create: {
          email: `${userId}@demo.com`,
          name: 'Demo User'
        },
        update: {}
      });

      // Create or get existing AgentMail inbox
      const { agentMail } = await import('./lib/agentmail');
      let inbox;
      try {
        inbox = await agentMail.createInbox(
          `user-${userId.substring(0, 8)}`,
          'Automated Outreach Agent'
        );
      } catch (error: any) {
        // If inbox already exists, try to get the existing one
        if (error.message && error.message.includes('AlreadyExistsError')) {
          app.log.info('Inbox already exists, fetching existing inbox list');
          const inboxes = await agentMail.getInboxes();
          app.log.info('Retrieved inboxes:', { inboxes, type: typeof inboxes, isArray: Array.isArray(inboxes) });
          const targetInboxId = `user-${userId.substring(0, 8)}@agentmail.to`;
          inbox = inboxes.find((i: any) => i.inbox_id === targetInboxId);

          if (!inbox) {
            throw new Error(`Could not find existing inbox with ID: ${targetInboxId}`);
          }
          app.log.info(`✅ Using existing AgentMail inbox: ${inbox.inbox_id}`);
        } else {
          throw error;
        }
      }

      // Store in database (upsert to handle existing accounts)
      providerAccount = await prisma.emailProviderAccount.upsert({
        where: {
          userId_provider: {
            userId: user.id,
            provider: 'agentmail'
          }
        },
        create: {
          userId: user.id,
          provider: 'agentmail',
          externalInboxId: inbox.inbox_id,
          address: inbox.inbox_id, // The inbox_id IS the email address
          displayName: inbox.display_name || 'Automated Outreach Agent'
        },
        update: {
          externalInboxId: inbox.inbox_id,
          address: inbox.inbox_id,
          displayName: inbox.display_name || 'Automated Outreach Agent',
          isActive: true
        }
      });

      app.log.info(`✅ Created AgentMail inbox: ${inbox.inbox_id}`);
    }

    // 2. Generate personalized email content
    let emailHtml = message;
    let emailSubject = subject || 'Quick Connect';

    // Try to generate personalized content if we have session data
    if (sessionId && candidateName) {
      try {
        const personalizedMessage = await generatePersonalizedMessage({
          senderProfile: {
            name: 'Demo User', // TODO: Get from user profile
            headline: 'Looking to connect',
            current_company: '',
            university: '',
            summary: '',
            skills: [],
            experiences: [],
            schools: []
          },
          receiverProfile: {
            name: candidateName,
            title: '',
            company: '',
            location: '',
            summary: '',
            skills: '',
            schools: '',
            experience: ''
          },
          tone: tone as any,
          channel: 'email'
        });

        emailHtml = personalizedMessage;
        emailSubject = subject || `Quick connect - ${candidateName}`;
      } catch (error) {
        app.log.warn('Failed to generate personalized message, using provided message');
      }
    }

    // 3. Enhance email content to show original recipient information (dev mode only)
    let enhancedEmailHtml = emailHtml;

    if (isDevMode) {
      const developmentNote = `
        <div style="background: #f0f8ff; border: 1px solid #0066cc; padding: 15px; margin: 20px 0; border-radius: 5px;">
          <h4 style="color: #0066cc; margin: 0 0 10px 0;">🔧 Development Mode - Email Routing Info</h4>
          <p style="margin: 5px 0;"><strong>Original Recipient:</strong> ${candidateName} (${originalCandidateEmail})</p>
          <p style="margin: 5px 0;"><strong>Candidate ID:</strong> ${candidateId}</p>
          <p style="margin: 5px 0;"><strong>Subject:</strong> ${emailSubject}</p>
          <hr style="margin: 10px 0;">
          <p style="margin: 5px 0; font-size: 12px; color: #666;">This email was originally intended for ${candidateName} but routed to you for testing purposes.</p>
        </div>
      `;
      enhancedEmailHtml = developmentNote + emailHtml;
    }

    // 4. Format email with proper HTML and compliance
    const { agentMail } = await import('./lib/agentmail');
    const recipientName = isDevMode ? 'Linus (Developer)' : candidateName;
    const finalSubject = isDevMode ? `[DEV] ${emailSubject} (for ${candidateName})` : emailSubject;

    const formattedHtml = agentMail.formatEmailHtml(
      enhancedEmailHtml,
      recipientName,
      providerAccount.displayName,
      true, // include unsubscribe
      actualRecipientEmail
    );

    // 5. Send via AgentMail
    const sentMessage = await agentMail.sendEmail(
      providerAccount.externalInboxId,
      actualRecipientEmail,
      finalSubject,
      formattedHtml
    );

    // 5. Create email thread record
    // TODO: Fix foreign key constraint issue - for now just log the successful email send
    app.log.info(`📧 Email sent successfully to ${actualRecipientEmail} via AgentMail thread: ${sentMessage.thread_id}`);

    // Skip database recording for now since email sending is working
    const emailThread = {
      id: sentMessage.thread_id,
      providerThreadId: sentMessage.thread_id
    };

    // 6. Skip email message record creation for now - database recording can be fixed later
    // TODO: Fix database constraints and re-enable message recording

    app.log.info(`✅ Email sent successfully: ${sentMessage.id}`);

    reply.send({
      success: true,
      messageId: sentMessage.id,
      threadId: emailThread.id,
      providerThreadId: sentMessage.thread_id,
      fromAddress: providerAccount.address,
      status: 'sent',
      sentAt: new Date().toISOString()
    });

  } catch (error) {
    app.log.error('Email sending error:', error);
    reply.code(500).send({
      success: false,
      error: 'Failed to send email',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Legacy endpoint for backwards compatibility
app.post('/send/email', async (req, reply) => {
  const { to, subject, text } = (req.body as any) || {};

  // Redirect to new endpoint
  return req.routeConfig = {
    method: 'POST',
    url: '/email/send',
    body: {
      candidateEmail: to,
      subject: subject || 'Hello',
      message: text || 'Hi there'
    }
  };
});

// Enhanced AgentMail webhook handler
app.post('/webhooks/agentmail', async (req, reply) => {
  const event = req.body as any;

  try {
    app.log.info(`📬 AgentMail webhook received: ${event.type}`, {
      type: event.type,
      messageId: event.data?.message_id,
      threadId: event.data?.thread_id
    });

    // Store webhook event for audit
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        provider: 'agentmail',
        type: event.type || 'unknown',
        eventId: event.id || event.event_id,
        rawJson: event,
        processed: false,
        receivedAt: new Date()
      }
    });

    // Process different event types
    switch (event.type) {
      case 'message.delivered':
      case 'message.opened':
      case 'message.bounced':
      case 'message.failed':
        await handleDeliveryEvent(event, webhookEvent.id);
        break;

      case 'message.received':
        await handleInboundMessage(event, webhookEvent.id);
        break;

      default:
        app.log.warn(`Unknown AgentMail event type: ${event.type}`);
    }

    // Mark as processed
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        processed: true,
        processedAt: new Date()
      }
    });

    reply.send({ ok: true });

  } catch (error) {
    app.log.error('AgentMail webhook processing error:', error);
    reply.code(500).send({
      error: 'Webhook processing failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Handle delivery/status events
async function handleDeliveryEvent(event: any, webhookEventId: string) {
  const { message_id, thread_id, inbox_id } = event.data || {};

  if (!message_id) {
    app.log.warn('No message_id in delivery event');
    return;
  }

  try {
    // Find the email thread
    const thread = await prisma.emailThread.findFirst({
      where: {
        providerThreadId: thread_id
      }
    });

    if (!thread) {
      app.log.warn(`Thread not found for delivery event: ${thread_id}`);
      return;
    }

    // Update thread state based on event type
    let newState = thread.state;
    if (event.type === 'message.delivered') {
      newState = 'AWAITING_REPLY';
    } else if (event.type === 'message.bounced' || event.type === 'message.failed') {
      newState = 'ERROR';
    }

    // Update thread if state changed
    if (newState !== thread.state) {
      await prisma.emailThread.update({
        where: { id: thread.id },
        data: { state: newState }
      });

      app.log.info(`📊 Updated thread ${thread.id} state: ${thread.state} → ${newState}`);
    }

    app.log.info(`✅ Processed delivery event: ${event.type} for message ${message_id}`);

  } catch (error) {
    app.log.error('Error handling delivery event:', error);
  }
}

// Handle inbound messages (replies)
async function handleInboundMessage(event: any, webhookEventId: string) {
  const { message_id, thread_id, inbox_id } = event.data || {};

  if (!message_id || !thread_id || !inbox_id) {
    app.log.warn('Missing required fields in inbound message event');
    return;
  }

  try {
    app.log.info(`📨 Processing inbound message: ${message_id} in thread ${thread_id}`);

    // 1. Find the email thread
    const thread = await prisma.emailThread.findFirst({
      where: {
        providerThreadId: thread_id
      },
      include: {
        providerAccount: true,
        user: true
      }
    });

    if (!thread) {
      app.log.warn(`Thread not found for inbound message: ${thread_id}`);
      return;
    }

    // 2. Fetch raw message from AgentMail
    const { agentMail } = await import('./lib/agentmail');
    let rawMessage = '';
    let messageData = null;

    try {
      rawMessage = await agentMail.getMessageRaw(inbox_id, message_id);
      messageData = await agentMail.getMessage(inbox_id, message_id);
    } catch (error) {
      app.log.error('Failed to fetch message from AgentMail:', error);
      return;
    }

    // 3. Store inbound message
    const emailMessage = await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        direction: 'INBOUND',
        providerMessageId: message_id,
        fromEmail: messageData.from || '',
        toEmail: thread.providerAccount.address,
        subject: messageData.subject,
        snippet: messageData.text?.substring(0, 150) || messageData.html?.substring(0, 150) || '',
        bodyHtml: messageData.html,
        bodyText: messageData.text,
        rawJson: { ...messageData, rawMessage },
        occurredAt: new Date()
      }
    });

    // 4. Update thread
    await prisma.emailThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: new Date(),
        state: 'AWAITING_REPLY' // Will be updated by LLM processing
      }
    });

    // 5. Queue for LLM processing (async)
    await processInboundWithLLM(thread.id, emailMessage.id, rawMessage);

    app.log.info(`✅ Processed inbound message: ${message_id}`);

  } catch (error) {
    app.log.error('Error handling inbound message:', error);
  }
}

// Process inbound message with LLM and potentially send automated reply
async function processInboundWithLLM(threadId: string, messageId: string, rawMessage: string) {
  try {
    app.log.info(`🤖 Processing message ${messageId} with LLM`);

    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      include: {
        providerAccount: true,
        messages: {
          orderBy: { occurredAt: 'desc' },
          take: 5 // Get recent conversation context
        }
      }
    });

    if (!thread) {
      app.log.error(`Thread ${threadId} not found for LLM processing`);
      return;
    }

    // Skip processing if thread is in certain states
    if (['CLOSED', 'CONFIRMED', 'PAUSED'].includes(thread.state)) {
      app.log.info(`Skipping LLM processing for thread in state: ${thread.state}`);
      return;
    }

    // Analyze the inbound message with Gemini
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const analysisPrompt = `
      Analyze this email reply and classify the sender's intent. Respond with JSON only.

      Email context:
      - Original subject: ${thread.subject}
      - Recipient: ${thread.recipientEmail}

      Recent conversation:
      ${thread.messages.map(m => `${m.direction}: ${m.snippet}`).join('\n')}

      Latest inbound message:
      ${rawMessage}

      Classify the intent and determine next action. Return JSON:
      {
        "intent": "interested" | "scheduling" | "not_interested" | "out_of_office" | "question" | "confirmed",
        "sentiment": "positive" | "neutral" | "negative",
        "mentions_meeting": boolean,
        "mentions_specific_times": boolean,
        "proposed_times": ["time1", "time2"], // if any
        "auto_reply_needed": boolean,
        "suggested_response": "response text if auto_reply_needed is true",
        "thread_state": "AWAITING_REPLY" | "SCHEDULING" | "CONFIRMED" | "CLOSED"
      }
    `;

    const analysisResult = await model.generateContent(analysisPrompt);
    const analysis = JSON.parse(analysisResult.response.text());

    app.log.info(`🧠 LLM Analysis: intent=${analysis.intent}, auto_reply=${analysis.auto_reply_needed}`);

    // Update thread state based on analysis
    await prisma.emailThread.update({
      where: { id: threadId },
      data: { state: analysis.thread_state }
    });

    // Send automated reply if needed
    if (analysis.auto_reply_needed && analysis.suggested_response) {
      const { agentMail } = await import('./lib/agentmail');

      const replyHtml = agentMail.formatEmailHtml(
        analysis.suggested_response,
        thread.recipientName,
        thread.providerAccount.displayName,
        true,
        thread.recipientEmail
      );

      // Send reply via AgentMail
      const sentReply = await agentMail.sendReply(
        thread.providerAccount.externalInboxId,
        thread.providerThreadId,
        replyHtml
      );

      // Store outbound reply
      await prisma.emailMessage.create({
        data: {
          threadId: thread.id,
          direction: 'OUTBOUND',
          providerMessageId: sentReply.id,
          fromEmail: thread.providerAccount.address,
          toEmail: thread.recipientEmail,
          subject: `Re: ${thread.subject}`,
          snippet: analysis.suggested_response.substring(0, 150),
          bodyHtml: replyHtml,
          bodyText: analysis.suggested_response,
          rawJson: sentReply,
          occurredAt: new Date()
        }
      });

      app.log.info(`🤖 Sent automated reply: ${sentReply.id}`);
    }

  } catch (error) {
    app.log.error('LLM processing error:', error);

    // Mark thread as needing manual attention
    await prisma.emailThread.update({
      where: { id: threadId },
      data: { state: 'PAUSED' }
    }).catch(() => {});
  }
}

// Email thread management endpoints
app.get('/email/threads/:userId', async (req, reply) => {
  const { userId } = req.params as any;

  try {
    const threads = await prisma.emailThread.findMany({
      where: { userId },
      include: {
        providerAccount: true,
        messages: {
          orderBy: { occurredAt: 'desc' },
          take: 1
        },
        _count: {
          select: { messages: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    const threadsWithStatus = threads.map(thread => ({
      id: thread.id,
      recipientEmail: thread.recipientEmail,
      recipientName: thread.recipientName,
      subject: thread.subject,
      state: thread.state,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread._count.messages,
      lastMessage: thread.messages[0] || null,
      fromAddress: thread.providerAccount.address
    }));

    reply.send({ threads: threadsWithStatus });

  } catch (error) {
    app.log.error('Error fetching email threads:', error);
    reply.code(500).send({
      error: 'Failed to fetch email threads'
    });
  }
});

app.get('/email/threads/:threadId/messages', async (req, reply) => {
  const { threadId } = req.params as any;

  try {
    const messages = await prisma.emailMessage.findMany({
      where: { threadId },
      orderBy: { occurredAt: 'asc' }
    });

    reply.send({ messages });

  } catch (error) {
    app.log.error('Error fetching thread messages:', error);
    reply.code(500).send({
      error: 'Failed to fetch thread messages'
    });
  }
});

app.post('/email/threads/:threadId/pause', async (req, reply) => {
  const { threadId } = req.params as any;

  try {
    const thread = await prisma.emailThread.update({
      where: { id: threadId },
      data: { state: 'PAUSED' }
    });

    reply.send({
      success: true,
      threadId: thread.id,
      state: thread.state
    });

  } catch (error) {
    app.log.error('Error pausing thread:', error);
    reply.code(500).send({
      error: 'Failed to pause thread'
    });
  }
});

const port = Number(process.env.PORT || 4000);
app.listen({ port }, (err, addr) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API listening on ${addr}`);
});
