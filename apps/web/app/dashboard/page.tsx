"use client";
import React, { useState } from 'react';
import Container from '../../components/Container';
import Button from '../../components/Button';
import { motion, AnimatePresence } from 'framer-motion';
// Import Candidate type locally since the shared package isn't properly linked
type Candidate = {
  id: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedinUrl?: string;
  location?: string;
  summary?: string;
  source?: string;
  emailStatus?: 'found' | 'not_found' | 'searching' | 'error' | 'mock_generated';
  score?: number;
  schools?: string;
  skills?: string;
  experience?: string;
  profilePhoto?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Candidate type is now imported from shared package

type AuthState = {
  isAuthenticated: boolean;
  email?: string;
  error?: string;
  sessionId?: string;
};
export default function DashboardPage() {
  const [prompt, setPrompt] = useState('Find Software Engineers at Google');
  const [results, setResults] = useState<Candidate[]>([]);
  const [displayedResults, setDisplayedResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPopulating, setIsPopulating] = useState(false);
  const [expectedCount, setExpectedCount] = useState(0);
  const [draft, setDraft] = useState<string>('');
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [showMessagePopup, setShowMessagePopup] = useState(false);
  const [showEmailPopup, setShowEmailPopup] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [senderProfile, setSenderProfile] = useState<any>(null);
  const [dataSource, setDataSource] = useState<'csv' | 'csv-generated' | 'mock' | 'mock-fallback' | null>(null);
  
  // LinkedIn Authentication State
  const [auth, setAuth] = useState<AuthState>({ isAuthenticated: false });
  const [authLoading, setAuthLoading] = useState(false);

  // Store timeout IDs for cleanup
  const timeoutIds = React.useRef<NodeJS.Timeout[]>([]);

  // LinkedIn Browser Authentication using StaffSpy
  const authenticateLinkedIn = async () => {
    setAuthLoading(true);

    try {
      // Call the new StaffSpy-based authentication endpoint
      const res = await fetch(`${API_URL}/linkedin/auth`, {
        method: 'POST'
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setAuth({
          isAuthenticated: true,
          email: data.user.email,
          sessionId: data.sessionId,
          error: undefined
        });
      } else {
        setAuth({
          isAuthenticated: false,
          error: data.error || 'Authentication failed'
        });
      }
    } catch (error) {
      setAuth({
        isAuthenticated: false,
        error: 'Network error. Please try again.'
      });
    } finally {
      setAuthLoading(false);
    }
  };

  // Check authentication status on component mount
  React.useEffect(() => {
    // Check if user is already authenticated (from localStorage or session)
    const savedAuth = localStorage.getItem('linkedin_auth');
    if (savedAuth) {
      try {
        const authData = JSON.parse(savedAuth);
        setAuth(authData);
      } catch (e) {
        localStorage.removeItem('linkedin_auth');
      }
    }
  }, []);

  // Save auth state to localStorage
  React.useEffect(() => {
    if (auth.isAuthenticated) {
      localStorage.setItem('linkedin_auth', JSON.stringify(auth));
    } else {
      localStorage.removeItem('linkedin_auth');
    }
  }, [auth]);

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      timeoutIds.current.forEach(id => clearTimeout(id));
    };
  }, []);

  // Function to gradually populate results
  const populateResultsGradually = React.useCallback((newResults: Candidate[]) => {
    // Clear any existing timeouts
    timeoutIds.current.forEach(id => clearTimeout(id));
    timeoutIds.current = [];

    setIsPopulating(true);
    setDisplayedResults([]);
    setExpectedCount(newResults.length);

    // Sort results by relevance score (highest first)
    const sortedResults = [...newResults].sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA; // Descending order (highest score first)
    });

    // Add results one by one with delays, starting with most relevant
    sortedResults.forEach((result, index) => {
      const timeoutId = setTimeout(() => {
        setDisplayedResults(prev => [...prev, result]);

        // If this is the last result, stop populating
        if (index === sortedResults.length - 1) {
          const finalTimeoutId = setTimeout(() => setIsPopulating(false), 300);
          timeoutIds.current.push(finalTimeoutId);
        }
      }, index * 800); // 800ms delay between each result

      timeoutIds.current.push(timeoutId);
    });
  }, []);

  const runSearch = async () => {
    if (!auth.isAuthenticated || !auth.sessionId) {
      alert('Please connect your LinkedIn account first.');
      return;
    }

    setLoading(true);
    setResults([]); // Clear previous results
    setDisplayedResults([]); // Clear displayed results
    setDataSource(null); // Clear previous data source
    setIsPopulating(false); // Reset populating state
    console.log(`🔍 Searching for: "${prompt}"`);

    try {
      const res = await fetch(`${API_URL}/search/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId: auth.sessionId })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setResults(data.results || []);
        setDataSource(data.source || 'mock');
        
        // Show success message for generated CSV
        if (data.source === 'csv-generated') {
          console.log(`✅ Generated new CSV with ${data.totalProfiles} profiles: ${data.csvFile}`);
        } else if (data.source === 'csv') {
          console.log(`📁 Using existing CSV data`);
        } else if (data.source === 'mock-fallback') {
          console.warn(`⚠️ LinkedIn scraping failed, using mock data. Error: ${data.error}`);
        }
        
        console.log(`📊 Found ${data.results?.length || 0} profiles from source: ${data.source}`);
        
        if (data.results?.length === 0) {
          alert('No profiles found. This might be due to LinkedIn authentication issues or no matching profiles.');
        } else {
          // Start gradual population after API call completes
          populateResultsGradually(data.results || []);
        }
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Search error:', errorData);
        
        // Show user-friendly error message
        if (res.status === 500) {
          alert(`LinkedIn extraction failed. This could be due to:\n• LinkedIn rate limiting\n• Network issues\n• Invalid search parameters\n\nPlease try again in a few minutes.`);
        } else {
          alert(`Search failed: ${errorData.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      alert('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const draftMessage = async (candidate: Candidate, channel: 'linkedin'|'email' = 'linkedin') => {
    setSelected(candidate);
    setShowMessagePopup(true);
    setMessageLoading(true);
    setDraft('');

    try {
      const res = await fetch(`${API_URL}/messages/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate,
          tone: 'warm',
          channel,
          sessionId: auth.sessionId
        })
      });

      const data = await res.json();
      setDraft(data.body);
      setSenderProfile(data.senderProfile);
    } catch (error) {
      console.error('Error generating message:', error);
      setDraft('Sorry, there was an error generating your personalized message. Please try again.');
    } finally {
      setMessageLoading(false);
    }
  };

  const draftEmail = async (candidate: Candidate) => {
    setSelected(candidate);
    setShowEmailPopup(true);
    setMessageLoading(true);
    setDraft('');

    try {
      const res = await fetch(`${API_URL}/messages/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate,
          tone: 'warm',
          channel: 'email',
          sessionId: auth.sessionId
        })
      });

      const data = await res.json();
      setDraft(data.body);
      setSenderProfile(data.senderProfile);
    } catch (error) {
      console.error('Error generating email:', error);
      setDraft('Sorry, there was an error generating your personalized email. Please try again.');
    } finally {
      setMessageLoading(false);
    }
  };

  const sendEmailWithAgentMail = async (candidate: Candidate) => {
    if (!draft.trim()) {
      alert('Please generate a message first');
      return;
    }

    setEmailSending(true);

    try {
      const res = await fetch(`${API_URL}/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          candidateName: candidate.name,
          candidateEmail: candidate.email || 'test@example.com',
          subject: `Quick connect - ${candidate.name}`,
          message: draft,
          userId: auth.sessionId || 'demo-user',
          tone: 'warm',
          sessionId: auth.sessionId
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert(`✅ Email sent successfully via AgentMail!\n\nEmail routed to: linusaw@umich.edu\nOriginal recipient: ${candidate.name} (${candidate.email})\nMessage ID: ${data.messageId}`);
        setShowEmailPopup(false);
      } else {
        alert(`❌ Failed to send email: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error sending email:', error);
      alert('Network error. Please try again.');
    } finally {
      setEmailSending(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(draft);
  };

  const enrichEmail = async (candidate: Candidate) => {
    if (!candidate.name) return;

    // Update candidate status to searching
    setDisplayedResults(prev => prev.map(c =>
      c.id === candidate.id
        ? { ...c, emailStatus: 'searching' as const }
        : c
    ));

    try {
      const res = await fetch(`${API_URL}/email/enrich/single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: candidate.name,
          company: candidate.company,
          linkedinUrl: candidate.linkedinUrl,
          domain: candidate.company ? `${candidate.company.toLowerCase().replace(/[^a-z]/g, '')}.com` : undefined
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Update candidate with enriched email
        setDisplayedResults(prev => prev.map(c =>
          c.id === candidate.id
            ? {
                ...c,
                email: data.email || undefined,
                emailStatus: data.status as 'found' | 'not_found' | 'error' | 'mock_generated'
              }
            : c
        ));

        // Also update the main results array
        setResults(prev => prev.map(c =>
          c.id === candidate.id
            ? {
                ...c,
                email: data.email || undefined,
                emailStatus: data.status as 'found' | 'not_found' | 'error' | 'mock_generated'
              }
            : c
        ));
      } else {
        // Mark as error
        setDisplayedResults(prev => prev.map(c =>
          c.id === candidate.id
            ? { ...c, emailStatus: 'error' as const }
            : c
        ));
      }
    } catch (error) {
      console.error('Email enrichment error:', error);
      // Mark as error
      setDisplayedResults(prev => prev.map(c =>
        c.id === candidate.id
          ? { ...c, emailStatus: 'error' as const }
          : c
      ));
    }
  };

  return (
    <section className="pt-16 pb-24">
      <Container>
        {/* LinkedIn Authentication Section */}
        {!auth.isAuthenticated ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 rounded-xl bg-white/5 border border-white/10 p-6"
          >
            <h2 className="text-xl font-semibold mb-4">Connect to LinkedIn</h2>
            <p className="text-white/70 mb-6">
              Connect your LinkedIn account to search for real contacts. A browser window will open for LinkedIn authentication.
            </p>
            
            {auth.error && (
              <div className="mb-4 p-3 rounded-md bg-red-500/20 border border-red-500/30 text-red-200">
                {auth.error}
              </div>
            )}
            
            <Button 
              onClick={authenticateLinkedIn} 
              disabled={authLoading}
              className="min-w-[180px] bg-[#0077B5] hover:bg-[#005885] text-white"
            >
              {authLoading ? 'Connecting...' : '🔗 Connect with LinkedIn'}
            </Button>
            
            <p className="text-xs text-white/50 mt-3">
              💡 This will open a browser window where you can log into LinkedIn. Complete the login and return here.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 rounded-xl bg-green-500/20 border border-green-500/30 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-200 font-medium">✅ LinkedIn Connected</p>
                <p className="text-green-200/70 text-sm">Signed in as {auth.email}</p>
              </div>
              <Button 
                variant="ghost" 
                onClick={() => setAuth({ isAuthenticated: false })}
                className="text-green-200 hover:bg-green-500/20"
              >
                Sign Out
              </Button>
            </div>
          </motion.div>
        )}

        {/* Search Section */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-sm text-white/70">Your search intent</label>
            <input
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-brand-600"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Find SWE contacts at Amazon in Seattle"
            />
          </div>
          <Button 
            onClick={runSearch} 
            className="h-10 min-w-[140px]"
            disabled={loading || isPopulating}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Searching LinkedIn...
              </div>
            ) : isPopulating ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Loading Results...
              </div>
            ) : 'Search LinkedIn'}
          </Button>
        </div>

        {/* Loading Status */}
        {loading && (
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-3 px-6 py-4 bg-blue-500/20 border border-blue-500/30 rounded-xl">
              <div className="w-6 h-6 border-2 border-blue-300/30 border-t-blue-300 rounded-full animate-spin"></div>
              <div>
                <div className="text-blue-200 font-medium">Searching LinkedIn with StaffSpy...</div>
                <div className="text-blue-300/70 text-sm mt-1">
                  Extracting fresh profiles for: "{prompt}"
                </div>
                <div className="text-blue-300/50 text-xs mt-1">This may take 30-60 seconds</div>
              </div>
            </div>
          </div>
        )}

        {/* Populating Status */}
        {isPopulating && !loading && (
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-3 px-6 py-4 bg-green-500/20 border border-green-500/30 rounded-xl">
              <div className="w-6 h-6 border-2 border-green-300/30 border-t-green-300 rounded-full animate-spin"></div>
              <div>
                <div className="text-green-200 font-medium">Loading profiles...</div>
                <div className="text-green-300/70 text-sm mt-1">
                  {displayedResults.length} of {expectedCount} profiles loaded
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results Status */}
        {results.length > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-white/70">
              Found {results.length} profiles
              {dataSource === 'csv' || dataSource === 'csv-generated' ? (
                <span className="ml-2 px-2 py-1 bg-green-500/20 text-green-300 rounded-md text-xs">
                  📊 Real LinkedIn Data (Fresh)
                </span>
              ) : dataSource === 'mock-fallback' ? (
                <span className="ml-2 px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded-md text-xs">
                  ⚠️ Mock Data (LinkedIn Failed)
                </span>
              ) : (
                <span className="ml-2 px-2 py-1 bg-blue-500/20 text-blue-300 rounded-md text-xs">
                  🎭 Mock Data
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 grid md:grid-cols-2 gap-6">
          <AnimatePresence>
            {/* Show placeholders for positions not yet filled, filling from top down */}
            {Array.from({ length: expectedCount }).map((_, idx) => {
              const actualResult = displayedResults[idx];

              if (actualResult) {
                // Show actual result
                const r = actualResult;

                // Parse schools data if it's JSON string
                let schoolInfo = '';
                try {
                  if (r.schools && r.schools.startsWith('[')) {
                    const schools = JSON.parse(r.schools);
                    schoolInfo = schools.map((s: any) => s.school || s.degree || s).join(', ');
                  } else {
                    schoolInfo = r.schools || '';
                  }
                } catch (e) {
                  schoolInfo = r.schools || '';
                }

                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{
                      duration: 0.5,
                      ease: "easeOut",
                      type: "spring",
                      stiffness: 100
                    }}
                    className="rounded-xl bg-white/5 border border-white/10 p-5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Profile Photo */}
                      {r.profilePhoto ? (
                        <img
                          src={r.profilePhoto}
                          alt={r.name}
                          className="w-12 h-12 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold">
                          {r.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-lg">{r.name}</div>
                            <div className="text-sm text-white/80 font-medium">
                              {r.title}
                            </div>
                            {schoolInfo && (
                              <div className="text-xs text-blue-300 mt-1 flex items-center gap-1">
                                🎓 {schoolInfo.length > 50 ? schoolInfo.substring(0, 50) + '...' : schoolInfo}
                              </div>
                            )}
                            {/* Email display with status handling */}
                            {r.email ? (
                              <div className="text-xs text-green-300 mt-1 flex items-center gap-1">
                                ✉️ {r.email}
                                {r.emailStatus === 'found' && (
                                  <span className="text-xs bg-green-500/20 text-green-300 px-1 rounded">verified</span>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs mt-1 flex items-center gap-1">
                                {r.emailStatus === 'searching' ? (
                                  <div className="flex items-center gap-1 text-blue-300">
                                    <div className="w-3 h-3 border border-blue-300/30 border-t-blue-300 rounded-full animate-spin"></div>
                                    Searching for email...
                                  </div>
                                ) : r.emailStatus === 'error' ? (
                                  <div className="flex items-center gap-1 text-red-300">
                                    ❌ Email search failed
                                  </div>
                                ) : r.emailStatus === 'not_found' ? (
                                  <div className="flex items-center gap-2 text-orange-300">
                                    ❌ Email not found
                                    <button
                                      onClick={() => enrichEmail(r)}
                                      className="text-xs bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 px-2 py-1 rounded transition-colors"
                                      title="Try to find email again"
                                    >
                                      Retry
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-gray-400">
                                    ❌ No email available
                                    <button
                                      onClick={() => enrichEmail(r)}
                                      className="text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 px-2 py-1 rounded transition-colors"
                                      title="Search for email"
                                    >
                                      Find Email
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-white/50">Relevance</div>
                            <div className="text-sm font-bold text-green-400">
                              {Math.round((r.score || 0) * 100)}%
                            </div>
                            {(r.schools && (r.schools.toLowerCase().includes('michigan') || r.schools.toLowerCase().includes('university of michigan'))) && (
                              <div className="text-xs text-blue-400 mt-1">
                                🎓 Alumni
                              </div>
                            )}
                          </div>
                        </div>

                        {r.summary && (
                          <p className="text-sm text-white/70 mt-2 line-clamp-2 leading-relaxed">
                            {r.summary.length > 120 ? r.summary.substring(0, 120) + '...' : r.summary}
                          </p>
                        )}

                        <div className="mt-3 flex gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => draftMessage(r, 'linkedin')}
                            className="text-xs px-3 py-1"
                          >
                            Draft LinkedIn
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => draftEmail(r)}
                            disabled={!r.email || r.emailStatus === 'not_found' || r.emailStatus === 'error'}
                            className={`text-xs px-3 py-1 ${
                              !r.email || r.emailStatus === 'not_found' || r.emailStatus === 'error'
                                ? 'opacity-50 cursor-not-allowed bg-red-500/10 border-red-500/20 text-red-300'
                                : 'bg-blue-500/20 border-blue-500/30 text-blue-300 hover:bg-blue-500/30'
                            }`}
                            title={!r.email || r.emailStatus === 'not_found' || r.emailStatus === 'error' ? 'Email not available' : 'Send email via AgentMail'}
                          >
                            {!r.email || r.emailStatus === 'not_found' || r.emailStatus === 'error' ? (
                              <span className="flex items-center gap-1">
                                ❌ No Email
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                📧 Draft Email
                              </span>
                            )}
                          </Button>
                          {r.linkedinUrl && (
                            <Button
                              variant="ghost"
                              onClick={() => window.open(r.linkedinUrl, '_blank')}
                              className="text-xs px-3 py-1"
                            >
                              View Profile
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              } else {
                // Show placeholder that will be replaced
                return (
                  <motion.div
                    key={`placeholder-${idx}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-xl bg-white/5 border border-white/10 p-5"
                  >
                    <div className="flex items-start gap-3">
                      {/* Loading avatar */}
                      <div className="w-12 h-12 rounded-full bg-white/10 animate-pulse"></div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            {/* Loading name */}
                            <div className="h-5 bg-white/10 rounded animate-pulse mb-2"></div>
                            {/* Loading title */}
                            <div className="h-4 bg-white/10 rounded animate-pulse w-3/4 mb-2"></div>
                            {/* Loading details */}
                            <div className="h-3 bg-white/10 rounded animate-pulse w-1/2 mb-1"></div>
                            <div className="h-3 bg-white/10 rounded animate-pulse w-2/3"></div>
                          </div>
                          <div className="text-right">
                            <div className="h-3 bg-white/10 rounded animate-pulse w-12 mb-1"></div>
                            <div className="h-4 bg-white/10 rounded animate-pulse w-8"></div>
                          </div>
                        </div>

                        {/* Loading summary */}
                        <div className="mt-2">
                          <div className="h-3 bg-white/10 rounded animate-pulse mb-1"></div>
                          <div className="h-3 bg-white/10 rounded animate-pulse w-4/5"></div>
                        </div>

                        {/* Loading buttons */}
                        <div className="mt-3 flex gap-2">
                          <div className="h-6 bg-white/10 rounded animate-pulse w-20"></div>
                          <div className="h-6 bg-white/10 rounded animate-pulse w-16"></div>
                          <div className="h-6 bg-white/10 rounded animate-pulse w-20"></div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              }
            })}
          </AnimatePresence>
        </div>

        {/* AgentMail Email Popup */}
        <AnimatePresence>
          {showEmailPopup && selected && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowEmailPopup(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-gray-900/95 border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold">📧 Send Email</h2>
                      <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span className="text-xs text-blue-300 font-medium">Powered by AgentMail</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => setShowEmailPopup(false)}
                      className="text-white/60 hover:text-white"
                    >
                      ✕
                    </Button>
                  </div>

                  {/* Email Routing Notice */}
                  <div className="bg-orange-500/20 border border-orange-500/30 rounded-lg p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <div className="text-orange-400 text-lg">🔧</div>
                      <div>
                        <div className="text-orange-200 font-medium text-sm">Development Mode</div>
                        <div className="text-orange-300/80 text-xs mt-1">
                          This email will be sent to <strong>linusaw@umich.edu</strong> with candidate details included.
                          Original recipient: <strong>{selected.name}</strong> ({selected.email})
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recipient Info */}
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <div className="text-sm text-white/60 mb-2">Sending to:</div>
                    <div className="flex items-start gap-3">
                      {selected.profilePhoto ? (
                        <img
                          src={selected.profilePhoto}
                          alt={selected.name}
                          className="w-10 h-10 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                          {selected.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="font-medium">{selected.name}</div>
                        <div className="text-sm text-white/80">{selected.title}</div>
                        <div className="text-xs text-green-300 mt-1">✉️ {selected.email}</div>
                        {selected.company && (
                          <div className="text-xs text-blue-300 mt-1">🏢 {selected.company}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email Content */}
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-3">
                    🤖 AI-Generated Email Message
                  </label>

                  {messageLoading ? (
                    <div className="bg-black/30 border border-white/10 rounded-lg p-6 min-h-[200px] flex items-center justify-center">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 border-2 border-blue-300/30 border-t-blue-300 rounded-full animate-spin"></div>
                        <div className="text-blue-200">
                          <div className="font-medium">Generating personalized email...</div>
                          <div className="text-sm text-blue-300/70 mt-1">
                            Creating compelling outreach based on candidate profile
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      className="w-full min-h-[200px] bg-black/30 border border-white/10 rounded-lg p-4 outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Your personalized email message will appear here..."
                    />
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    onClick={() => setShowEmailPopup(false)}
                    className="text-white/60 hover:text-white"
                  >
                    Cancel
                  </Button>

                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={copyToClipboard}
                      disabled={!draft || messageLoading}
                      className="min-w-[100px]"
                    >
                      📋 Copy
                    </Button>

                    <Button
                      onClick={() => sendEmailWithAgentMail(selected)}
                      disabled={!draft || messageLoading || emailSending}
                      className="min-w-[140px] bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500"
                    >
                      {emailSending ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Sending...
                        </div>
                      ) : (
                        <span className="flex items-center gap-2">
                          📧 Send Email
                        </span>
                      )}
                    </Button>
                  </div>
                </div>

                {/* AgentMail Features Notice */}
                <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-lg">
                  <div className="text-xs text-white/60">
                    <strong>AgentMail Features:</strong> Automatic reply detection • Smart conversation tracking • Meeting scheduling automation
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Message Drafting Popup */}
        <AnimatePresence>
          {showMessagePopup && selected && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowMessagePopup(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-gray-900/95 border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header with profile info */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Draft LinkedIn Message</h2>
                    <Button
                      variant="ghost"
                      onClick={() => setShowMessagePopup(false)}
                      className="text-white/60 hover:text-white"
                    >
                      ✕
                    </Button>
                  </div>

                  {/* Profile Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {/* Sender Profile */}
                    {senderProfile && (
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="text-sm text-white/60 mb-2">From:</div>
                        <div className="font-medium">{senderProfile.name}</div>
                        <div className="text-sm text-white/80">{senderProfile.headline}</div>
                        {senderProfile.company && (
                          <div className="text-xs text-blue-300 mt-1">@ {senderProfile.company}</div>
                        )}
                      </div>
                    )}

                    {/* Receiver Profile */}
                    <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                      <div className="text-sm text-white/60 mb-2">To:</div>
                      <div className="flex items-start gap-3">
                        {selected.profilePhoto ? (
                          <img
                            src={selected.profilePhoto}
                            alt={selected.name}
                            className="w-10 h-10 rounded-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
                            {selected.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="font-medium">{selected.name}</div>
                          <div className="text-sm text-white/80">
                            {selected.title}
                          </div>
                          {selected.location && (
                            <div className="text-xs text-white/60 mt-1">{selected.location}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Message Content */}
                <div className="mb-6">
                  <label className="block text-sm font-medium mb-3">
                    🤖 AI-Generated Personalized Message
                  </label>

                  {messageLoading ? (
                    <div className="bg-black/30 border border-white/10 rounded-lg p-6 min-h-[200px] flex items-center justify-center">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 border-2 border-blue-300/30 border-t-blue-300 rounded-full animate-spin"></div>
                        <div className="text-blue-200">
                          <div className="font-medium">Generating personalized message...</div>
                          <div className="text-sm text-blue-300/70 mt-1">
                            Using AI to find mutual connections and shared interests
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <textarea
                      className="w-full min-h-[200px] bg-black/30 border border-white/10 rounded-lg p-4 outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Your personalized message will appear here..."
                    />
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    onClick={() => setShowMessagePopup(false)}
                    className="text-white/60 hover:text-white"
                  >
                    Cancel
                  </Button>

                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      onClick={copyToClipboard}
                      disabled={!draft || messageLoading}
                      className="min-w-[100px]"
                    >
                      📋 Copy
                    </Button>

                    {selected.linkedinUrl && (
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(draft);
                          window.open(selected.linkedinUrl, '_blank');
                          setShowMessagePopup(false);
                        }}
                        disabled={!draft || messageLoading}
                        className="min-w-[140px] bg-[#0077B5] hover:bg-[#005885]"
                      >
                        🔗 Copy & Open LinkedIn
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </Container>
    </section>
  );
}
