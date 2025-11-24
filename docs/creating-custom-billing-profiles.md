# Creating Custom Billing Profiles for Demos and Enterprise Customers

This guide explains how to create billing profiles with custom pricing, including $0 demo accounts and invoice-based enterprise customers.

## Table of Contents

1. [Overview](#overview)
2. [Creating a $0 Demo/Test Account](#creating-a-0-demotest-account)
3. [Creating an Invoice-Based Enterprise Account](#creating-an-invoice-based-enterprise-account)
4. [Attaching Workspaces to the Billing Profile](#attaching-workspaces-to-the-billing-profile)
5. [Managing Multiple Demo Workspaces](#managing-multiple-demo-workspaces)
6. [Troubleshooting](#troubleshooting)

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
- 10-15 minutes

---

## Creating a $0 Demo/Test Account

### Step 1: Create the $0 Price in Stripe

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
     - **Billing period**: Select `Monthly` (or `One-time` if preferred)
     - **Price description** (optional): Enter "Demo/Internal - $0" to identify it easily
   - Click **"Add price"**

4. **Copy the Price ID**
   - After creating, you'll see the new price in the list
   - The Price ID looks like: `price_1ABC123xyz456DEF789`
   - **Copy this ID** - you'll need it in Step 2
   - You can also note the API ID from the right sidebar when clicking on the price

### Step 2: Create the Billing Profile in AIRank

1. **Log in to AIRank**
   - Go to your AIRank application
   - Make sure you're logged in as an admin user

2. **Create a New Billing Profile**
   - Navigate to **Billing Settings** or **Billing Profiles**
   - Click **"Create New Billing Profile"**
   - Enter a name: `"Internal Demo Account"` or `"Test Environment"`
   - Click **"Create"**
   - **Note the Billing Profile ID** shown after creation (you'll need this for Step 3)

### Step 3: Subscribe the Billing Profile to the $0 Enterprise Plan

You'll need to use the GraphQL API for this step. Don't worry - just follow these exact steps:

1. **Open the GraphQL Playground**
   - In your browser, go to: `https://your-airank-domain.com/graphql`
   - (Replace `your-airank-domain.com` with your actual domain)

2. **Run the Subscription Mutation**
   - Copy and paste this query into the left panel:

   ```graphql
   mutation CreateDemoSubscription {
     createSubscription(
       billingProfileId: "YOUR_BILLING_PROFILE_ID"
       planId: "enterprise"
       interval: "monthly"
     ) {
       billingProfile {
         _id
         name
         currentPlan
         brandsLimit
         promptsLimit
       }
       stripeSubscriptionId
     }
   }
   ```

3. **Replace the Placeholder**
   - Find `YOUR_BILLING_PROFILE_ID` in the query
   - Replace it with the Billing Profile ID from Step 2
   - Example: `"675a1b2c3d4e5f6g7h8i9j0k"`

4. **Execute the Query**
   - Click the **Play button** ▶️ in the middle
   - You should see a success response showing:
     - Current plan: `"enterprise"`
     - Brands limit: `999999` (unlimited)
     - Prompts limit: `999999` (unlimited)

5. **Verify in Stripe** (Optional)
   - Go back to Stripe Dashboard → **Subscriptions**
   - You should see a new subscription with:
     - Status: `Active`
     - Amount: `$0.00/month`

### Step 4: Verify the Setup

1. **Check the Billing Profile**
   - In AIRank, go to **Billing Settings**
   - Find your newly created billing profile
   - Verify it shows:
     - Plan: `Enterprise`
     - Status: `Active`
     - No payment method required ✓

2. **Success!**
   - You now have a $0 enterprise billing profile
   - It will NOT charge anything
   - It will NOT affect your ARR calculations
   - You can attach unlimited workspaces to it

---

## Creating an Invoice-Based Enterprise Account

For enterprise customers who pay via invoice instead of credit card, follow the exact same process as above, but with these modifications:

### Modified Step 1: Create Invoice-Specific Price (Optional)

You can either:
- **Option A**: Use the same $0 price created above (recommended for simplicity)
- **Option B**: Create a separate price with the actual monthly amount (e.g., `$999/month`) but configure it to not auto-charge

**For Option B:**
1. In Stripe, create a new Enterprise price
2. Set the amount to the negotiated monthly fee (e.g., `$999.00`)
3. In the subscription settings, set **Collection method** to `Send invoice`
4. This creates a subscription that shows the correct MRR/ARR but doesn't auto-charge

### Modified Step 2: Name the Billing Profile

When creating the billing profile:
- Use the customer's company name: `"Acme Corp - Enterprise"`
- This makes it easy to identify in reports

### Additional Step: Set Up Manual Invoicing

1. **In Stripe Dashboard**
   - Go to **Invoices** → **Create invoice**
   - Select the customer
   - Add the line item for their monthly fee
   - Set due date (e.g., Net 30)
   - Send the invoice manually each month

2. **Or Use Stripe Billing Automation**
   - If using Option B above, Stripe will automatically generate invoices
   - You just need to send them to the customer each month

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
   - Subscribe to $0 Enterprise plan

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

### "Payment method required" Error

**Problem**: When trying to create a subscription, you get an error saying payment method is required.

**Solution**:
- Make sure you're using the $0 price ID in Stripe
- Verify the price shows `$0.00` in the Stripe dashboard
- If the price is not $0, Stripe will require a payment method

### Subscription Status is "Incomplete"

**Problem**: The subscription is created but shows status `incomplete` instead of `active`.

**Solution**:
- For $0 subscriptions, this usually auto-resolves within a few seconds
- Refresh the page and check again
- If it stays incomplete for more than 1 minute, the price might not be $0

### Can't Find the Billing Profile After Creating It

**Problem**: Created a billing profile but can't see it in the list.

**Solution**:
- Make sure you're logged in as the same user who created it
- Check that you have `manager` role on the billing profile
- Try logging out and back in
- Check the browser console for any errors

### Enterprise Features Not Showing

**Problem**: Attached workspace to enterprise billing profile but still showing free tier limits.

**Solution**:
- Verify the subscription was created successfully (check Step 3 response)
- Check that `currentPlan` field shows `"enterprise"` in the billing profile
- Try detaching and re-attaching the workspace
- Check the backend logs for any errors during attachment

### Workspace Shows "Billing Required" Warning

**Problem**: Workspace shows a warning that billing is required even though it's attached to an enterprise profile.

**Solution**:
- Check that the billing profile's `planStatus` is `"active"`
- Verify the `stripeSubscriptionId` field is populated
- Make sure the workspace's `billingProfileId` matches the enterprise billing profile
- Contact technical support if the issue persists

---

## Summary Checklist

### For $0 Demo Accounts:
- [ ] Created $0 price in Stripe for Enterprise product
- [ ] Created billing profile in AIRank
- [ ] Subscribed billing profile to $0 Enterprise plan via GraphQL
- [ ] Verified subscription is active in Stripe
- [ ] Attached workspace(s) to billing profile
- [ ] Verified enterprise features are enabled

### For Invoice-Based Enterprise:
- [ ] Created price in Stripe (either $0 or actual amount with manual invoicing)
- [ ] Created billing profile with customer name
- [ ] Subscribed billing profile to enterprise plan
- [ ] Set up manual invoicing process (if applicable)
- [ ] Attached customer workspace to billing profile
- [ ] Sent first invoice to customer (if applicable)

---

## Need Help?

If you encounter any issues not covered in this guide:

1. Check the backend logs for error messages
2. Verify all IDs are correct (billing profile ID, price ID)
3. Contact your technical team with:
   - The exact error message
   - The billing profile ID
   - Screenshots of the issue
   - What you were trying to do when it failed

---

**Last Updated**: 2025-11-18
**Version**: 1.0
