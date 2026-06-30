# /add-2fa

Adds **two-factor authentication** to your app's login: a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...) on top of the password, a big security upgrade against stolen passwords.

## When to use it

- Your app has a login (an admin space or user accounts) and you want to harden it.
- You handle sensitive data (customers, orders, payments) and want a second layer beyond the password.
- A client, or your own security policy, requires strong authentication.

## How it works

1. **App choice**: Hypervibe asks which authenticator app you (or your users) will use.

2. **Auth detection**: it detects how your project handles login and adapts:
  - **Admin space** (a single fixed login): 2FA is made **mandatory** for that admin. The secret key and the backup codes are stored safely in your password vault, never shown in the chat.
  - **User accounts**: 2FA becomes **optional for each user**, and everyone turns it on from their own account page. Each person's secret and backup codes live in the database, tied to their account.

3. **Setup**: Hypervibe installs everything needed: the code generation, the login flow with the extra step, a "trusted device" option so the code is not asked on every visit, and an automatic logout after inactivity. It also prepares the QR code (or key) to enroll your app.

4. **Backup codes**: a set of one-time backup codes is generated in case you lose your phone. They are stored safely (vault or account), never displayed in plain text in the chat.

> **Prerequisite**: your project must already have a login. If it does not, Hypervibe offers to set one up first, then adds 2FA right after.
