/**
 * Sign in / create account. Each Workday tenant has its own account store, so
 * credentials are kept per tenant host in the encrypted vault (service worker).
 *
 * Safety: at most 2 sign-in attempts and 2 create attempts per run, so a wrong
 * password never locks the account; CAPTCHAs and email verification are always
 * handed to the user.
 */
import { NeedsHuman, buttonByText, byAid, humanClick, isVisible, qa, sleep, text, waitStable } from "./dom.js";
import { setCheckbox, setText } from "./controls.js";
import { errorMessages } from "./detect.js";
import { pace, type Ctx } from "./context.js";
import { ACCOUNT_EXISTS_RX, AUTH_FAILED_RX, CREATE_ACCOUNT_TEXT_RX, LOCKED_RX, SIGN_IN_TEXT_RX, SIGN_IN_WITH_EMAIL_RX, VERIFY_EMAIL_RX } from "./i18n.js";

interface CredReply {
  cred: { email: string; password: string } | null;
  master: { email: string; password: string } | null;
}

async function getCreds(host: string): Promise<CredReply> {
  return (await chrome.runtime.sendMessage({ type: "wd:cred:get", tenantHost: host })) as CredReply;
}

function captchaPresent(): boolean {
  return qa('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], [data-automation-id*="captcha" i]').some(isVisible);
}

function emailFor(ctx: Ctx, creds: CredReply): string {
  return creds.cred?.email || ctx.profile.personal.email || creds.master?.email || "";
}

/** Some tenants show "Sign in with Google / LinkedIn / Email" first. */
async function chooseEmailSignIn(): Promise<boolean> {
  const btn = byAid("signInWithEmail") ?? buttonByText(SIGN_IN_WITH_EMAIL_RX);
  if (btn && !byAid("password")) {
    await humanClick(btn);
    await waitStable(400);
    return true;
  }
  return false;
}

async function submit(key: "signInSubmit" | "createAccountSubmit", label: RegExp): Promise<void> {
  const btn = byAid(key) ?? buttonByText(label);
  if (!btn) throw new NeedsHuman("Couldn't find the submit button on the sign-in form.");
  await humanClick(btn);
  await sleep(400);
  await waitStable(700, 15000);
}

export async function handleSignIn(ctx: Ctx): Promise<void> {
  await chooseEmailSignIn();
  if (captchaPresent()) throw new NeedsHuman("Solve the CAPTCHA, then click Resume.");
  const host = ctx.run.tenantHost;
  const creds = await getCreds(host);
  const cred = creds.cred ?? (ctx.settings.useMasterPassword ? creds.master : null);

  if (!cred) {
    const create = byAid("createAccountLink") ?? buttonByText(CREATE_ACCOUNT_TEXT_RX);
    if (create && ctx.run.createAttempts < 2) {
      ctx.log("No saved account for this employer — switching to Create Account");
      await humanClick(create);
      await waitStable(500);
      return;
    }
    throw new NeedsHuman("No saved password for this employer. Sign in yourself (it will be remembered if you use Create Account here), then click Resume.");
  }
  if (ctx.run.authAttempts >= 2) {
    throw new NeedsHuman("Sign-in failed twice. Use 'Forgot password' or update the saved password in Workday settings, then click Resume.");
  }

  ctx.run.authAttempts++;
  await ctx.save();
  const email = byAid("email");
  const pw = byAid("password");
  if (!email || !pw) throw new NeedsHuman("Sign-in form fields not found.");
  await setText(email, cred.email || emailFor(ctx, creds));
  await pace(ctx);
  await setText(pw, cred.password);
  await pace(ctx);
  await submit("signInSubmit", SIGN_IN_TEXT_RX);

  const errs = errorMessages().map((e) => e.text).join(" ");
  if (AUTH_FAILED_RX.test(errs) || LOCKED_RX.test(errs)) {
    if (LOCKED_RX.test(errs)) throw new NeedsHuman("This account is locked. Reset the password from the sign-in page, then click Resume.");
    ctx.log(`Sign-in rejected: ${errs}`, "warn");
    if (!creds.cred && ctx.run.createAttempts < 2) {
      const create = byAid("createAccountLink");
      if (create) {
        await humanClick(create);
        await waitStable(500);
        return;
      }
    }
    throw new NeedsHuman("Sign-in was rejected. Check the saved password (Workday settings) or use 'Forgot password', then click Resume.");
  }
  if (VERIFY_EMAIL_RX.test(text(document.body).slice(0, 3000)) && !byAid("next")) {
    throw new NeedsHuman("Workday wants you to verify your email. Click the link in the email it sent, sign in again if asked, then click Resume.");
  }
  ctx.log("Signed in");
}

export async function handleCreateAccount(ctx: Ctx): Promise<void> {
  if (captchaPresent()) throw new NeedsHuman("Solve the CAPTCHA, then click Resume.");
  const host = ctx.run.tenantHost;
  const creds = await getCreds(host);

  if (creds.cred && ctx.run.authAttempts < 2) {
    // We already have an account here; go back to sign in rather than make a duplicate.
    const link = byAid("signInLink") ?? buttonByText(SIGN_IN_TEXT_RX);
    if (link) {
      ctx.log("Account already saved for this employer — switching to Sign In");
      await humanClick(link);
      await waitStable(500);
      return;
    }
  }
  if (ctx.run.createAttempts >= 2) throw new NeedsHuman("Account creation failed twice. Finish it yourself, then click Resume.");

  const email = ctx.profile.personal.email || creds.master?.email;
  if (!email) throw new NeedsHuman("Add your email to the Workday profile (Settings) first.");

  let password: string;
  if (ctx.settings.useMasterPassword && creds.master) {
    password = creds.master.password;
    await chrome.runtime.sendMessage({ type: "wd:cred:set", tenantHost: host, email, password });
  } else {
    const r = (await chrome.runtime.sendMessage({ type: "wd:cred:generate", tenantHost: host, email })) as { password: string };
    password = r.password;
  }

  ctx.run.createAttempts++;
  await ctx.save();
  const emailEl = byAid("email");
  const pw = byAid("password");
  const verify = byAid("verifyPassword");
  if (!emailEl || !pw) throw new NeedsHuman("Create-account form fields not found.");
  await setText(emailEl, email);
  await pace(ctx);
  await setText(pw, password);
  await pace(ctx);
  if (verify) await setText(verify, password);
  await pace(ctx);

  const terms = byAid("createAccountCheckbox");
  if (terms) {
    if (!ctx.settings.consentCreateAccountTerms) {
      throw new NeedsHuman("Read and tick the account terms box (or allow it once in Workday settings), then click Resume.", "Create account terms");
    }
    if (!(await setCheckbox(terms, true))) throw new NeedsHuman("Couldn't tick the account terms box — tick it, then click Resume.");
  }

  await submit("createAccountSubmit", CREATE_ACCOUNT_TEXT_RX);
  const errs = errorMessages().map((e) => e.text).join(" ");
  if (ACCOUNT_EXISTS_RX.test(errs)) {
    ctx.log("An account already exists for this email — switching to Sign In", "warn");
    if (!(ctx.settings.useMasterPassword && creds.master)) {
      throw new NeedsHuman(
        "You already have an account with this employer, but its password isn't saved. Sign in (or use 'Forgot password'), then click Resume. Tip: turn on 'one password for all tenants' in settings."
      );
    }
    const link = byAid("signInLink");
    if (link) await humanClick(link);
    await waitStable(500);
    return;
  }
  if (/password|passwort|kennwort|mot de passe|contraseña|senha|wachtwoord|hasło|パスワード|密码/iu.test(errs)) throw new NeedsHuman(`Workday rejected the password: ${errs}`);
  if (errs) throw new NeedsHuman(`Account creation error: ${errs}`);
  ctx.log("Account created; credentials saved (encrypted) for this employer");
}
