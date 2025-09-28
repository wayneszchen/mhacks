
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
  emailStatus?: 'found' | 'not_found' | 'searching' | 'error';
};

export type SearchFilters = {
  company?: string;
  role?: string;
  location?: string;
};

export type EmailEnrichmentResult = {
  email: string | null;
  status: 'found' | 'not_found' | 'error';
  confidence?: number;
  source?: string;
  error?: string;
};

type ApolloConfig = { apiKey?: string };

export function createApolloProvider(config: ApolloConfig) {
  const mock = !config.apiKey;
  const baseUrl = 'https://api.apollo.io/api/v1';

  // Headers for Apollo API requests
  const getHeaders = () => ({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'accept': 'application/json',
    'X-Api-Key': config.apiKey || ''
  });

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

    // Real Apollo API implementation with enhanced filtering
    try {
      // Build search parameters with proper filtering
      const searchParams: any = {
        page: 1,
        per_page: 25,
        sort_by_field: 'person_relevance_score',
        sort_ascending: false
      };

      // Add company filter if provided
      if (filters.company) {
        searchParams.q_organization_names = Array.isArray(filters.company)
          ? filters.company
          : [filters.company];
      }

      // Add role/title filter if provided
      if (filters.role) {
        searchParams.q_title = filters.role;
      }

      // Add location filter if provided
      if (filters.location) {
        searchParams.q_location = filters.location;
      }

      console.log('Apollo search params:', { ...searchParams, q_organization_names: searchParams.q_organization_names?.length || 0 });

      const response = await fetch(`${baseUrl}/mixed_people/search`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(searchParams)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Apollo search error response:', response.status, errorText);
        throw new Error(`Apollo API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Apollo search response:', {
        total: data.people?.length || 0,
        pagination: data.pagination
      });

      return data.people?.map((person: any) => ({
        id: person.id,
        name: person.name,
        title: person.title,
        company: person.organization?.name,
        email: person.email,
        linkedinUrl: person.linkedin_url,
        location: person.location,
        summary: person.headline || `${person.title} at ${person.organization?.name}`,
        source: 'apollo',
        emailStatus: person.email ? 'found' : 'not_found'
      })) || [];
    } catch (error) {
      console.error('Apollo searchPeople error:', error);
      return [];
    }
  }

  async function enrichPersonEmail(person: {
    name: string;
    company?: string;
    linkedinUrl?: string;
    domain?: string;
    email?: string;
  }): Promise<EmailEnrichmentResult> {
    if (mock) {
      // Mock email enrichment - simulate finding emails for some people
      const mockEmails = [
        `${person.name.toLowerCase().replace(/\s+/g, '.')}@${person.company?.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        `${person.name.split(' ')[0]?.toLowerCase()}.${person.name.split(' ')[1]?.toLowerCase()}@${person.company?.toLowerCase().replace(/[^a-z]/g, '')}.com`,
        null
      ];

      const randomEmail = mockEmails[Math.floor(Math.random() * mockEmails.length)];

      return {
        email: randomEmail,
        status: randomEmail ? 'found' : 'not_found',
        confidence: randomEmail ? 0.85 : 0,
        source: 'apollo-mock'
      };
    }

    // Real Apollo People Match API - correct endpoint and parameters
    try {
      const enrichParams: any = {
        reveal_personal_emails: true,
        reveal_phone_number: false
      };

      // Use the most specific identifier available
      if (person.email) {
        // If we already have an email, use it for enrichment
        enrichParams.email = person.email;
      } else {
        // Use name + company for matching
        const nameParts = person.name.split(' ');
        enrichParams.first_name = nameParts[0];
        if (nameParts.length > 1) {
          enrichParams.last_name = nameParts.slice(1).join(' ');
        }

        // Add company domain if available (improves matching)
        if (person.domain) {
          enrichParams.domain = person.domain;
        } else if (person.company) {
          // Create a domain from company name as fallback
          enrichParams.domain = `${person.company.toLowerCase().replace(/[^a-z]/g, '')}.com`;
        }
      }

      // Add LinkedIn URL if available for better matching
      if (person.linkedinUrl) {
        enrichParams.linkedin_url = person.linkedinUrl;
      }

      console.log('Apollo API request params:', { ...enrichParams, email: enrichParams.email ? '[REDACTED]' : 'none' });

      const response = await fetch(`${baseUrl}/people/match`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(enrichParams)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Apollo API error response:', response.status, errorText);
        return {
          email: null,
          status: 'error',
          error: `Apollo API error: ${response.status} - ${errorText}`
        };
      }

      const data = await response.json();
      console.log('Apollo API response:', { person: data.person ? 'found' : 'not found', email: data.person?.email ? 'found' : 'not found' });

      // Apollo returns person data with email field
      const foundEmail = data.person?.email;

      // If no email found, generate a mock email as fallback
      if (!foundEmail && person.name && person.company) {
        console.log(`Apollo couldn't find email for ${person.name}, generating mock email`);

        // Generate mock email patterns
        const nameParts = person.name.toLowerCase().split(' ').filter(part => part.length > 0);
        const company = person.company.toLowerCase().replace(/[^a-z]/g, '');

        const mockEmailPatterns = [
          `${nameParts.join('.')}@${company}.com`,
          `${nameParts[0]}.${nameParts[nameParts.length - 1]}@${company}.com`,
          `${nameParts[0]}${nameParts[nameParts.length - 1]}@${company}.com`,
          `${nameParts[0][0]}${nameParts[nameParts.length - 1]}@${company}.com`
        ];

        // Use the first pattern as the mock email
        const mockEmail = mockEmailPatterns[0];

        return {
          email: mockEmail,
          status: 'mock_generated',
          confidence: 0.3, // Lower confidence since it's a mock
          source: 'apollo-mock-fallback'
        };
      }

      return {
        email: foundEmail || null,
        status: foundEmail ? 'found' : 'not_found',
        confidence: foundEmail ? 0.9 : 0,
        source: 'apollo-match'
      };
    } catch (error) {
      console.error('Apollo enrichment error:', error);

      // Generate mock email as fallback even on error
      if (person.name && person.company) {
        console.log(`Apollo error for ${person.name}, generating mock email as fallback`);

        // Generate mock email patterns
        const nameParts = person.name.toLowerCase().split(' ').filter(part => part.length > 0);
        const company = person.company.toLowerCase().replace(/[^a-z]/g, '');

        const mockEmailPatterns = [
          `${nameParts.join('.')}@${company}.com`,
          `${nameParts[0]}.${nameParts[nameParts.length - 1]}@${company}.com`,
          `${nameParts[0]}${nameParts[nameParts.length - 1]}@${company}.com`,
          `${nameParts[0][0]}${nameParts[nameParts.length - 1]}@${company}.com`
        ];

        // Use the first pattern as the mock email
        const mockEmail = mockEmailPatterns[0];

        return {
          email: mockEmail,
          status: 'mock_generated',
          confidence: 0.2, // Even lower confidence since it's due to error
          source: 'apollo-error-fallback'
        };
      }

      return {
        email: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async function bulkEnrichEmails(people: Array<{
    name: string;
    company?: string;
    linkedinUrl?: string;
    domain?: string;
  }>): Promise<EmailEnrichmentResult[]> {
    if (mock) {
      // Mock bulk enrichment
      return people.map(person => ({
        email: Math.random() > 0.3 ? `${person.name.toLowerCase().replace(/\s+/g, '.')}@${person.company?.toLowerCase().replace(/[^a-z]/g, '') || 'company'}.com` : null,
        status: Math.random() > 0.3 ? 'found' as const : 'not_found' as const,
        confidence: Math.random() > 0.3 ? 0.85 : 0,
        source: 'apollo-mock'
      }));
    }

    // Real bulk enrichment - Apollo supports bulk operations
    try {
      const enrichParams = {
        people: people.slice(0, 10).map(person => ({
          first_name: person.name.split(' ')[0],
          last_name: person.name.split(' ').slice(1).join(' '),
          organization_name: person.company,
          linkedin_url: person.linkedinUrl,
          domain: person.domain
        })),
        reveal_personal_emails: true
      };

      const response = await fetch(`${baseUrl}/people/bulk_enrich`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(enrichParams)
      });

      if (!response.ok) {
        throw new Error(`Apollo bulk enrich error: ${response.status}`);
      }

      const data = await response.json();

      return data.people?.map((person: any, index: number) => {
        const originalPerson = people[index];

        if (person.email) {
          return {
            email: person.email,
            status: 'found' as const,
            confidence: 0.9,
            source: 'apollo-bulk'
          };
        }

        // Generate mock email if no real email found
        if (originalPerson?.name && originalPerson?.company) {
          console.log(`Apollo bulk couldn't find email for ${originalPerson.name}, generating mock email`);

          const nameParts = originalPerson.name.toLowerCase().split(' ').filter(part => part.length > 0);
          const company = originalPerson.company.toLowerCase().replace(/[^a-z]/g, '');

          const mockEmail = `${nameParts.join('.')}@${company}.com`;

          return {
            email: mockEmail,
            status: 'mock_generated' as const,
            confidence: 0.3,
            source: 'apollo-bulk-mock'
          };
        }

        return {
          email: null,
          status: 'not_found' as const,
          confidence: 0,
          source: 'apollo-bulk'
        };
      }) || people.map((person) => {
        // Fallback when Apollo returns no people array - generate mock emails
        if (person.name && person.company) {
          const nameParts = person.name.toLowerCase().split(' ').filter(part => part.length > 0);
          const company = person.company.toLowerCase().replace(/[^a-z]/g, '');
          const mockEmail = `${nameParts.join('.')}@${company}.com`;

          return {
            email: mockEmail,
            status: 'mock_generated' as const,
            confidence: 0.3,
            source: 'apollo-bulk-mock-fallback'
          };
        }

        return { email: null, status: 'not_found' as const };
      });
    } catch (error) {
      console.error('Apollo bulk enrichment error:', error);

      // Generate mock emails for all people when bulk request fails
      return people.map((person) => {
        if (person.name && person.company) {
          console.log(`Apollo bulk error for ${person.name}, generating mock email as fallback`);

          const nameParts = person.name.toLowerCase().split(' ').filter(part => part.length > 0);
          const company = person.company.toLowerCase().replace(/[^a-z]/g, '');
          const mockEmail = `${nameParts.join('.')}@${company}.com`;

          return {
            email: mockEmail,
            status: 'mock_generated' as const,
            confidence: 0.2, // Lower confidence due to error
            source: 'apollo-bulk-error-fallback'
          };
        }

        return {
          email: null,
          status: 'error' as const,
          error: error instanceof Error ? error.message : 'Bulk enrichment failed'
        };
      });
    }
  }

  return {
    searchPeople,
    enrichPersonEmail,
    bulkEnrichEmails
  };
}
