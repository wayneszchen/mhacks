import fetch from 'node-fetch';

const BASE_URL = "https://api.agentmail.to/v0";

export interface AgentMailInbox {
  inbox_id: string;
  display_name?: string;
  organization_id?: string;
  pod_id?: string;
  created_at: string;
  updated_at?: string;
}

export interface AgentMailMessage {
  id: string;
  thread_id: string;
  inbox_id: string;
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  created_at: string;
  status?: string;
}

export interface AgentMailThread {
  id: string;
  inbox_id: string;
  subject: string;
  participants: string[];
  message_count: number;
  last_message_at: string;
  created_at: string;
}

async function amFetch(path: string, init: RequestInit = {}) {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('AGENTMAIL_API_KEY environment variable is required');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AgentMail API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

export class AgentMailClient {
  // Inbox Management
  async createInbox(username?: string, displayName?: string): Promise<AgentMailInbox> {
    console.log(`Creating AgentMail inbox: ${username || 'auto-generated'}`);

    const body: any = {};
    if (username) body.username = username;
    if (displayName) body.display_name = displayName;

    const inbox = await amFetch('/inboxes', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    console.log(`✅ Created AgentMail inbox: ${inbox.inbox_id}`, inbox);
    return inbox;
  }

  async getInboxes(): Promise<AgentMailInbox[]> {
    const response = await amFetch('/inboxes');
    // AgentMail returns { count: number, inboxes: AgentMailInbox[] }
    return response.inboxes || [];
  }

  async getInbox(inboxId: string): Promise<AgentMailInbox> {
    return await amFetch(`/inboxes/${inboxId}`);
  }

  // Message Sending
  async sendEmail(inboxId: string, to: string, subject: string, html: string, text?: string): Promise<AgentMailMessage> {
    console.log(`📧 Sending email from inbox ${inboxId} to ${to}`);

    // URL encode the inbox ID to handle @ symbols
    const encodedInboxId = encodeURIComponent(inboxId);
    const message = await amFetch(`/inboxes/${encodedInboxId}/messages/send`, {
      method: 'POST',
      body: JSON.stringify({
        to,
        subject,
        html,
        text: text || this.htmlToText(html)
      })
    });

    console.log(`✅ Email sent successfully: ${message.message_id}`);
    return {
      id: message.message_id,
      thread_id: message.thread_id,
      inbox_id: inboxId,
      from: '', // Will be filled by AgentMail
      to: [to],
      subject,
      html,
      text: text || this.htmlToText(html),
      created_at: new Date().toISOString(),
      status: 'sent'
    };
  }

  async sendReply(inboxId: string, threadId: string, html: string, text?: string): Promise<AgentMailMessage> {
    console.log(`📧 Sending reply in thread ${threadId}`);

    const message = await amFetch(`/inboxes/${inboxId}/threads/${threadId}/reply`, {
      method: 'POST',
      body: JSON.stringify({
        html,
        text: text || this.htmlToText(html)
      })
    });

    console.log(`✅ Reply sent successfully: ${message.id}`);
    return message;
  }

  // Message and Thread Retrieval
  async getMessage(inboxId: string, messageId: string): Promise<AgentMailMessage> {
    return await amFetch(`/inboxes/${inboxId}/messages/${messageId}`);
  }

  async getMessageRaw(inboxId: string, messageId: string): Promise<string> {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    const response = await fetch(`${BASE_URL}/inboxes/${inboxId}/messages/${messageId}/raw`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get raw message: ${response.status}`);
    }

    return await response.text();
  }

  async getThread(inboxId: string, threadId: string): Promise<AgentMailThread> {
    return await amFetch(`/inboxes/${inboxId}/threads/${threadId}`);
  }

  async getThreadMessages(inboxId: string, threadId: string): Promise<AgentMailMessage[]> {
    const response = await amFetch(`/inboxes/${inboxId}/threads/${threadId}/messages`);
    return response.messages || response;
  }

  // Utility Methods
  private htmlToText(html: string): string {
    // Simple HTML to text conversion - strip tags and decode entities
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  // Generate unsubscribe footer for compliance
  generateUnsubscribeFooter(recipientEmail: string, listId?: string): string {
    const unsubscribeUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/unsubscribe?email=${encodeURIComponent(recipientEmail)}${listId ? `&list=${listId}` : ''}`;

    return `
      <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e5e5e5;">
      <div style="font-size: 12px; color: #666; text-align: center;">
        <p>This email was sent by an automated system. If you no longer wish to receive these emails,
        <a href="${unsubscribeUrl}" style="color: #666;">click here to unsubscribe</a>.</p>
        <p>You can also reply with "STOP" or "UNSUBSCRIBE" to be removed from future messages.</p>
      </div>
    `;
  }

  // Format email HTML with proper styling
  formatEmailHtml(content: string, recipientName?: string, senderName?: string, includeUnsubscribe = true, recipientEmail?: string): string {
    const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,';
    const signature = senderName ? `\n\nBest regards,\n${senderName}` : '';
    const unsubscribeFooter = includeUnsubscribe && recipientEmail ? this.generateUnsubscribeFooter(recipientEmail) : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
          .message-content { margin: 1rem 0; }
          .signature { margin-top: 2rem; }
          .unsubscribe { margin-top: 3rem; border-top: 1px solid #eee; padding-top: 1rem; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="message-content">
          <p>${greeting}</p>
          ${content.split('\n').map(line => `<p>${line}</p>`).join('')}
          <div class="signature">${signature}</div>
        </div>
        ${unsubscribeFooter ? `<div class="unsubscribe">${unsubscribeFooter}</div>` : ''}
      </body>
      </html>
    `;
  }
}

// Export singleton instance
export const agentMail = new AgentMailClient();

// Helper function to ensure inbox exists for a user
export async function ensureUserInbox(userId: string, userEmail: string, userName?: string): Promise<AgentMailInbox> {
  // This would typically check your database first to see if user already has an inbox
  // For now, we'll create a new one each time - you'll want to add DB persistence

  const username = userEmail.split('@')[0] + '-' + userId.substring(0, 8);
  const displayName = userName || 'Automated Outreach';

  return await agentMail.createInbox(username, displayName);
}