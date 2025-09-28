# AgentMail Integration Setup Guide

## Overview
Your project now has full AgentMail integration implemented! All emails will be routed to your email address (`linusaw@umich.edu`) for testing purposes while maintaining full tracking of the original intended recipients.

## What's Been Implemented

✅ **Complete AgentMail Integration:**
- Database schema with email tracking tables
- AgentMail client library for sending/receiving emails
- Webhook handler for delivery events and replies
- Automated email agent with LLM processing
- Development mode email routing

## Setup Instructions

### 1. Environment Variables
Copy the `.env.example` to `.env` and configure:

```bash
cp apps/api/.env.example apps/api/.env
```

Required variables:
```env
# AgentMail API
AGENTMAIL_API_KEY=your_agentmail_api_key_here

# Development email routing (already configured for you)
DEV_EMAIL_ROUTING=true
DEV_EMAIL_ADDRESS=linusaw@umich.edu

# AI services (for LLM processing)
GOOGLE_AI_API_KEY=your_gemini_api_key_here

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/linkedin_messager
```

### 2. Database Setup
Start PostgreSQL and run migrations:

```bash
# Start PostgreSQL (if not running)
# On Ubuntu/WSL: sudo service postgresql start
# On macOS: brew services start postgresql

# Run database migration
cd apps/api
npx prisma migrate dev --name add-email-tables
npx prisma generate
```

### 3. AgentMail Configuration

1. **Sign up for AgentMail:** Visit https://agentmail.to
2. **Get API Key:** Create an account and get your API key
3. **Set up webhook:** Configure webhook URL in AgentMail dashboard:
   ```
   https://your-domain.com/webhooks/agentmail
   ```

### 4. Start the Application

```bash
# Install dependencies
npm install

# Start the API server
cd apps/api
npm run dev

# Start the frontend (in another terminal)
cd apps/web
npm run dev
```

## How Email Routing Works

### Development Mode (Current Configuration)
- **DEV_EMAIL_ROUTING=true**: All emails route to `linusaw@umich.edu`
- **Email Content:** Enhanced with original recipient information
- **Subject Line:** Prefixed with `[DEV]` and original recipient name
- **Database:** Stores original recipient for tracking

### Production Mode
- **DEV_EMAIL_ROUTING=false**: Emails sent to actual recipients
- **Email Content:** Clean, production-ready format
- **Subject Line:** Original subject without dev prefixes

## Email Flow

1. **Send Email:**
   ```
   POST /email/send
   {
     "candidateId": "123",
     "candidateName": "John Doe",
     "candidateEmail": "john@company.com",
     "subject": "Quick connect",
     "message": "Hi John, I'd love to connect...",
     "userId": "demo-user"
   }
   ```

2. **Email Processing:**
   - Creates AgentMail inbox (if needed)
   - Routes to `linusaw@umich.edu` with dev info
   - Stores thread and message records
   - Returns tracking information

3. **Inbound Handling:**
   - Webhooks receive replies automatically
   - LLM analyzes intent and sentiment
   - Automated responses based on content
   - State machine tracks conversation progress

## API Endpoints

- `POST /email/send` - Send email to candidate
- `GET /email/threads/:userId` - Get user's email threads
- `GET /email/threads/:threadId/messages` - Get thread messages
- `POST /email/threads/:threadId/pause` - Pause automated responses
- `POST /webhooks/agentmail` - AgentMail webhook handler

## Testing

1. **Send a test email:**
   ```bash
   curl -X POST http://localhost:4000/email/send \
     -H "Content-Type: application/json" \
     -d '{
       "candidateId": "test-123",
       "candidateName": "Test Candidate",
       "candidateEmail": "test@example.com",
       "subject": "Test Email",
       "message": "This is a test email to verify routing works!"
     }'
   ```

2. **Check your inbox** (`linusaw@umich.edu`) for the email
3. **Reply to the email** to test the automated response system

## Email Features

- **Smart Routing:** Development vs production modes
- **LLM Processing:** Gemini analyzes replies for intent
- **Automated Responses:** Context-aware replies until meeting scheduled
- **Compliance:** Unsubscribe links and CAN-SPAM compliance
- **Thread Tracking:** Full conversation history
- **State Management:** Tracks conversation progress

## Database Schema

The following tables handle email automation:

- `EmailProviderAccount` - User's AgentMail inbox configurations
- `EmailThread` - Email conversation threads with candidates
- `EmailMessage` - Individual messages in threads
- `WebhookEvent` - AgentMail webhook events for audit

## Security & Compliance

- Webhook signature verification (configure in AgentMail)
- Unsubscribe handling built-in
- Rate limiting on email sending
- Original recipient tracking for audit

## Next Steps

1. Get your AgentMail API key and configure the environment
2. Set up the database and run migrations
3. Configure webhook URL in AgentMail dashboard
4. Test the email flow with the API endpoint
5. Switch to production mode when ready (`DEV_EMAIL_ROUTING=false`)

The system is ready to use! All emails will come to your inbox with full context about the original intended recipient.