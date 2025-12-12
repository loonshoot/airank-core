// airank-core/lib/email.js
const postmark = require('postmark');

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;

// Postmark client - initialized lazily
let client = null;

const getClient = () => {
  if (!client && process.env.POSTMARK_SERVER_TOKEN) {
    client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
  }
  return client;
};

// Common template model values
const getCommonTemplateModel = () => ({
  product_name: 'AI Rank',
  product_url: process.env.APP_URL || 'https://airank.com',
  company_name: 'AI Rank',
  company_address: '',
  current_year: new Date().getFullYear().toString(),
  support_email: 'support@airank.com',
  help_url: 'https://docs.airank.com',
});

/**
 * Send Workspace Invitation email
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.name - Recipient name (optional)
 * @param {string} params.inviterName - Name of the person who sent the invitation
 * @param {string} params.inviterEmail - Email of the person who sent the invitation
 * @param {string} params.workspaceName - Name of the workspace
 */
const sendWorkspaceInvitationEmail = async ({ to, name, inviterName, inviterEmail, workspaceName }) => {
  const templateModel = {
    ...getCommonTemplateModel(),
    name: name || to.split('@')[0],
    inviter_name: inviterName || inviterEmail || 'A team member',
    workspace_name: workspaceName,
    action_url: `${process.env.APP_URL || 'https://airank.com'}/account`,
  };

  if (isDevelopment) {
    console.log('\n========== WORKSPACE INVITATION EMAIL (DEV) ==========');
    console.log('To:', to);
    console.log('Template: airank-workspace-invitation');
    console.log('Inviter:', inviterName || inviterEmail);
    console.log('Workspace:', workspaceName);
    console.log('Action URL:', templateModel.action_url);
    console.log('Template Model:', JSON.stringify(templateModel, null, 2));
    console.log('=======================================================\n');
    return { success: true, dev: true };
  }

  const postmarkClient = getClient();
  if (!postmarkClient) {
    console.error('Postmark client not configured - POSTMARK_SERVER_TOKEN missing');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    const result = await postmarkClient.sendEmailWithTemplate({
      From: process.env.EMAIL_FROM || 'noreply@airank.com',
      To: to,
      TemplateAlias: 'airank-workspace-invitation',
      TemplateModel: templateModel,
    });
    console.log('Workspace invitation email sent to:', to);
    return { success: true, messageId: result.MessageID };
  } catch (error) {
    console.error('Failed to send workspace invitation email:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendWorkspaceInvitationEmail,
  getCommonTemplateModel,
};
