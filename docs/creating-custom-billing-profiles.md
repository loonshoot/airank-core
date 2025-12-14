# Creating Custom Billing Profiles for Demos and Enterprise Customers

This guide explains how to create billing profiles with custom pricing, including $0 demo accounts and invoice-based enterprise customers.

## Table of Contents

1. [Overview](#overview)
2. [Setup: Configure Stripe Webhook](#setup-configure-stripe-webhook)
3. [Creating a $0 Demo/Test Account](#creating-a-0-demotest-account)
4. [Creating an Invoice-Based Enterprise Account](#creating-an-invoice-based-enterprise-account)
5. [Attaching Workspaces to the Billing Profile](#attaching-workspaces-to-the-billing-profile)
6. [Managing Multiple Demo Workspaces](#managing-multiple-demo-workspaces)
7. [Troubleshooting](#troubleshooting)

---

## Overview

**When to use this guide:**
- Setting up internal demo environments
- Creating test accounts for QA or sales demonstrations
- Onboarding enterprise customers who pay via invoice instead of credit card
- Creating proof-of-concept accounts for potential customers

**What you'll need:**
- Admin access to Stripe Dashboard
- Access to the AIRank application (logged in as admin)
- 5-10 minutes

**How it works:**
1. Create a billing profile in the AIRank UI (this auto-creates a Stripe customer)
2. Find the customer in Stripe and attach a subscription directly in Stripe
3. Stripe webhooks automatically sync the subscription to AIRank
4. The billing profile is updated with the correct plan limits

---

## Setup: Configure Stripe Webhook

Before using the streamlined workflow, ensure the Stripe webhook is configured:

### One-Time Setup

1. **Get your webhook endpoint URL**
   - Production: `https://api.yourdomain.com/webhooks/internal/stripe`
   - Development: Use ngrok or similar to expose your local endpoint

2. **Configure webhook in Stripe**
   - Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks**
   - Click **"Add endpoint"**
   - Enter your endpoint URL
   - Select the following events:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
     - `invoice.payment_succeeded`
   - Click **"Add endpoint"**

3. **Copy the webhook signing secret**
   - After creating, click on the endpoint
   - Click **"Reveal"** under Signing secret
   - Copy the secret (starts with `whsec_`)

4. **Add to environment variables**
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
   ```

---

## Creating a $0 Demo/Test Account

### Step 1: Create a $0 Price in Stripe (One-Time)

If you haven't already created a $0 price for demos:

1. **Log in to Stripe Dashboard**
   - Go to [https://dashboard.stripe.com](https://dashboard.stripe.com)
   - Navigate to **Products** in the left sidebar

2. **Find the Enterprise Product**
   - Look for the product named "Enterprise" in your product list
   - Click on it to open the product details

3. **Add a New Price**
   - Click the **"Add another price"** button
   - Configure the new price:
     - **Price**: Enter `0` (or `0.00`)
     - **Billing period**: Select `Monthly`
     - **Price description** (optional): Enter "Demo/Internal - $0"
   - Click **"Add price"**

### Step 2: Create Billing Profile in AIRank

1. **Log in to AIRank**
   - Go to your AIRank application
   - Make sure you're logged in as an admin user

2. **Create a New Billing Profile**
   - Navigate to **Billing Settings** or **Billing Profiles**
   - Click **"Create New Billing Profile"**
   - Enter a name: `"Internal Demo Account"` or `"Test Environment"`
   - Click **"Create"**

### Step 3: Add Subscription in Stripe

1. **Find the Customer in Stripe**
   - Go to Stripe Dashboard → **Customers**
   - Search for the billing profile name you just created
   - Click on the customer to open their details

2. **Create Subscription**
   - In the customer view, click **"Create subscription"** or go to **Subscriptions** tab → **"+"**
   - Select the **Enterprise** product
   - Choose the **$0/month** price you created
   - Click **"Start subscription"**

3. **Automatic Sync**
   - The webhook will automatically fire
   - AIRank will receive the `customer.subscription.created` event
   - The billing profile will be updated with enterprise limits:
     - Plan: `enterprise`
     - Brands limit: `999999` (unlimited)
     - Prompts limit: `999999` (unlimited)

### Step 4: Verify the Setup

1. **Check in AIRank**
   - Go to **Billing Settings**
   - Find your billing profile
   - Verify it shows:
     - Plan: `Enterprise`
     - Status: `Active`

2. **Success!**
   - You now have a $0 enterprise billing profile
   - No GraphQL mutations needed
   - Everything synced automatically via webhook

---

## Creating an Invoice-Based Enterprise Account

For enterprise customers who pay via invoice instead of credit card:

### Step 1: Create Billing Profile in AIRank

1. **Create Profile with Customer Name**
   - Navigate to **Billing Settings** → **Create New Billing Profile**
   - Use the customer's company name: `"Acme Corp - Enterprise"`
   - Click **"Create"**

### Step 2: Set Up Subscription in Stripe

1. **Find the Customer in Stripe**
   - Go to Stripe Dashboard → **Customers**
   - Search for the company name

2. **Create Invoice-Based Subscription**
   - Click **"Create subscription"**
   - Select the **Enterprise** product
   - Choose or create a price with the negotiated amount (e.g., `$999/month`)
   - Under **Payment**, select **"Email invoice to the customer"**
   - Set **Days until due**: `30` (or your preferred terms)
   - Click **"Start subscription"**

3. **Automatic Sync**
   - The webhook syncs the subscription to AIRank
   - The billing profile gets enterprise limits
   - Stripe will email invoices automatically

### Benefits of This Approach

- Subscription shows correct MRR/ARR in Stripe
- Invoices are generated and sent automatically
- AIRank billing profile stays in sync
- No manual intervention needed after setup

---

## Attaching Workspaces to the Billing Profile

Once you have a billing profile set up, you can attach workspaces to it.

### Option 1: Attach Existing Workspace

1. **In AIRank Application**
   - Navigate to the workspace settings
   - Go to **Billing** tab
   - Click **"Change Billing Profile"**
   - Select your demo/enterprise billing profile from the dropdown
   - Click **"Attach"**

2. **Verify the Attachment**
   - Workspace should now show:
     - Plan: `Enterprise`
     - Features: All enterprise features unlocked
     - Limits: Unlimited brands, prompts, models

### Option 2: Create New Workspace with Billing Profile

1. **Create Workspace**
   - Click **"Create New Workspace"**
   - Enter workspace details (name, slug, etc.)
   - In the billing section, select your billing profile
   - Click **"Create"**

---

## Managing Multiple Demo Workspaces

You can attach multiple demo workspaces to a single billing profile for organized demos.

### Example: Setting Up 5 Industry Demo Workspaces

1. **Create the Billing Profile Once** (follow steps above)
   - Name: `"Internal Demo Account"`
   - Subscribe to $0 Enterprise plan in Stripe

2. **Create 5 Separate Workspaces**
   - Workspace 1: `"Demo - Retail Banking AU"` → attach to billing profile
   - Workspace 2: `"Demo - Supermarkets AU"` → attach to billing profile
   - Workspace 3: `"Demo - Telecom AU"` → attach to billing profile
   - Workspace 4: `"Demo - Athletic Footwear US"` → attach to billing profile
   - Workspace 5: `"Demo - Streaming Services US"` → attach to billing profile

3. **Benefits of This Approach**
   - All workspaces share the same $0 billing
   - Easy to manage - only one billing profile to maintain
   - Each workspace has its own data, brands, prompts, results
   - Can be shown to different prospects based on industry

### Sharing Demo Accounts with Team Members

1. **Add Team Members to Billing Profile**
   - In billing profile settings, go to **Members**
   - Click **"Add Member"**
   - Enter their email
   - Set role to `Viewer` (can see workspaces but not modify billing)
   - Click **"Invite"**

2. **Add Team Members to Individual Workspaces**
   - In each workspace, go to **Team**
   - Add members with appropriate roles (Admin, Editor, Viewer)
   - They'll automatically inherit the enterprise features

---

## Troubleshooting

### Webhook Not Syncing

**Problem**: Created subscription in Stripe but billing profile not updating.

**Solution**:
1. Check webhook endpoint is configured correctly in Stripe
2. Verify `STRIPE_WEBHOOK_SECRET` environment variable is set
3. Check application logs for webhook errors
4. In Stripe → Webhooks, check the endpoint for failed deliveries

### "Customer not found" in Stripe

**Problem**: Can't find the billing profile customer in Stripe.

**Solution**:
- The customer is created with the billing profile name
- Search for the exact name you used when creating the billing profile
- Check the billing profile in AIRank for the `stripeCustomerId` field

### Subscription Status Shows "Incomplete"

**Problem**: Subscription created but shows `incomplete` status.

**Solution**:
- For $0 subscriptions, this should auto-resolve in a few seconds
- For paid subscriptions without payment method, the customer needs to pay
- Check the subscription in Stripe for more details

### Plan Limits Not Updating

**Problem**: Webhook fired but limits didn't change.

**Solution**:
1. Check that the Stripe product has correct metadata:
   - `plan_id`: `enterprise` (or `small`, `medium`, etc.)
   - `brands_limit`: `unlimited` or a number
   - `prompts_limit`: `unlimited` or a number
   - `models_limit`: `unlimited` or a number
   - `allowed_models`: `*` or comma-separated list
2. Run `scripts/setup-stripe-products.js` to reset product metadata

### Webhook Signature Verification Failed

**Problem**: Logs show "Webhook signature verification failed".

**Solution**:
- Verify `STRIPE_WEBHOOK_SECRET` matches the secret in Stripe dashboard
- Make sure you're using the correct endpoint's signing secret
- Check that the raw request body is being passed (not parsed JSON)

---

## Summary Checklist

### For $0 Demo Accounts:
- [ ] Stripe webhook configured (one-time setup)
- [ ] Created $0 price in Stripe for Enterprise product (one-time)
- [ ] Created billing profile in AIRank UI
- [ ] Found customer in Stripe and created $0 subscription
- [ ] Verified webhook synced the plan automatically
- [ ] Attached workspace(s) to billing profile

### For Invoice-Based Enterprise:
- [ ] Stripe webhook configured (one-time setup)
- [ ] Created billing profile with customer name in AIRank UI
- [ ] Found customer in Stripe
- [ ] Created subscription with invoice payment method
- [ ] Verified webhook synced the plan automatically
- [ ] Attached customer workspace to billing profile

---

## Technical Details

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `customer.subscription.created` | Syncs plan limits from Stripe product metadata |
| `customer.subscription.updated` | Updates plan limits when subscription changes |
| `customer.subscription.deleted` | Resets billing profile to free tier |
| `invoice.payment_failed` | Sets 30-day grace period |
| `invoice.payment_succeeded` | Clears payment failure flags |

### Plan Metadata Structure

Stripe products should have these metadata fields:

```json
{
  "plan_id": "enterprise",
  "brands_limit": "unlimited",
  "prompts_limit": "unlimited",
  "models_limit": "unlimited",
  "data_retention_days": "unlimited",
  "allowed_models": "*",
  "batch_frequency": "custom",
  "prompt_character_limit": "150"
}
```

---

## Need Help?

If you encounter any issues not covered in this guide:

1. Check the backend logs for error messages
2. Check Stripe webhook delivery logs
3. Contact your technical team with:
   - The exact error message
   - The billing profile ID
   - The Stripe customer ID
   - Screenshots of the issue

---

**Last Updated**: 2025-12-14
**Version**: 2.0 (Webhook-based sync)
