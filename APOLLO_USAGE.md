# Apollo API Pipeline Usage

## Complete Pipeline Endpoint

**POST** `/apollo/pipeline`

This endpoint provides a complete Apollo pipeline that:
1. Searches for people by company and role
2. Enriches emails for candidates who don't have them
3. Posts results to your website via webhook

### Request Body
```json
{
  "company": "OpenAI",
  "role": "Software Engineer",
  "location": "San Francisco", // optional
  "maxResults": 10 // optional, defaults to 10
}
```

### Response
```json
{
  "success": true,
  "results": [
    {
      "id": "person_123",
      "name": "John Doe",
      "title": "Senior Software Engineer",
      "company": "OpenAI",
      "email": "john.doe@openai.com",
      "linkedinUrl": "https://linkedin.com/in/johndoe",
      "location": "San Francisco, CA",
      "source": "apollo",
      "emailStatus": "found"
    }
  ],
  "stats": {
    "searched": 25,
    "needingEnrichment": 15,
    "enriched": 8,
    "finalWithEmails": 18,
    "posted": 18
  },
  "webhook": {
    "status": "success",
    "count": 18
  }
}
```

## Individual Endpoints

### Search People
**POST** `/search/run` - Uses LinkedIn + Apollo (requires LinkedIn auth)

### Email Enrichment Only
**POST** `/email/enrich` - Bulk email enrichment
**POST** `/email/enrich/single` - Single person email enrichment

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add your Apollo API key:
   ```
   APOLLO_API_KEY=your_apollo_api_key_here
   ```
3. Configure webhook (optional):
   ```
   WEBHOOK_URL=https://your-website.com/api/candidates
   WEBHOOK_AUTH=Bearer your_auth_token_here
   ```

## Example Usage

```bash
# Complete pipeline
curl -X POST http://localhost:4000/apollo/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "company": "Google",
    "role": "Product Manager",
    "location": "Seattle",
    "maxResults": 15
  }'

# Email enrichment only
curl -X POST http://localhost:4000/email/enrich/single \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "company": "Microsoft",
    "linkedinUrl": "https://linkedin.com/in/janesmith"
  }'
```

## Webhook Format

When `WEBHOOK_URL` is configured, successful results are POST'd in this format:

```json
{
  "query": {
    "company": "OpenAI",
    "role": "Software Engineer",
    "location": "San Francisco"
  },
  "candidates": [...],
  "timestamp": "2025-01-15T10:30:00.000Z",
  "source": "apollo-pipeline"
}
```