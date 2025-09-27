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
};

export type SearchFilters = {
  company?: string;
  role?: string;
  location?: string;
};
