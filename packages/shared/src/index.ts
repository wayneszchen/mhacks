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
  emailStatus?: 'found' | 'not_found' | 'searching' | 'error' | 'mock_generated';
  score?: number;
  schools?: string;
  skills?: string;
  experience?: string;
  profilePhoto?: string;
};

export type SearchFilters = {
  company?: string;
  role?: string;
  location?: string;
};
