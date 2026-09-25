/**
 * Where the landing page's calls to action go on the static site. With
 * NEXT_PUBLIC_APP_URL set they open the hosted app; without it there is no app
 * to sign up to, so they lead to the real output on /demo and "Sign in" is hidden.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || null;

export const APP_LINKS = {
  signup: APP_URL ? `${APP_URL}/signup` : "/demo",
  signupLabel: APP_URL ? "Create your workspace" : "See real output",
  signupShortLabel: APP_URL ? "Create workspace" : "Real output",
  login: APP_URL ? `${APP_URL}/login` : null,
  workspace: APP_URL ? `${APP_URL}/products` : "/demo",
  privacy: "/privacy" as string | null,
};
