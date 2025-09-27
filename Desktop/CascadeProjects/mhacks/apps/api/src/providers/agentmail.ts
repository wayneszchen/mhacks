type AgentMailConfig = { apiKey?: string };

type SendEmailArgs = {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  campaignId?: string;
};

export function createAgentMailProvider(config: AgentMailConfig) {
  const mock = !config.apiKey;

  async function sendEmail(args: SendEmailArgs) {
    if (mock) {
      return {
        status: 'queued',
        provider: 'mock',
        messageId: `mock-${Date.now()}`,
      };
    }

    // Real request sample (placeholder)
    // const res = await fetch('https://api.agentmail.ai/v1/send', {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Bearer ${config.apiKey}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify(args)
    // });
    // return res.json();

    return { status: 'error', message: 'Not implemented' };
  }

  return { sendEmail };
}
