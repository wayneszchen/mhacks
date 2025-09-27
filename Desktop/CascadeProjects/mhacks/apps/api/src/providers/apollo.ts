
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

type ApolloConfig = { apiKey?: string };

export function createApolloProvider(config: ApolloConfig) {
  const mock = !config.apiKey;

  async function searchPeople(filters: SearchFilters): Promise<Candidate[]> {
    if (mock) {
      const company = filters.company || 'Amazon';
      const role = (filters.role || 'Engineer').toLowerCase();
      return [1, 2, 3, 4, 5].map((i) => ({
        id: `mock-${i}`,
        name: `Candidate ${i}`,
        title: role.includes('engineer') ? 'Software Engineer' : 'Product Manager',
        company,
        email: `candidate${i}@${company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        linkedinUrl: `https://www.linkedin.com/in/mock-${i}`,
        summary: `Experienced ${role} at ${company}.`,
        source: 'mock'
      }));
    }

    // Real implementation (example placeholder)
    // const res = await fetch('https://api.apollo.io/v1/people/search', { ... });
    // const json = await res.json();
    // return json.people.map(...);

    return [];
  }

  return { searchPeople };
}
