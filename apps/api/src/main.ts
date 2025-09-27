import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
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
  const { prompt } = (req.body as any) || {};
  // parse a trivial filter from prompt
  const companyMatch = /at\s+([A-Za-z0-9\-\.& ]+)/i.exec(prompt || '')?.[1]?.trim();
  const roleMatch = /(SWE|engineer|software|product|data)/i.test(prompt || '') ? 'engineer' : undefined;

  const candidates = await apollo.searchPeople({ company: companyMatch, role: roleMatch });
  const scored = scoreCandidates({
    user: { schools: [], companies: [], skills: [], summary: '' },
    intent: prompt || '',
    candidates
  });

  reply.send({ results: scored });
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
