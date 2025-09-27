import fetch from 'node-fetch';
import { Candidate, SearchFilters } from '@linkedin-messager/shared';

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

    // Real implementation example (pseudo)
    // const res = await fetch('https://api.apollo.io/v1/people/match', { ... });
    // return await res.json();

    return [];
  }

  return { searchPeople };
}
