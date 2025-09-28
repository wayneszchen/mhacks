const API_KEY = 'am_cb2529d13ffd14b569142695a99ce51d3086e435966310336c39d2a68efc79b3';
const BASE_URL = 'https://api.agentmail.to/v0';

async function testAgentMail() {
  console.log('🧪 Testing AgentMail API...');

  try {
    // 1. Test getting existing inboxes
    console.log('\n1. Getting existing inboxes...');
    const inboxesResponse = await fetch(`${BASE_URL}/inboxes`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!inboxesResponse.ok) {
      console.error('❌ Failed to get inboxes:', inboxesResponse.status, await inboxesResponse.text());
      return;
    }

    const inboxesData = await inboxesResponse.json();
    console.log('✅ Inboxes response:', JSON.stringify(inboxesData, null, 2));

    // 2. Create a new inbox if none exist or use existing
    let inboxId;
    if (inboxesData.inboxes && inboxesData.inboxes.length > 0) {
      inboxId = inboxesData.inboxes[0].inbox_id;
      console.log(`\n2. Using existing inbox: ${inboxId}`);
    } else {
      console.log('\n2. Creating new inbox...');
      const createResponse = await fetch(`${BASE_URL}/inboxes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'test-' + Date.now(),
          display_name: 'Test Inbox'
        })
      });

      if (!createResponse.ok) {
        console.error('❌ Failed to create inbox:', createResponse.status, await createResponse.text());
        return;
      }

      const createData = await createResponse.json();
      inboxId = createData.inbox_id;
      console.log('✅ Created inbox:', JSON.stringify(createData, null, 2));
    }

    // 3. Test sending an email
    console.log(`\n3. Testing email send to inbox ${inboxId}...`);
    const emailResponse = await fetch(`${BASE_URL}/inboxes/${inboxId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: 'linusaw@umich.edu',
        subject: 'AgentMail Test Email',
        html: '<p>This is a test email from AgentMail API</p>',
        text: 'This is a test email from AgentMail API'
      })
    });

    console.log('📧 Email send response status:', emailResponse.status);
    const emailData = await emailResponse.text();
    console.log('📧 Email send response:', emailData);

    if (!emailResponse.ok) {
      console.error('❌ Failed to send email');
    } else {
      console.log('✅ Email sent successfully!');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

testAgentMail();