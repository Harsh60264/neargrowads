# Supabase Admin Auth Email Templates

These are manual hosted-project settings. No API credentials, Auth configuration, SMTP settings, or production email templates are changed by this repository.

## Installation

In the Supabase Dashboard, open **Authentication → Email Templates** (the hosted dashboard route is **Project → Authentication → Email Templates**). Configure the templates below and save each one. The project must also have a working SMTP provider and the deployed website URL allow-listed under **Authentication → URL Configuration**.

Use the exact subject and HTML for each corresponding template:

- **Invite user** is retained for any manually issued Supabase invitations; current CMS administrator creation uses the **Confirm signup** flow.
- **Confirm signup** is used by new-admin setup and verification resend. The CMS creates or reuses the Auth identity first and requests a signup confirmation email. For a newly created identity, a separate branded application email carries the 24-hour temporary password; do not add a password or dynamic password placeholder to this template.
- **Reset password** is used for verified-identity setup recovery and ordinary administrator password resets.

The manually issued **Invite user** template uses Supabase's `{{ .ConfirmationURL }}` variable. The CMS **Confirm signup** and **Reset password** flows use the requested, allow-listed `{{ .RedirectTo }}` plus `{{ .TokenHash }}` so the callback can verify the one-time token on the server. Their redirect URLs always include a query parameter; preserve the `&token_hash=...&type=...` suffix exactly. Do not substitute a hard-coded host. The callback immediately removes token parameters from browser history, and the site's `Referrer-Policy: no-referrer` prevents forwarding them to other origins.

## Invite user

**Subject:** `You're invited to NearGrow Ads CMS`

```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#17231b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f3f6f2;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dce5dc;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#173c26;color:#ffffff;font-size:20px;font-weight:bold;">NearGrow Ads</td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#173c26;">You're invited to NearGrow Ads CMS</h1>
            <p style="font-size:16px;line-height:1.6;">Hello,</p>
            <p style="font-size:16px;line-height:1.6;">You've been invited to join the NearGrow Ads Website CMS.</p>
            <p style="font-size:16px;line-height:1.6;">Your administrator access will allow you to manage the sections and permissions assigned by the account owner.</p>
            <p style="font-size:16px;line-height:1.6;">To get started, please verify your email address and complete your secure account setup using the button below.</p>
            <p style="margin:28px 0;text-align:center;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#286d3b;color:#ffffff;text-decoration:none;font-weight:bold;">Accept Invitation &amp; Set Up Account</a>
            </p>
            <h2 style="margin:28px 0 8px;font-size:16px;color:#173c26;">For your security</h2>
            <ul style="padding-left:22px;font-size:14px;line-height:1.7;color:#405047;">
              <li>Create your own password.</li>
              <li>Never share your password or verification link.</li>
              <li>If you weren't expecting this invitation, you can safely ignore this email.</li>
            </ul>
            <p style="margin-top:28px;font-size:14px;line-height:1.6;">Regards,<br><strong>NearGrow Ads Team</strong><br><a href="https://www.neargrowads.com" style="color:#286d3b;">www.neargrowads.com</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Confirm signup

The current delegated-admin flow uses this template when sending a verification/setup email for a new or unverified Auth identity. Keep it invitation-specific; the CMS does not use public end-user signup.

**Subject:** `You're invited to NearGrow Ads CMS`

```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#17231b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f3f6f2;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dce5dc;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#173c26;color:#ffffff;font-size:20px;font-weight:bold;">NearGrow Ads</td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#173c26;">You're invited to NearGrow Ads CMS</h1>
            <p style="font-size:16px;line-height:1.6;">Hello,</p>
            <p style="font-size:16px;line-height:1.6;">You've been invited to join the NearGrow Ads Website CMS.</p>
            <p style="font-size:16px;line-height:1.6;">Your administrator access will allow you to manage the sections and permissions assigned by the account owner.</p>
            <p style="font-size:16px;line-height:1.6;">To get started, verify your email address using the button below. If you also received a separate NearGrow Ads onboarding email with a temporary password, use it for your first sign-in and replace it immediately. If you did not receive a temporary-password email, follow the password setup instructions from the Primary Owner; existing Auth passwords are never replaced as part of this verification.</p>
            <p style="margin:28px 0;text-align:center;">
              <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=signup" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#286d3b;color:#ffffff;text-decoration:none;font-weight:bold;">Verify Email &amp; Continue</a>
            </p>
            <h2 style="margin:28px 0 8px;font-size:16px;color:#173c26;">For your security</h2>
            <ul style="padding-left:22px;font-size:14px;line-height:1.7;color:#405047;">
              <li>If a temporary password was sent separately, it expires after 24 hours and must be replaced at first sign-in. CMS actions remain blocked until replacement.</li>
              <li>Existing Auth identities are never assigned a new password by an invitation. Do not send an existing password by email.</li>
              <li>Email is not a secure channel; treat the temporary password as exposed and never forward or reuse it.</li>
              <li>Never share your password or verification link.</li>
              <li>If you weren't expecting this invitation, you can safely ignore this email.</li>
            </ul>
            <p style="margin-top:28px;font-size:14px;line-height:1.6;">Regards,<br><strong>NearGrow Ads Team</strong><br><a href="https://www.neargrowads.com" style="color:#286d3b;">www.neargrowads.com</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Reset password

Keep recovery visually branded but clearly distinct from an invitation.

**Subject:** `Reset your NearGrow Ads CMS password`

```html
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f6f2;font-family:Arial,Helvetica,sans-serif;color:#17231b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f3f6f2;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dce5dc;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#173c26;color:#ffffff;font-size:20px;font-weight:bold;">NearGrow Ads</td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#173c26;">Reset your CMS password</h1>
            <p style="font-size:16px;line-height:1.6;">Hello,</p>
            <p style="font-size:16px;line-height:1.6;">A secure password setup or reset was requested for your NearGrow Ads CMS identity.</p>
            <p style="font-size:16px;line-height:1.6;">Use the button below to continue. If you are completing an administrator invitation, your CMS access remains pending until secure setup is complete.</p>
            <p style="margin:28px 0;text-align:center;">
              <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery" style="display:inline-block;padding:14px 22px;border-radius:8px;background:#286d3b;color:#ffffff;text-decoration:none;font-weight:bold;">Set or Reset Password</a>
            </p>
            <p style="font-size:14px;line-height:1.7;color:#405047;">For your security, create your own password and never share your password or this link. If you did not request this, you can safely ignore this email.</p>
            <p style="margin-top:28px;font-size:14px;line-height:1.6;">Regards,<br><strong>NearGrow Ads Team</strong><br><a href="https://www.neargrowads.com" style="color:#286d3b;">www.neargrowads.com</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
```

## Safe rollout

1. Install and preview the templates in staging first. Send test messages through the actual Invite user, Confirm signup, and Reset password routes. Confirm the application-generated redirect contains the appropriate callback path and query before using the `RedirectTo` templates. Verify each CTA returns to that exact origin, token-hash verification succeeds only once, and token parameters are removed from the address bar without being sent to third-party resources.
2. Verify SMTP sender/domain authentication and invitation delivery before production use.
3. Configure the matching templates in the production Supabase Dashboard only after review. Template and SMTP changes are separate from application deployment; this repository does not update hosted Supabase configuration.
4. Test one new invite, one unverified resend, and one verified identity recovery. The recovery email must not be presented as a fresh invitation. The CMS Confirm signup and Reset password templates must use the supplied RedirectTo and TokenHash variables; do not use ConfirmationURL for these server-verified callback flows.
