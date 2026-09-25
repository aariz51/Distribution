/**
 * Where the landing page's calls to action go. In the app they are its own
 * routes; the static marketing site (apps/site) has its own copy of this file
 * that points at the hosted app instead.
 */
export const APP_LINKS = {
  signup: "/signup",
  signupLabel: "Create your workspace",
  signupShortLabel: "Create workspace",
  login: "/login" as string | null,
  workspace: "/products",
  privacy: "/privacy" as string | null,
};
